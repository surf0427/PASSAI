import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { devWarn } from '@/lib/devLog';
import { recordUsage } from '@/lib/billing/usageLog';
import { PRESENTATION_EVAL_MODEL, PRESENTATION_USAGE_ROUTE } from './constants';

/**
 * STEP-PRESENTATION-PR5: プレゼンの課金トリガ（compare-and-set + recordUsage）。
 *
 * 設計（docs/presentation/pr0_design.md §8）:
 *   - 課金単位は presentation_sessions（1 session = 1 消費）。usage_recorded を session に持つため、
 *     同一 session 内の録り直し / 別 attempt 評価では追加消費しない。
 *   - recordUsage は必ず route='presentation'（PRESENTATION_USAGE_ROUTE）で計上する。
 *   - 呼び出しは evaluate route の「初回 AI 評価成功 + result 保存成功 + attempt status 更新成功」後のみ。
 *     compare-and-set で勝者になったプロセスだけが recordUsage を呼ぶ（二重課金防止）。
 *
 * 面接AI lib/interviewAi/billing.ts と同型（対象テーブルが presentation_sessions な点だけ差分）。
 */

const TABLE = 'presentation_sessions';

/**
 * usage_recorded の compare-and-set。
 *
 *   UPDATE presentation_sessions SET usage_recorded = true
 *   WHERE id = :session_id AND usage_recorded = false
 *   RETURNING id;
 *
 * - 行が返った（false → true に変えた勝者）プロセスのみ true を返す。
 * - 既に true（課金済み）なら 0 行 → false。
 * - DB エラー時は false を返し recordUsage を呼ばせない（fail-closed: 計上漏れ > 二重課金）。
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
    devWarn('[presentation/billing] compare-and-set error', {
      message: error.message,
    });
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * 課金トリガ本体: compare-and-set で勝者になったときだけ recordUsage('presentation','ok')。
 * - billed=true は「本プロセスが課金を計上した」。false は「既に課金済み or compare-and-set 失敗」。
 * - recordUsage は best-effort（never throw / lib/billing/usageLog.ts）。
 */
export async function triggerPresentationBilling(args: {
  admin: SupabaseClient;
  sessionId: string;
  userId: string;
}): Promise<{ billed: boolean }> {
  const won = await claimUsageRecording(args.admin, args.sessionId);
  if (!won) return { billed: false };

  await recordUsage({
    userId: args.userId,
    route: PRESENTATION_USAGE_ROUTE, // 必ず 'presentation'
    model: PRESENTATION_EVAL_MODEL,
    status: 'ok',
  });
  return { billed: true };
}
