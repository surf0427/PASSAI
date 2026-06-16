/**
 * STEP-INTERVIEW-AI-PR7: 面接 AI セッション中断 route。
 *
 * POST { sessionId }
 *   1. 認証 + 所有者 / in_progress 確認
 *   2. session.status を 'abandoned' に更新（feedback 生成なし / results 保存なし）
 *
 * PR7 必須条件:
 *   - recordUsage は **呼ばない**（abandon は課金トリガではない）。本 route は lib/billing を import しない。
 *   - Supabase 更新失敗は明示エラー（best-effort にしない）。
 *
 * レスポンス:
 *   200 { status: 'abandoned' }
 *   400 { error: 'invalid-body' }
 *   401 … 未認証
 *   404 { error: 'session-not-found' } / 409 { error: 'session-not-in-progress' }
 *   500 { error: 'status-update-failed' | 'abandon-failed' }
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import { loadInProgressOwnedSession } from '@/lib/interviewAi/sessionGuard';
import { updateSessionStatus } from '@/lib/interviewAi/completion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const ROUTE_TAG = 'interview-ai/abandon';

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;
  const userId = auth.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid-body' }, 400);
  }
  const sessionId = (body as { sessionId?: unknown })?.sessionId;
  if (typeof sessionId !== 'string' || !sessionId) {
    return json({ error: 'invalid-body' }, 400);
  }

  const admin = getServiceRoleSupabaseClient();

  const guard = await loadInProgressOwnedSession(admin, sessionId, userId);
  if (guard.kind === 'reject') return json({ error: guard.error }, guard.status);

  try {
    const upd = await updateSessionStatus(admin, { sessionId, status: 'abandoned' });
    if (upd.error) {
      devWarn('[interview-ai/abandon] status update error', upd.error);
      return json({ error: 'status-update-failed' }, 500);
    }
    if (upd.updatedCount === 0) {
      return json({ error: 'session-not-in-progress' }, 409);
    }
    return json({ status: 'abandoned' }, 200);
  } catch (err) {
    devWarn('[interview-ai/abandon] unhandled', err);
    captureRouteException(
      err,
      { route: ROUTE_TAG, feature: 'interview-ai', status: 500 },
      { status: 500, code: 'abandon-failed' },
    );
    return json({ error: 'abandon-failed' }, 500);
  }
}
