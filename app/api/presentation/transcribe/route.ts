/**
 * STEP-PRESENTATION-PR4: プレゼン音声 → transcript の文字起こし route。
 *
 * 録画直後にクライアントが保持している **音声 blob** を multipart で受け取り、Whisper で
 * 文字起こしして attempt に transcript を保存する。
 *   - サーバ側 ffmpeg は使わない。Storage 上の動画から音声抽出もしない（pr0_design.md §11 / §12）。
 *   - 音声バイナリはメモリ上で transcribe するだけで保存しない（DB に入るのは transcript のみ）。
 *
 * 受信: POST multipart/form-data
 *   attempt_id        (必須)
 *   audio_file        (必須 / Blob)
 *   audio_mime_type   (任意)
 *   duration_sec      (任意 / 正の整数)
 *
 * レスポンス:
 *   200 { attempt: { id, status, transcript, durationSec } }
 *   400 invalid-form | missing-audio | invalid-audio-type | audio-too-large
 *   401 unauthorized
 *   403 forbidden-attempt       … 他人の attempt / 親 session が in_progress でない
 *   404 attempt-not-found
 *   409 invalid-attempt-status  … attempt.status が uploaded/failed 以外
 *   500 transcribe-failed       … STT 失敗（status を failed に更新 / 保存も課金もしない）
 *
 * 課金（pr0_design.md §8）:
 *   - usage_records に書かない / recordUsage を呼ばない / ensurePlanQuota もしない。
 *     消費は evaluate の初回 AI 評価成功時のみ。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import { INTERVIEW_AI_MAX_AUDIO_BYTES } from '@/lib/interviewAi/constants';
import { isSttError, transcribeAudio } from '@/lib/interviewAi/stt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

const TABLE = 'presentation_attempts';
const SESSIONS_TABLE = 'presentation_sessions';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 録画直後の音声 blob 想定。動画コンテナ（video/*）も許容する（音声のみ Whisper が読む）。
const ALLOWED_AUDIO_MIME = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'video/webm',
  'video/mp4',
]);

// video/* コンテナで届いた場合、Whisper のファイル拡張子判定が正しく効くよう audio/* に正規化する
// （lib/interviewAi/stt.ts の extFromMime が webm/mp4 を解決できるようにする）。
const MIME_NORMALIZE: Record<string, string> = {
  'video/webm': 'audio/webm',
  'video/mp4': 'audio/mp4',
};

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

function baseMime(raw: string): string {
  return (raw || '').split(';')[0].trim().toLowerCase();
}

export async function POST(req: Request) {
  // 1. 認証のみ（quota gate はしない）。
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;
  const userId = auth.userId;

  // 2. multipart parse
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ error: 'invalid-form' }, 400);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'invalid-form' }, 400);
  }

  const attemptId = String(form.get('attempt_id') ?? '');
  if (!attemptId || !UUID_RE.test(attemptId)) {
    return json({ error: 'invalid-form' }, 400);
  }

  // 3. 音声ファイル検証
  const audio = form.get('audio_file');
  if (!(audio instanceof Blob) || audio.size === 0) {
    return json({ error: 'missing-audio' }, 400);
  }
  if (audio.size > INTERVIEW_AI_MAX_AUDIO_BYTES) {
    return json({ error: 'audio-too-large' }, 400);
  }
  const declaredMime =
    typeof form.get('audio_mime_type') === 'string'
      ? String(form.get('audio_mime_type'))
      : '';
  const effectiveMime = baseMime(declaredMime || audio.type);
  if (!ALLOWED_AUDIO_MIME.has(effectiveMime)) {
    return json({ error: 'invalid-audio-type' }, 400);
  }

  // 任意 duration_sec（正の整数のときだけ採用）。
  const durationRaw = form.get('duration_sec');
  const parsedDuration =
    durationRaw != null ? Number(durationRaw) : NaN;
  const updateDuration =
    Number.isInteger(parsedDuration) && parsedDuration > 0
      ? parsedDuration
      : null;

  const admin = getServiceRoleSupabaseClient();

  // 4. attempt 所有 + status + 親 session 確認
  const { data: attempt, error: attemptErr } = await admin
    .from(TABLE)
    .select('id, user_id, session_id, status, duration_sec, metadata')
    .eq('id', attemptId)
    .maybeSingle();

  if (attemptErr) {
    devWarn('[presentation/transcribe] attempt fetch error', {
      message: attemptErr.message,
    });
    return failTranscribe(attemptErr);
  }
  if (!attempt) {
    return json({ error: 'attempt-not-found' }, 404);
  }
  if (attempt.user_id !== userId) {
    return json({ error: 'forbidden-attempt' }, 403);
  }
  if (attempt.status !== 'uploaded' && attempt.status !== 'failed') {
    // transcribed / evaluated 済みは再文字起こし不可。
    return json({ error: 'invalid-attempt-status' }, 409);
  }

  const { data: session, error: sessionErr } = await admin
    .from(SESSIONS_TABLE)
    .select('id, status')
    .eq('id', attempt.session_id)
    .maybeSingle();
  if (sessionErr) {
    devWarn('[presentation/transcribe] session fetch error', {
      message: sessionErr.message,
    });
    return failTranscribe(sessionErr);
  }
  if (!session || session.status !== 'in_progress') {
    // completed / abandoned（や欠落）の親では transcribe しない。
    return json({ error: 'forbidden-attempt' }, 403);
  }

  // 5. STT（音声はメモリ上で transcribe するだけ。保存しない）。
  let transcript: string;
  try {
    const audioBuffer = await audio.arrayBuffer();
    const sttMime = MIME_NORMALIZE[effectiveMime] ?? effectiveMime;
    const out = await transcribeAudio({ audio: audioBuffer, mimeType: sttMime });
    transcript = out.transcript;
    // audioBuffer はここで参照終了（GC 対象）。保存しない。
  } catch (err) {
    // 6. 失敗時: status を failed に更新（transcript は壊さない）。課金は一切しない。
    if (isSttError(err)) {
      await markFailed(admin, attemptId).catch(() => {});
      devWarn('[presentation/transcribe] stt error', {
        name: (err as Error).name,
      });
      return json({ error: 'transcribe-failed' }, 500);
    }
    await markFailed(admin, attemptId).catch(() => {});
    return failTranscribe(err);
  }

  // 7. 成功: transcript 保存 + status=transcribed + metadata 追記（既存を保持してマージ）。
  const existingMeta =
    attempt.metadata && typeof attempt.metadata === 'object'
      ? (attempt.metadata as Record<string, unknown>)
      : {};
  const update: Record<string, unknown> = {
    transcript,
    status: 'transcribed',
    metadata: {
      ...existingMeta,
      audio_mime_type: effectiveMime,
      audio_size_bytes: audio.size,
      transcribed_at: new Date().toISOString(),
    },
  };
  if (updateDuration !== null) update.duration_sec = updateDuration;

  const { data: updated, error: updateErr } = await admin
    .from(TABLE)
    .update(update)
    .eq('id', attemptId)
    .select('id, status, transcript, duration_sec')
    .single();

  if (updateErr || !updated) {
    devWarn('[presentation/transcribe] update error', {
      message: updateErr?.message,
    });
    return failTranscribe(updateErr);
  }

  return json(
    {
      attempt: {
        id: updated.id,
        status: updated.status,
        transcript: updated.transcript,
        durationSec: updated.duration_sec,
      },
    },
    200,
  );
}

// STT 失敗時に status を failed にする（transcript は触らない）。
async function markFailed(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  attemptId: string,
): Promise<void> {
  const { error } = await admin
    .from(TABLE)
    .update({ status: 'failed' })
    .eq('id', attemptId);
  if (error) {
    devWarn('[presentation/transcribe] markFailed error', {
      message: error.message,
    });
  }
}

function failTranscribe(err: unknown): Response {
  captureRouteException(
    err,
    { route: 'presentation/transcribe', feature: 'presentation', status: 500 },
    { status: 500, code: 'transcribe-failed' },
  );
  return json({ error: 'transcribe-failed' }, 500);
}
