/**
 * STEP-BILLING-02: process.env のアンビエント型宣言。
 *
 * - すべての key を optional (`string | undefined`) として宣言する。
 *   ランタイムの実態（未設定 = undefined）を型に反映する。
 * - 各 consumer は必ず presence チェック / バリデータを噛ます:
 *     - Stripe key:        `lib/stripe/server.ts:readStripeSecretKey`
 *     - Stripe Price ID:   `lib/stripe/server.ts:getStripePriceId`
 *     - Supabase URL/key:  `lib/supabase/env.ts`
 *     - Service role:      `lib/supabase/serviceRoleClient.ts`
 *     - Anthropic key:     使用箇所で個別チェック
 * - 本ファイルは型のみ。実行時 import なし。`export {}` で global module 化
 *   して既存の `NodeJS.ProcessEnv` 宣言を augment する。
 */

declare namespace NodeJS {
  interface ProcessEnv {
    // Anthropic
    readonly ANTHROPIC_API_KEY?: string;

    // Supabase
    readonly NEXT_PUBLIC_SUPABASE_URL?: string;
    readonly NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
    /** server-only secret. NEXT_PUBLIC_ prefix なし → browser bundle に inline されない。 */
    readonly SUPABASE_SERVICE_ROLE_KEY?: string;

    // Supabase mirror / observability kill-switches
    readonly NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED?: string;
    readonly NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED?: string;

    // Stripe (test mode only — sk_live_* は lib/stripe/server.ts で runtime refuse)
    readonly STRIPE_SECRET_KEY?: string;
    readonly NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
    readonly STRIPE_PRICE_ID_BASIC?: string;
    readonly STRIPE_PRICE_ID_PREMIUM?: string;
    /** STEP-BILLING-03 で webhook 実装時に追加予定。 */
    readonly STRIPE_WEBHOOK_SECRET?: string;

    // App / observability
    readonly NEXT_PUBLIC_APP_URL?: string;
    readonly NEXT_PUBLIC_APP_COMMIT?: string;
    readonly NEXT_PUBLIC_VERCEL_ENV?: string;
  }
}

export {};
