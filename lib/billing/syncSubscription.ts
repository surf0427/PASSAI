/**
 * STEP-BILLING-03: Stripe Subscription → Supabase 同期ロジック（server-only）。
 *
 * Stripe webhook が customer.subscription.{created,updated,deleted} を受けた
 * とき、本 module の `syncSubscriptionFromStripe(sub)` が
 *   1. plan / period / status を Stripe Subscription から抽出
 *   2. user_id を resolve（metadata 優先、無ければ既存 row の customer_id 経由）
 *   3. subscriptions テーブルに upsert (stripe_subscription_id UNIQUE)
 *   4. profiles.plan を全 subscription 行から導出した effective plan に同期
 * を行う。RLS を bypass するため service_role client を使う。
 *
 * 重要な API 仕様 (Stripe API version 2026-05-27.dahlia):
 *   - `current_period_start` / `current_period_end` は **Subscription root から
 *     削除済み**。`subscription.items.data[].current_period_start/end` に移動。
 *     1 plan = 1 item 前提なので items.data[0] を読む。
 *
 * BILLING-04 (Checkout) との契約:
 *   - Checkout Session 作成時に
 *       subscription_data.metadata = { app_user_id: <auth.uid()> }
 *     を必ず設定する。webhook はまずここから user_id を読む。
 *   - 補助的 fallback として client_reference_id にも同 user_id を入れる。
 */

import 'server-only';

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getPlanFromPriceId } from '@/lib/stripe/server';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import { isPlanId, type PlanId } from './plans';

/** profiles.plan に入る effective plan の取りうる値。 */
export type EffectivePlan = 'free' | PlanId;

/** webhook 側で結果を観測 / ログに残せるよう discriminated union を返す。 */
export type SyncResult =
  | { kind: 'ok'; userId: string; plan: PlanId; effectivePlan: EffectivePlan }
  | { kind: 'no-user-id'; customerId: string; subscriptionId: string }
  | { kind: 'unknown-plan'; subscriptionId: string; priceId: string }
  | { kind: 'no-items'; subscriptionId: string }
  | { kind: 'db-error'; message: string };

const METADATA_USER_ID_KEY = 'app_user_id';

export async function syncSubscriptionFromStripe(
  sub: Stripe.Subscription,
): Promise<SyncResult> {
  const supabase = getServiceRoleSupabaseClient();

  const subscriptionId = sub.id;
  const customerId =
    typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const status = sub.status;
  const cancelAtPeriodEnd = sub.cancel_at_period_end;

  // API 2026-05-27.dahlia: period は item 側。1 plan = 1 item 前提。
  const item = sub.items.data[0];
  if (!item) {
    return { kind: 'no-items', subscriptionId };
  }

  const priceId =
    typeof item.price === 'string' ? item.price : item.price.id;
  const plan = getPlanFromPriceId(priceId);
  if (!plan) {
    return { kind: 'unknown-plan', subscriptionId, priceId };
  }

  const currentPeriodStart = unixSecondsToIso(item.current_period_start);
  const currentPeriodEnd = unixSecondsToIso(item.current_period_end);

  const userId = await resolveUserId({
    supabase,
    sub,
    customerId,
  });
  if (!userId) {
    return { kind: 'no-user-id', customerId, subscriptionId };
  }

  const { error: upsertErr } = await supabase
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        plan,
        status,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        cancel_at_period_end: cancelAtPeriodEnd,
      },
      { onConflict: 'stripe_subscription_id' },
    );
  if (upsertErr) {
    return {
      kind: 'db-error',
      message: `subscriptions upsert failed: ${upsertErr.message}`,
    };
  }

  const profileSync = await syncProfilePlan({ supabase, userId });
  if (profileSync.error) {
    // profiles.plan は planGate が読む権利の正本。書けなかった場合は
    // 課金済みでも free 扱いになるため、transient 扱いで 500 → Stripe 再送に委ねる。
    return {
      kind: 'db-error',
      message: `profiles plan update failed: ${profileSync.error}`,
    };
  }

  return { kind: 'ok', userId, plan, effectivePlan: profileSync.effectivePlan };
}

function unixSecondsToIso(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  return new Date(seconds * 1000).toISOString();
}

async function resolveUserId(input: {
  supabase: SupabaseClient;
  sub: Stripe.Subscription;
  customerId: string;
}): Promise<string | null> {
  // 1. subscription.metadata.app_user_id（BILLING-04 Checkout で設定）
  const meta = input.sub.metadata?.[METADATA_USER_ID_KEY];
  if (typeof meta === 'string' && meta.length > 0) return meta;

  // 2. 既存 row の customer_id 経由（Dashboard 手動操作や metadata 落ち時の保険）
  const { data, error } = await input.supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', input.customerId)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data?.user_id as string | undefined) ?? null;
}

async function syncProfilePlan(input: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<{ effectivePlan: EffectivePlan; error: string | null }> {
  const { data: rows } = await input.supabase
    .from('subscriptions')
    .select('plan, status, current_period_end, cancel_at_period_end')
    .eq('user_id', input.userId);

  const effectivePlan = deriveEffectivePlan(rows ?? []);

  // profiles.plan は §24 trigger により anon/authenticated は書けない。
  // service_role はスルーなのでこの UPDATE は通る。
  const { error } = await input.supabase
    .from('profiles')
    .update({ plan: effectivePlan })
    .eq('id', input.userId);

  return { effectivePlan, error: error ? error.message : null };
}

type SubscriptionRow = {
  plan: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

/**
 * 全 subscription 行から "今 user に有効なプラン" を導出する。
 * - active / trialing / past_due は権利あり（past_due は Stripe の dunning 期間、
 *   通常は数日間アクセス維持される）。
 * - canceled でも current_period_end が未来なら grace period として権利維持。
 * - cancel_at_period_end=true は解約予約だが period_end までは権利あり。
 * - 複数候補があれば premium > basic > free の順で勝つ。
 */
export function deriveEffectivePlan(rows: SubscriptionRow[]): EffectivePlan {
  const now = Date.now();
  let hasPremium = false;
  let hasBasic = false;

  for (const row of rows) {
    if (!isPlanId(row.plan)) continue;

    const periodEndMs = row.current_period_end
      ? new Date(row.current_period_end).getTime()
      : 0;
    const inActiveStatus =
      row.status === 'active' ||
      row.status === 'trialing' ||
      row.status === 'past_due';
    const inGracePeriod =
      (row.status === 'canceled' || row.cancel_at_period_end) &&
      periodEndMs > now;

    if (inActiveStatus || inGracePeriod) {
      if (row.plan === 'premium') hasPremium = true;
      else if (row.plan === 'basic') hasBasic = true;
    }
  }

  if (hasPremium) return 'premium';
  if (hasBasic) return 'basic';
  return 'free';
}
