/**
 * STEP-INTERVIEW-AI-VOICE: 音声 → transcript の STT route。
 *
 * POST multipart/form-data (audio)
 *   - 音声を STT してテキスト（transcript）を返すだけ。
 *   - **何も保存しない**（音声ファイルも transcript も DB / Storage に保存しない）。
 *     回答の保存は client が transcript を既存の text answer（/turn）として送る経路で行う。
 *   - **recordUsage を呼ばない**（課金は text answer 保存時の既存仕様＝1セッション1カウント）。
 *   - 音声バイナリは transcribe のためにメモリ上で扱い、処理後は破棄（参照を残さない）。
 *
 * レスポンス:
 *   200 { transcript }
 *   400 { error: 'invalid-body' } / 401 未認証 / 413 audio-too-large
 *   502 { error: 'stt-unavailable' | 'stt-failed' } … STT 失敗（保存も課金もしない）
 *   500 { error: 'stt-error' }
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { INTERVIEW_AI_MAX_AUDIO_BYTES } from '@/lib/interviewAi/constants';
import {
  isSttError,
  SttUnavailableError,
  transcribeAudio,
} from '@/lib/interviewAi/stt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  // 認証のみ（課金 / quota 判定はしない。session 作成時に gate 済み）。
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ error: 'invalid-body' }, 400);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'invalid-body' }, 400);
  }
  const audio = form.get('audio');
  if (!(audio instanceof Blob)) return json({ error: 'invalid-body' }, 400);
  if (audio.size === 0) return json({ error: 'invalid-body' }, 400);
  if (audio.size > INTERVIEW_AI_MAX_AUDIO_BYTES) {
    return json({ error: 'audio-too-large' }, 413);
  }

  try {
    // 音声はメモリ上で transcribe するだけ。保存しない。
    const audioBuffer = await audio.arrayBuffer();
    const { transcript } = await transcribeAudio({
      audio: audioBuffer,
      mimeType: audio.type || 'application/octet-stream',
    });
    // audioBuffer はここで参照終了（GC 対象）。保存しない。
    return json({ transcript }, 200);
  } catch (err) {
    if (isSttError(err)) {
      // STT 失敗 → 保存も課金もしない。client はテキスト入力にフォールバックする。
      const code = err instanceof SttUnavailableError ? 'stt-unavailable' : 'stt-failed';
      return json({ error: code }, 502);
    }
    devWarn('[interview-ai/stt] unhandled', err);
    captureRouteException(
      err,
      { route: 'interview-ai/stt', feature: 'interview-ai', status: 500 },
      { status: 500, code: 'stt-error' },
    );
    return json({ error: 'stt-error' }, 500);
  }
}
