/**
 * STEP-INTERVIEW-AI-PR7: 面接 AI セッション完了 route。
 *
 * POST { sessionId }
 *   1. 認証 + 所有者 / in_progress 確認（§4 と同じ guard）
 *   2. final feedback を生成（InterviewFeedback 形式 / logAiUsage のみ）
 *   3. interview_ai_results に保存（feedback + strengths/improvements/next_practice 射影）
 *   4. session.status を 'completed' に更新
 *
 * PR7 必須条件:
 *   - complete で recordUsage は **呼ばない**（課金は turn route の STT / 回答保存で確定済み）。
 *     本 route / finalFeedback / completion は lib/billing を import しない。
 *   - final feedback 生成は logAiUsage のみ。
 *   - Supabase 保存失敗は明示エラー（best-effort にしない）。
 *
 * レスポンス:
 *   200 { status: 'completed', feedback, strengths, improvements, nextPractice }
 *   400 { error: 'invalid-body' }
 *   401 … 未認証
 *   404 { error: 'session-not-found' } / 409 { error: 'session-not-in-progress' | 'no-turns' }
 *   500 { error: 'turn-load-failed' | 'results-save-failed' | 'status-update-failed' | 'complete-failed' }
 *   502 { error: 'feedback-generation-failed' | 'feedback-truncated' | 'feedback-parse-failed' }
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import { loadInProgressOwnedSession } from '@/lib/interviewAi/sessionGuard';
import { countAnswerTurns, listTurns } from '@/lib/interviewAi/turnStore';
import {
  FinalFeedbackError,
  generateFinalFeedback,
  projectResultArrays,
} from '@/lib/interviewAi/finalFeedback';
import {
  saveInterviewAiResults,
  updateSessionStatus,
} from '@/lib/interviewAi/completion';
import { isInterviewType } from '@/lib/interviewAi/interviewTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

const ROUTE_TAG = 'interview-ai/complete';

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  // 認証のみ（quota の再判定はしない。complete は課金しない）。
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

  // §4: session 存在 / 所有者一致 / status='in_progress'。
  const guard = await loadInProgressOwnedSession(admin, sessionId, userId);
  if (guard.kind === 'reject') return json({ error: guard.error }, guard.status);
  const session = guard.session;

  const { turns, error: listErr } = await listTurns(admin, sessionId);
  if (listErr) {
    devWarn('[interview-ai/complete] listTurns error', listErr);
    return json({ error: 'turn-load-failed' }, 500);
  }
  // 回答が 1 件も無いセッションは完了対象にしない。
  if (countAnswerTurns(turns) === 0) {
    return json({ error: 'no-turns' }, 409);
  }

  try {
    // final feedback 生成（logAiUsage のみ。recordUsage は呼ばない）。interview_type で評価観点を変える。
    const sc = session.target_ref?.sourceContext;
    const feedback = await generateFinalFeedback({
      interviewType: isInterviewType(session.interview_type)
        ? session.interview_type
        : 'free',
      targetRef: session.target_ref,
      turns: turns.map((t) => ({ role: t.role, content: t.content })),
      sourceContext: typeof sc === 'string' ? sc : undefined,
    });
    const projected = projectResultArrays(feedback);

    // results 保存（明示エラー / best-effort にしない）。
    const saveRes = await saveInterviewAiResults(admin, {
      sessionId,
      userId,
      feedback,
      strengths: projected.strengths,
      improvements: projected.improvements,
      nextPractice: projected.nextPractice,
    });
    if (saveRes.error) {
      devWarn('[interview-ai/complete] results save error', saveRes.error);
      return json({ error: 'results-save-failed' }, 500);
    }

    // status を completed に更新（明示エラー）。
    const upd = await updateSessionStatus(admin, { sessionId, status: 'completed' });
    if (upd.error) {
      devWarn('[interview-ai/complete] status update error', upd.error);
      return json({ error: 'status-update-failed' }, 500);
    }
    if (upd.updatedCount === 0) {
      // 競合（別リクエストが既に completed / abandoned に遷移）。
      return json({ error: 'session-not-in-progress' }, 409);
    }

    return json(
      {
        status: 'completed',
        feedback,
        strengths: projected.strengths,
        improvements: projected.improvements,
        nextPractice: projected.nextPractice,
      },
      200,
    );
  } catch (err) {
    // final feedback 生成失敗（API error / truncation / parse 失敗）→ 502。session は in_progress のまま
    // 残り、再 complete で再試行できる。recordUsage は呼んでいない。
    if (err instanceof FinalFeedbackError) {
      return json({ error: err.message }, 502);
    }
    devWarn('[interview-ai/complete] unhandled', err);
    captureRouteException(
      err,
      { route: ROUTE_TAG, feature: 'interview-ai', status: 500 },
      { status: 500, code: 'complete-failed' },
    );
    return json({ error: 'complete-failed' }, 500);
  }
}
