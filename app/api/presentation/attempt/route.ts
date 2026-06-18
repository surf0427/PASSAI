/**
 * STEP-PRESENTATION-PR3: プレゼン録画 attempt 登録 route。
 *
 * 動画ファイルが Supabase Storage（presentation-recordings）にアップロード **された後**、
 * DB に attempt 行を登録する。本 route は動画アップロード自体は行わない
 * （クライアントが Storage upload 完了後に呼ぶ前提 / docs/presentation/pr0_design.md §6）。
 *
 * 受信:
 *   POST {
 *     session_id: string,        // in_progress の自分の session
 *     attempt_id: string,        // クライアント先採番の UUID（Storage パス確定済み）
 *     video_mime_type: string,   // video/webm | video/mp4 | video/quicktime
 *     video_size_bytes: number,  // 非負整数
 *     duration_sec: number,      // 正の整数（実測発表時間）
 *   }
 *
 * レスポンス:
 *   201 { attempt: { id, sessionId, attemptIndex, storagePath, durationSec, status } }
 *   200 { attempt }            … 同一 attempt_id の冪等再送（既存行を返す）
 *   400 invalid-body | invalid-attempt-id | invalid-mime-type | invalid-duration
 *   401 unauthorized
 *   403 forbidden-session      … 他人の session / completed・abandoned へは作れない
 *   404 session-not-found
 *   409 attempt-limit-exceeded … 同一 session の attempt が 3 件に達している（録り直し上限）
 *   409 attempt-index-conflict … race による (session_id, attempt_index) 衝突（再試行可）
 *   500 attempt-create-failed
 *
 * 設計（pr0_design.md §4.3 / §5.2 / §6 / §12）:
 *   - 認証のみ（auth）。quota gate は **しない**: 課金は evaluate の初回成功時のみで、
 *     attempt は消費しない。録り直し上限 3 が Storage 原価の歯止め（§8 は session/evaluate 側）。
 *   - storage_path は **サーバが正準生成**（userId/sessionId/attemptId.ext）。クライアント送信値は
 *     受け取らない / 信用しない（要対応A）。
 *   - 子テーブル（presentation_attempts）の INSERT は authenticated に policy が無い＝
 *     service_role（RLS バイパス）でのみ書ける。本 route は service_role を使う。
 *   - usage_records には一切書かない（課金消費なし / §8）。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLE = 'presentation_attempts';
const SESSIONS_TABLE = 'presentation_sessions';
const UNIQUE_VIOLATION = '23505';

// 録り直し上限（サーバ強制 / pr0_design.md §6）。
const MAX_ATTEMPTS_PER_SESSION = 3;

// 許可する動画 MIME → 拡張子。これ以外は 400 invalid-mime-type。
const MIME_EXT: Record<string, string> = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

const DURATION_MAX_SEC = 4 * 60 * 60; // 4 時間（暴走値ガード）
const VIDEO_SIZE_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB（暴走値ガード）

// crypto.randomUUID() 形式（任意 version / 大文字小文字許容）。
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_COLS =
  'id, session_id, attempt_index, storage_path, duration_sec, status';

type AttemptResponse = {
  id: string;
  sessionId: string;
  attemptIndex: number;
  storagePath: string;
  durationSec: number;
  status: string;
};

export async function POST(req: Request) {
  // 1. 認証のみ（quota gate はしない）。
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;
  const userId = auth.userId;

  // 2. body parse / validate
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const sessionId = typeof b.session_id === 'string' ? b.session_id : '';
  const attemptId = typeof b.attempt_id === 'string' ? b.attempt_id : '';
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }
  if (!attemptId || !UUID_RE.test(attemptId)) {
    return NextResponse.json({ error: 'invalid-attempt-id' }, { status: 400 });
  }

  // MIME → ext（許可リスト外は拒否。storage_path はこの ext で確定する）。
  const mimeType = typeof b.video_mime_type === 'string' ? b.video_mime_type : '';
  const ext = MIME_EXT[mimeType];
  if (!ext) {
    return NextResponse.json({ error: 'invalid-mime-type' }, { status: 400 });
  }

  // duration_sec は正の整数。
  const durationSec = b.duration_sec;
  if (
    typeof durationSec !== 'number' ||
    !Number.isInteger(durationSec) ||
    durationSec <= 0 ||
    durationSec > DURATION_MAX_SEC
  ) {
    return NextResponse.json({ error: 'invalid-duration' }, { status: 400 });
  }

  // video_size_bytes は非負整数（暴走値ガード）。
  const videoSizeBytes = b.video_size_bytes;
  if (
    typeof videoSizeBytes !== 'number' ||
    !Number.isInteger(videoSizeBytes) ||
    videoSizeBytes < 0 ||
    videoSizeBytes > VIDEO_SIZE_MAX_BYTES
  ) {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }

  const admin = getServiceRoleSupabaseClient();

  // 3. session 所有 + status 確認。
  const { data: session, error: sessionErr } = await admin
    .from(SESSIONS_TABLE)
    .select('id, user_id, status')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionErr) {
    devWarn('[presentation/attempt] session fetch error', {
      message: sessionErr.message,
    });
    return failCreate(sessionErr);
  }
  if (!session) {
    return NextResponse.json({ error: 'session-not-found' }, { status: 404 });
  }
  if (session.user_id !== userId || session.status !== 'in_progress') {
    // 他人の session / completed・abandoned には attempt を作れない。
    return NextResponse.json({ error: 'forbidden-session' }, { status: 403 });
  }

  // 4. storage_path をサーバが正準生成（クライアント送信値は使わない / 要対応A）。
  const storagePath = `${userId}/${sessionId}/${attemptId}.${ext}`;

  // 5. 録り直し上限の事前チェック（count >= 3 なら 409）。
  const limitReject = await rejectIfAtLimit(admin, sessionId);
  if (limitReject) return limitReject;

  // 6. attempt_index = 既存数 + 1 を計算して insert。
  //    (session_id, attempt_index) UNIQUE が race の最終防壁。
  const attemptIndex = await nextAttemptIndex(admin, sessionId);
  if (attemptIndex === null) return failCreate(null);

  try {
    const { data, error } = await admin
      .from(TABLE)
      .insert({
        id: attemptId,
        session_id: sessionId,
        user_id: userId,
        attempt_index: attemptIndex,
        storage_path: storagePath,
        duration_sec: durationSec,
        status: 'uploaded',
        metadata: {
          video_mime_type: mimeType,
          video_size_bytes: videoSizeBytes,
        },
      })
      .select(SELECT_COLS)
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return await handleUniqueViolation(admin, {
          sessionId,
          attemptId,
          userId,
        });
      }
      devWarn('[presentation/attempt] insert error', {
        code: error.code,
        message: error.message,
      });
      return failCreate(error);
    }

    return NextResponse.json({ attempt: toAttempt(data) }, { status: 201 });
  } catch (err) {
    devWarn('[presentation/attempt] insert threw', err);
    return failCreate(err);
  }
}

// 同一 session の attempt 数が上限に達していれば 409 attempt-limit-exceeded を返す。
async function rejectIfAtLimit(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  sessionId: string,
): Promise<Response | null> {
  const { count, error } = await admin
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (error) {
    devWarn('[presentation/attempt] count error', { message: error.message });
    return failCreate(error);
  }
  if ((count ?? 0) >= MAX_ATTEMPTS_PER_SESSION) {
    return NextResponse.json(
      { error: 'attempt-limit-exceeded' },
      { status: 409 },
    );
  }
  return null;
}

// 既存 attempt 数 + 1 を返す。取得失敗時は null。
async function nextAttemptIndex(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  sessionId: string,
): Promise<number | null> {
  const { count, error } = await admin
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (error) {
    devWarn('[presentation/attempt] index count error', {
      message: error.message,
    });
    return null;
  }
  return (count ?? 0) + 1;
}

// 23505 の解決:
//   - 同一 attempt_id が既に存在 → 冪等再送とみなし既存行を 200 で返す。
//   - そうでなければ (session_id, attempt_index) の race 衝突。再 count して
//     上限なら attempt-limit-exceeded、未満なら attempt-index-conflict（再試行可）。
async function handleUniqueViolation(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  args: { sessionId: string; attemptId: string; userId: string },
): Promise<Response> {
  const { data: existing } = await admin
    .from(TABLE)
    .select(SELECT_COLS)
    .eq('id', args.attemptId)
    .eq('session_id', args.sessionId)
    .eq('user_id', args.userId)
    .maybeSingle();

  if (existing) {
    // 冪等再送（同一 attempt_id）。既存行をそのまま返す。
    return NextResponse.json({ attempt: toAttempt(existing) }, { status: 200 });
  }

  const { count } = await admin
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('session_id', args.sessionId);
  if ((count ?? 0) >= MAX_ATTEMPTS_PER_SESSION) {
    return NextResponse.json(
      { error: 'attempt-limit-exceeded' },
      { status: 409 },
    );
  }
  // index 衝突。クライアントは再試行してよい。
  return NextResponse.json({ error: 'attempt-index-conflict' }, { status: 409 });
}

function failCreate(err: unknown): Response {
  captureRouteException(
    err,
    { route: 'presentation/attempt', feature: 'presentation', status: 500 },
    { status: 500, code: 'attempt-create-failed' },
  );
  return NextResponse.json({ error: 'attempt-create-failed' }, { status: 500 });
}

function toAttempt(row: {
  id: string;
  session_id: string;
  attempt_index: number;
  storage_path: string;
  duration_sec: number;
  status: string;
}): AttemptResponse {
  return {
    id: row.id,
    sessionId: row.session_id,
    attemptIndex: row.attempt_index,
    storagePath: row.storage_path,
    durationSec: row.duration_sec,
    status: row.status,
  };
}
