import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';

/**
 * STEP-PRESENTATION-PR7: presentation_sessions の状態遷移（complete / abandon）共有ロジック。
 *
 * complete / abandon は「in_progress → 終端状態（completed / abandoned）」の更新のみで、
 * 認証・所有確認・冪等性・race 処理が共通。本ヘルパに集約し、route は target/failCode を渡すだけにする。
 *
 * 課金: いずれも usage_records に書かない / recordUsage を呼ばない。
 *   abandon は usage_recorded=true（評価済み）でも返金・取消をしない（state 遷移のみ）。
 *   消費は evaluate の初回成功時のみ（pr0_design.md §8）。
 *
 * 冪等性:
 *   - 既に target と同じ状態 → 重複更新せず現在の session を返す（200）。
 *   - もう一方の終端状態（complete に対して abandoned / abandon に対して completed）
 *     → 409 invalid-session-status（不整合な遷移は拒否）。
 *   - 他人の session は 403、存在しなければ 404。終端へは絶対に他人の row を返さない。
 */

const TABLE = 'presentation_sessions';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TargetStatus = 'completed' | 'abandoned';

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

function sessionPayload(row: { id: string; status: string }): Response {
  return json({ session: { id: row.id, status: row.status } }, 200);
}

export async function transitionPresentationSession(
  req: Request,
  target: TargetStatus,
  failCode: string,
): Promise<Response> {
  // 1. 認証のみ（quota gate はしない）。
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;
  const userId = auth.userId;

  // 2. body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid-body' }, 400);
  }
  const sessionId =
    typeof (body as Record<string, unknown>)?.session_id === 'string'
      ? ((body as Record<string, unknown>).session_id as string)
      : '';
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return json({ error: 'invalid-session-id' }, 400);
  }

  const admin = getServiceRoleSupabaseClient();

  // 3. session 取得 + 所有確認
  const { data: session, error: fetchErr } = await admin
    .from(TABLE)
    .select('id, user_id, status')
    .eq('id', sessionId)
    .maybeSingle();
  if (fetchErr) {
    devWarn('[presentation/transition] fetch error', { message: fetchErr.message });
    return fail(fetchErr, failCode);
  }
  if (!session) return json({ error: 'session-not-found' }, 404);
  if (session.user_id !== userId) {
    return json({ error: 'forbidden-session' }, 403);
  }

  // 4. 冪等 / 不整合判定
  if (session.status === target) {
    // 既に同じ終端状態 → 重複更新せず現在を返す。
    return sessionPayload(session);
  }
  if (session.status !== 'in_progress') {
    // もう一方の終端状態（completed↔abandoned）への遷移は不整合。
    return json({ error: 'invalid-session-status' }, 409);
  }

  // 5. in_progress のときだけ更新（compare で race を弾く）。
  const { data: updated, error: updateErr } = await admin
    .from(TABLE)
    .update({ status: target })
    .eq('id', sessionId)
    .eq('status', 'in_progress')
    .select('id, status')
    .maybeSingle();

  if (updateErr) {
    devWarn('[presentation/transition] update error', { message: updateErr.message });
    return fail(updateErr, failCode);
  }
  if (!updated) {
    // race: 別プロセスが先に遷移した。再取得して自分の row なら現在状態を返す。
    const { data: after } = await admin
      .from(TABLE)
      .select('id, user_id, status')
      .eq('id', sessionId)
      .maybeSingle();
    if (after && after.user_id === userId) {
      if (after.status === target) return sessionPayload(after);
      return json({ error: 'invalid-session-status' }, 409);
    }
    return fail(null, failCode);
  }

  return sessionPayload(updated);
}

function fail(err: unknown, failCode: string): Response {
  captureRouteException(
    err,
    { route: `presentation/${failCode}`, feature: 'presentation', status: 500 },
    { status: 500, code: failCode },
  );
  return json({ error: failCode }, 500);
}
