import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { devWarn } from '@/lib/devLog';

/**
 * STEP-INTERVIEW-AI-PR6: turn route のセッション所有者・状態ガード（PR6 必須条件 §4）。
 *
 * turn 処理の前に必ず以下を確認する:
 *   - session が存在する
 *   - session.user_id が auth user と一致する
 *   - session.status = 'in_progress'
 * これを満たさない場合は処理しない（reject）。
 *
 * service_role client で読む（RLS バイパス）。所有者判定はコード側で厳密に行う。
 */

export type InterviewAiSession = {
  id: string;
  user_id: string;
  source: 'voice' | 'text';
  status: string;
  usage_recorded: boolean;
  target_ref: Record<string, unknown>;
  /** 面接タイプ（どの機能データをもとに練習するか）。質問/評価生成のプロンプト分岐に使う。 */
  interview_type: string;
};

export type SessionGuardResult =
  | { kind: 'ok'; session: InterviewAiSession }
  | { kind: 'reject'; status: number; error: string };

const TABLE = 'interview_ai_sessions';

export async function loadInProgressOwnedSession(
  admin: SupabaseClient,
  sessionId: string,
  userId: string,
): Promise<SessionGuardResult> {
  const { data, error } = await admin
    .from(TABLE)
    .select('id, user_id, source, status, usage_recorded, target_ref, interview_type')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    devWarn('[interviewAi/sessionGuard] load error', { message: error.message });
    return { kind: 'reject', status: 500, error: 'session-load-failed' };
  }
  if (!data) {
    return { kind: 'reject', status: 404, error: 'session-not-found' };
  }
  // 所有者不一致は存在を漏らさないため 404 に倒す（他人のセッション id 探索を弾く）。
  if (data.user_id !== userId) {
    return { kind: 'reject', status: 404, error: 'session-not-found' };
  }
  if (data.status !== 'in_progress') {
    return { kind: 'reject', status: 409, error: 'session-not-in-progress' };
  }

  const targetRef =
    data.target_ref && typeof data.target_ref === 'object'
      ? (data.target_ref as Record<string, unknown>)
      : {};

  return {
    kind: 'ok',
    session: {
      id: data.id as string,
      user_id: data.user_id as string,
      source: data.source as 'voice' | 'text',
      status: data.status as string,
      usage_recorded: data.usage_recorded as boolean,
      target_ref: targetRef,
      interview_type: (data.interview_type as string | null) ?? 'free',
    },
  };
}
