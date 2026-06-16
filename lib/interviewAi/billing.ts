import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { devWarn } from '@/lib/devLog';
import { recordUsage } from '@/lib/billing/usageLog';
import { INTERVIEW_AI_MODEL, INTERVIEW_AI_USAGE_ROUTE } from './constants';

/**
 * STEP-INTERVIEW-AI-PR6: Interview AI の課金トリガ（compare-and-set + recordUsage）。
 *
 * PR6 必須条件 §1 / §3:
 *   - recordUsage は必ず route='interview-ai'（INTERVIEW_AI_USAGE_ROUTE）で計上する。
 *   - recordUsage の前に必ず compare-and-set を実行し、行が返ったプロセスだけが recordUsage を呼ぶ。
 *
 * 呼び出し箇所は turn route の 2 箇所のみ（PR6 必須条件 §2）:
 *   - source='voice' の最初の STT 成功時
 *   - source='text' の最初の回答保存時
 * seed / followup / turn analysis では絶対に呼ばない（内部 AI は logAiUsage のみ）。
 */

const TABLE = 'interview_ai_sessions';

/**
 * usage_recorded の compare-and-set。
 *
 *   UPDATE interview_ai_sessions SET usage_recorded = true
 *   WHERE id = :session_id AND usage_recorded = false
 *   RETURNING id;
 *
 * - 行が返った（= false → true に変えた勝者）プロセスのみ true を返す。
 * - 既に true（課金済み）なら 0 行 → false。
 * - DB エラー時は false を返し、recordUsage を呼ばせない（fail-closed: 二重課金より計上漏れを選ぶ。
 *   計上漏れは観測 sink で検知可能、二重課金はユーザー不利益）。
 */
export async function claimUsageRecording(
  admin: SupabaseClient,
  sessionId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from(TABLE)
    .update({ usage_recorded: true })
    .eq('id', sessionId)
    .eq('usage_recorded', false)
    .select('id');

  if (error) {
    devWarn('[interviewAi/billing] compare-and-set error', {
      message: error.message,
    });
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * 課金トリガ本体: compare-and-set で勝者になったときだけ recordUsage('interview-ai','ok')。
 *
 * - 戻り値 billed=true は「本プロセスが課金を計上した」を意味する。
 * - false は「既に課金済み（or compare-and-set 失敗）で計上しなかった」。
 * - recordUsage 自体は best-effort（never throw / lib/billing/usageLog.ts）。本トリガは
 *   compare-and-set 成功後に呼ぶため、course of 1 セッション 1 回の冪等性を保証する。
 */
export async function triggerInterviewAiBilling(args: {
  admin: SupabaseClient;
  sessionId: string;
  userId: string;
}): Promise<{ billed: boolean }> {
  const won = await claimUsageRecording(args.admin, args.sessionId);
  if (!won) return { billed: false };

  await recordUsage({
    userId: args.userId,
    route: INTERVIEW_AI_USAGE_ROUTE, // 必ず 'interview-ai'（PR6 必須条件 §1）
    model: INTERVIEW_AI_MODEL,
    status: 'ok',
  });
  return { billed: true };
}
