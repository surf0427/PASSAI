/**
 * STEP-INTERVIEW-AI-REALTIME-PR5: リアルタイム面接の transcript 逐次保存 route。
 *
 * 受信:
 *   POST { sessionId: string, role: 'question' | 'answer', content: string }
 *
 * レスポンス:
 *   201 { turnIndex }
 *   400 { error: 'invalid-body' }
 *   401 / 403 / 404 / 409 / 500
 *
 * 設計（realtime pr0_design.md §4 / pr2_webrtc.md §10）:
 *   - **transcript（テキスト）のみ保存**。音声 Blob / 音声ストリームは保存しない（client が一切送らない）。
 *   - AI 発話 = role 'question'、ユーザー発話 = role 'answer'。source は 'voice' で記録
 *     （interview_ai_turns.source CHECK は 'voice'|'text' のまま。realtime はモダリティとしては voice）。
 *   - session は source='realtime' かつ in_progress かつ本人所有のもののみ受け付ける。
 *   - **課金はしない**（課金は最初の有効発話で CAS 計上＝STEP7）。
 *   - turn_index は既存件数から採番。競合時は 23505 を見て採り直す（realtime は基本逐次）。
 *
 * 既存ターン制 turn route（/api/interview-ai/turn）とは別ルート。既存ロジックは触らない。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import { loadInProgressOwnedSession } from '@/lib/interviewAi/sessionGuard';
import { insertTurn, listTurns } from '@/lib/interviewAi/turnStore';
import { triggerRealtimeBilling } from '@/lib/interviewAi/realtime/billing';
import { DEFAULT_REALTIME_MODEL } from '@/lib/interviewAi/realtime/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UNIQUE_VIOLATION = '23505';
const MAX_CONTENT_CHARS = 8000;
const MAX_INSERT_RETRIES = 3;

const ENABLED_VALUES: ReadonlySet<string> = new Set(['true', '1', 'yes']);
function isServerFlagEnabled(): boolean {
  const raw = process.env.REALTIME_INTERVIEW_ENABLED;
  return typeof raw === 'string' && ENABLED_VALUES.has(raw.trim().toLowerCase());
}

export async function POST(req: Request) {
  // server flag（最終ゲート）。OFF ならそもそも realtime セッションは作られないが、念のため拒否。
  if (!isServerFlagEnabled()) {
    return NextResponse.json({ error: 'realtime-disabled' }, { status: 403 });
  }

  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;
  const userId = auth.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const sessionId = typeof b.sessionId === 'string' ? b.sessionId : '';
  const role = b.role === 'question' || b.role === 'answer' ? b.role : null;
  const content = typeof b.content === 'string' ? b.content.trim() : '';
  if (!sessionId || !role || !content) {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }
  const safeContent = content.slice(0, MAX_CONTENT_CHARS);

  const admin = getServiceRoleSupabaseClient();

  // 所有者 + in_progress ガード（既存 sessionGuard を流用）。
  const guard = await loadInProgressOwnedSession(admin, sessionId, userId);
  if (guard.kind === 'reject') {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  // realtime セッション限定（このルートでターン制 session にターンを注入させない）。
  if ((guard.session.source as string) !== 'realtime') {
    return NextResponse.json({ error: 'not-realtime-session' }, { status: 409 });
  }

  // turn_index を採番して insert。競合（23505）時は採り直して数回リトライ。
  for (let attempt = 0; attempt < MAX_INSERT_RETRIES; attempt += 1) {
    const { turns, error: listErr } = await listTurns(admin, sessionId);
    if (listErr) {
      devWarn('[interview-ai/realtime/turn] list error', { sessionId });
      return NextResponse.json({ error: 'turn-load-failed' }, { status: 500 });
    }
    const turnIndex = turns.length;
    const { error } = await insertTurn(admin, {
      sessionId,
      userId,
      turnIndex,
      role,
      source: 'voice', // realtime は音声モダリティ。音声本体は保存しない（transcript のみ）。
      content: safeContent,
    });
    if (!error) {
      // 課金: 最初の有効なユーザー発話（role='answer'）で 1 回だけ計上（CAS で冪等）。
      // AI 発話（question）/ 接続のみ / マイク拒否では計上しない。
      if (role === 'answer') {
        const model =
          process.env.INTERVIEW_AI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
        await triggerRealtimeBilling({ admin, sessionId, userId, model });
      }
      return NextResponse.json({ turnIndex }, { status: 201 });
    }
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      continue; // 競合 → index 採り直し
    }
    devWarn('[interview-ai/realtime/turn] insert error', { sessionId });
    captureRouteException(
      error,
      {
        route: 'interview-ai/realtime/turn',
        feature: 'interview-ai-realtime',
        status: 500,
      },
      { status: 500, code: 'turn-save-failed' },
    );
    return NextResponse.json({ error: 'turn-save-failed' }, { status: 500 });
  }

  // リトライ上限到達（強い競合）。client 側は致命としない（次ターンで継続）。
  return NextResponse.json({ error: 'turn-save-conflict' }, { status: 409 });
}
