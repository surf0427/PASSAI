/**
 * STEP-INTERVIEW-AI-PREFETCH: 次質問の **先読み候補** を生成して返すだけの route。
 *
 * 目的:
 *   - 現在の質問を表示した直後に、ユーザーの回答を待たずに「次に出す可能性が高い質問候補」を
 *     1 件だけ先生成しておく。回答時に /turn の presetQuestion として即採用し、待機時間を消す。
 *
 * 絶対の不変条件（既存仕様を一切変えない）:
 *   - **何も保存しない**（turn を作らない / Supabase に書き込まない）。
 *   - **recordUsage を呼ばない**（課金トリガではない。内部 AI 生成は logAiUsage のみ）。
 *   - session 作成・turn 保存・評価・STT・TTS には一切触れない。
 *   - 失敗しても面接は止めない。候補が無ければ client は従来どおり /turn で生成する（フォールバック）。
 *
 * 入力 / 出力:
 *   POST application/json { sessionId }
 *   200 { candidate: string }          … 先読み候補（採用は任意。保存はしない）
 *   200 { candidate: null }            … 候補なし（pending 質問が無い / 上限到達 / 生成失敗）。client は通常生成へ。
 *   400 invalid-body / 401 未認証 / 404 session-not-found / 409 状態不一致
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import { INTERVIEW_AI_MAX_ANSWER_TURNS } from '@/lib/interviewAi/constants';
import { isPrefetchAllowedForInterviewType } from '@/lib/interviewAi/featureFlag';
import { loadInProgressOwnedSession } from '@/lib/interviewAi/sessionGuard';
import { countAnswerTurns, listTurns } from '@/lib/interviewAi/turnStore';
import { generateSpeculativeQuestion, type PriorTurn } from '@/lib/interviewAi/questionGen';
import { isInterviewType } from '@/lib/interviewAi/interviewTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  // 認証のみ（quota / 課金判定はしない。先読みは回数を増やさず、保存もしない）。
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;
  const userId = auth.userId;

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return json({ error: 'invalid-body' }, 400);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid-body' }, 400);
  }
  const sessionId =
    body && typeof (body as { sessionId?: unknown }).sessionId === 'string'
      ? (body as { sessionId: string }).sessionId
      : '';
  if (!sessionId) return json({ error: 'invalid-body' }, 400);

  const admin = getServiceRoleSupabaseClient();

  // session 存在 / 所有者一致 / status='in_progress'（turn route と同じガード）。
  const guard = await loadInProgressOwnedSession(admin, sessionId, userId);
  if (guard.kind === 'reject') return json({ error: guard.error }, guard.status);
  const session = guard.session;

  // モード別ガード（client と二重）: 全体 flag OFF / 先読み非許可モード（self_analysis 等）は
  // ここで打ち切る。AI 生成も listTurns もせず candidate なしを返す（無駄な生成・コストを出さない）。
  if (!isPrefetchAllowedForInterviewType(session.interview_type)) {
    return json({ candidate: null }, 200);
  }

  const { turns, error: listErr } = await listTurns(admin, sessionId);
  if (listErr) {
    devWarn('[interview-ai/prefetch] listTurns error', listErr);
    // 先読みは補助。読み込み失敗でも面接は止めない（client は通常生成へフォールバック）。
    return json({ candidate: null }, 200);
  }

  // 末尾が未回答の質問でなければ先読みできない（次に答える対象が確定していない）。
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'question') {
    return json({ candidate: null }, 200);
  }

  // 上限ガード: 現在の質問に答えると上限到達 → その先に質問は無い（先読み不要）。
  // これにより最後の質問では speculative 生成（AI 呼び出し）自体を行わない（無駄なコストを出さない）。
  const pendingAnswerNumber = countAnswerTurns(turns) + 1;
  if (pendingAnswerNumber >= INTERVIEW_AI_MAX_ANSWER_TURNS) {
    return json({ candidate: null, done: true }, 200);
  }

  // speculative 候補を生成（logAiUsage のみ / 保存なし / 課金なし）。失敗は candidate:null で握って続行。
  try {
    const interviewType = isInterviewType(session.interview_type)
      ? session.interview_type
      : 'free';
    const sc = session.target_ref?.sourceContext;
    const priorTurns: PriorTurn[] = turns.map((t) => ({ role: t.role, content: t.content }));
    const candidate = await generateSpeculativeQuestion({
      interviewType,
      targetRef: session.target_ref,
      turns: priorTurns,
      sourceContext: typeof sc === 'string' ? sc : undefined,
    });
    return json({ candidate }, 200);
  } catch (err) {
    // 先読み失敗は致命ではない。client は presetQuestion 無しで /turn を叩き従来生成にフォールバックする。
    devWarn('[interview-ai/prefetch] speculative gen failed', err);
    return json({ candidate: null }, 200);
  }
}
