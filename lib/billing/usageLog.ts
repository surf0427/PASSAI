/**
 * STEP-BILLING-06: usage_records への 1 行 INSERT helper (server-only)。
 *
 * 目的:
 *   - AI route の "完了" イベントを user 単位で観測 / 課金集計可能にする。
 *   - 書き込みは service_role 経由 (BILLING-01 RLS で INSERT policy 無し → 必須)。
 *
 * 設計:
 *   - 失敗は **握りつぶす** (devWarn のみ)。観測のために route を失敗させない。
 *   - 呼び出し側は `await recordUsage(...)` する: quota は本テーブルから派生する
 *     ため、record commit 前に response を返すと "quota leak" (実行したのに
 *     カウントされない) になる。fire-and-forget は意図的に避ける。
 *   - status は schema CHECK 制約 ('ok' | 'error' | 'rate_limited') に揃える。
 */

import 'server-only';

import { devWarn } from '@/lib/devLog';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';

export type UsageStatus = 'ok' | 'error' | 'rate_limited';

export type RecordUsageInput = {
  userId: string;
  /** usage_records.route。`app/api/<name>/route.ts` の <name> 部分を入れる。 */
  route: string;
  /** Anthropic model ID (例: 'claude-sonnet-4-6', 'claude-opus-4-7')。 */
  model: string;
  status: UsageStatus;
};

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  try {
    const admin = getServiceRoleSupabaseClient();
    const { error } = await admin.from('usage_records').insert({
      user_id: input.userId,
      route: input.route,
      model: input.model,
      status: input.status,
    });
    if (error) {
      devWarn('[usageLog] insert error', {
        route: input.route,
        status: input.status,
        message: error.message,
      });
    }
  } catch (err) {
    devWarn('[usageLog] insert threw', {
      route: input.route,
      status: input.status,
      err,
    });
  }
}
