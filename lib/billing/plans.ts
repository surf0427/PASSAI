/**
 * STEP-BILLING-02: 課金プランのカタログ（pure constants）。
 *
 * - client / server 双方から import 可能。env reads を含まないこと。
 * - 実 Stripe Price ID は server 側 helper (`lib/stripe/server.ts` の
 *   `getStripePriceId`) でのみ解決する。env 名のマッピングだけここに置く。
 * - 無料プランは存在しない（`free` は契約のない状態を `profiles.plan` の
 *   default 値で表現する。subscriptions table の plan は basic / premium のみ）。
 */

export const PLAN_IDS = ['basic', 'premium'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type PlanConfig = {
  id: PlanId;
  label: string;
  priceJpy: number;
  /** server-side でのみ参照する env 変数名。client から process.env を引かない。 */
  stripePriceIdEnvName: 'STRIPE_PRICE_ID_BASIC' | 'STRIPE_PRICE_ID_PREMIUM';
};

export const PLANS: Record<PlanId, PlanConfig> = {
  basic: {
    id: 'basic',
    label: 'Basic',
    priceJpy: 2980,
    stripePriceIdEnvName: 'STRIPE_PRICE_ID_BASIC',
  },
  premium: {
    id: 'premium',
    label: 'Premium',
    priceJpy: 4980,
    stripePriceIdEnvName: 'STRIPE_PRICE_ID_PREMIUM',
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return (
    typeof value === 'string' &&
    (PLAN_IDS as readonly string[]).includes(value)
  );
}
