/**
 * STEP-BILLING-02: Supabase service_role client 境界（server-only）。
 *
 * 用途:
 *   - Stripe webhook が `subscriptions` / `stripe_events` / `usage_records` /
 *     `profiles.plan` を更新するため RLS を bypass する必要がある。
 *   - API route 内で AI 呼び出し後に `usage_records` を INSERT する用途も同様。
 *
 * 安全境界:
 *   - `import 'server-only'`: client bundle に紛れたら build error。
 *   - `getSupabaseServiceRoleKey()`: `env.ts` 経由でしか SERVICE_ROLE_KEY を
 *     読まない（環境変数読み手の集約規約）。
 *   - `typeof window !== 'undefined'` runtime guard: server-only 違反を
 *     最後の砦で検出。
 *   - `auth: { autoRefreshToken: false, persistSession: false }`: cookie /
 *     storage に session を残さない（既存 browserClient / serverClient と
 *     パスが分離するので副作用を避ける）。
 *
 * 既存 boundary との関係:
 *   - `browserClient.ts` / `serverClient.ts` は anon key 経由で RLS 配下に
 *     入る user-scoped client。
 *   - 本 module は RLS を bypass する admin-scope client。両者を混同しない。
 *   - 本 module を import してよいのは Stripe webhook handler 等、明示的に
 *     "user 認可境界の外で書く" コンテキストに限る。
 */

import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseServiceRoleKey, getSupabaseUrl } from './env';
import { retryingFetch } from './retryingFetch';

let cached: SupabaseClient | null = null;

export function getServiceRoleSupabaseClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error(
      'service role Supabase client must never be constructed in the browser',
    );
  }

  if (cached) return cached;

  const url = getSupabaseUrl();
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }

  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  cached = createClient(url, serviceRoleKey, {
    // Phase 2: cold start / intermittent network failure 吸収用の
    // timeout + 1回 retry。auth 設定は変更しない。
    global: { fetch: retryingFetch },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
