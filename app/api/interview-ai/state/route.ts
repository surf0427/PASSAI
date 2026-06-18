/**
 * STEP-INTERVIEW-AI-PR9: 面接 AI セッションの再開状態取得 route。
 *
 * GET /api/interview-ai/state?sessionId=...
 *   in_progress セッションの「いま何をすべきか」を返す。UI の再開ダイアログ / 再開導線が使う。
 *   recordUsage は呼ばない（read-only）。
 *
 * レスポンス 200:
 *   {
 *     sessionId, source, status, targetRef,
 *     currentQuestion: string | null,   // 答えるべき質問（最後のターンが question のときその本文）
 *     needsKickoff: boolean,            // ターン 0 件（seed 未生成）
 *     needsRetry: boolean,              // 最後が answer（followup 未生成 → retryFollowup 必要）
 *     answerCount: number,
 *     done: boolean                     // 回答が上限に達している
 *   }
 *   400 invalid-query / 401 / 404 session-not-found / 409 session-not-in-progress
 *   500 turn-load-failed / state-failed
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import { loadInProgressOwnedSession } from '@/lib/interviewAi/sessionGuard';
import { countAnswerTurns, listTurns } from '@/lib/interviewAi/turnStore';
import { INTERVIEW_AI_MAX_ANSWER_TURNS } from '@/lib/interviewAi/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

export async function GET(req: Request) {
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;
  const userId = auth.userId;

  const sessionId = new URL(req.url).searchParams.get('sessionId');
  if (!sessionId) return json({ error: 'invalid-query' }, 400);

  const admin = getServiceRoleSupabaseClient();
  const guard = await loadInProgressOwnedSession(admin, sessionId, userId);
  if (guard.kind === 'reject') return json({ error: guard.error }, guard.status);
  const session = guard.session;

  const { turns, error: listErr } = await listTurns(admin, sessionId);
  if (listErr) {
    devWarn('[interview-ai/state] listTurns error', listErr);
    return json({ error: 'turn-load-failed' }, 500);
  }

  try {
    const answerCount = countAnswerTurns(turns);
    const last = turns[turns.length - 1];
    const needsKickoff = turns.length === 0;
    const needsRetry = !!last && last.role === 'answer';
    const currentQuestion = last && last.role === 'question' ? last.content : null;
    const done = answerCount >= INTERVIEW_AI_MAX_ANSWER_TURNS;

    return json(
      {
        sessionId: session.id,
        source: session.source,
        status: session.status,
        interviewType: session.interview_type,
        targetRef: session.target_ref,
        currentQuestion,
        needsKickoff,
        needsRetry,
        answerCount,
        done,
        // 回答済みターンの復元用（表示専用）。answerCount は引き続き質問数の単一情報源（client はこれを seed）。
        // turns は「これまでのやり取り」表示の再構築にのみ使う（STEP2 req ②）。順序は turn_index 昇順。
        turns: turns.map((t) => ({ role: t.role, content: t.content })),
      },
      200,
    );
  } catch (err) {
    devWarn('[interview-ai/state] unhandled', err);
    captureRouteException(
      err,
      { route: 'interview-ai/state', feature: 'interview-ai', status: 500 },
      { status: 500, code: 'state-failed' },
    );
    return json({ error: 'state-failed' }, 500);
  }
}
