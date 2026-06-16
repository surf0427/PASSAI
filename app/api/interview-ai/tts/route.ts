/**
 * STEP-INTERVIEW-AI-TTS: AI 質問テキスト → 音声 の TTS route。
 *
 * POST application/json { text }
 *   - AI 質問テキストを TTS して音声バイナリ（audio/mpeg）を返すだけ。
 *   - **何も保存しない**（音声ファイルも音声 URL も DB / Storage に保存しない）。
 *     生成した音声は一度レスポンスとして返すのみで、サーバ側にもファイルを残さない。
 *   - **recordUsage を呼ばない**（TTS は面接回数を増やさない。課金は text answer 保存時の
 *     既存仕様＝1セッション1カウントのまま）。
 *   - 音声バイナリはレスポンスを返したら破棄（参照を残さない）。
 *
 * 安全策:
 *   - TTS に失敗しても面接は止めない。AI 質問はテキストで必ず表示済みなので、client は
 *     音声なしで続行する（このエンドポイントの失敗は「読み上げできない」だけ）。
 *
 * レスポンス:
 *   200 audio/mpeg（音声バイナリ）
 *   400 { error: 'invalid-body' } / 401 未認証 / 413 text-too-large
 *   502 { error: 'tts-unavailable' | 'tts-failed' } … TTS 失敗（保存も課金もしない）
 *   500 { error: 'tts-error' }
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { INTERVIEW_AI_MAX_TTS_CHARS } from '@/lib/interviewAi/constants';
import {
  isTtsError,
  synthesizeSpeech,
  TtsUnavailableError,
} from '@/lib/interviewAi/tts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

function jsonError(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  // 認証のみ（課金 / quota 判定はしない。session 作成時に gate 済み。TTS は回数を増やさない）。
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return jsonError({ error: 'invalid-body' }, 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError({ error: 'invalid-body' }, 400);
  }
  const text =
    body && typeof (body as { text?: unknown }).text === 'string'
      ? (body as { text: string }).text.trim()
      : '';
  if (!text) return jsonError({ error: 'invalid-body' }, 400);
  if (text.length > INTERVIEW_AI_MAX_TTS_CHARS) {
    return jsonError({ error: 'text-too-large' }, 413);
  }

  try {
    // 音声はメモリ上で生成してそのまま返すだけ。保存しない。
    const { audio, contentType: audioType } = await synthesizeSpeech({ text });
    // audio はレスポンス body として返したら参照終了（GC 対象）。保存しない。
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'content-type': audioType,
        // 保存させない / キャッシュさせない（一時生成・再生後破棄の方針）。
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    if (isTtsError(err)) {
      // TTS 失敗 → 保存も課金もしない。client はテキスト表示のまま面接を続行する。
      const code = err instanceof TtsUnavailableError ? 'tts-unavailable' : 'tts-failed';
      return jsonError({ error: code }, 502);
    }
    devWarn('[interview-ai/tts] unhandled', err);
    captureRouteException(
      err,
      { route: 'interview-ai/tts', feature: 'interview-ai', status: 500 },
      { status: 500, code: 'tts-error' },
    );
    return jsonError({ error: 'tts-error' }, 500);
  }
}
