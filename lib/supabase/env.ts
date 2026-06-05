/**
 * Supabase environment-variable access boundary.
 *
 * - Centralizes every read of `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_*` so the
 *   rest of the codebase never touches `process.env.SUPABASE_*` directly.
 * - Phase1: missing env is a normal state (mirror simply becomes a no-op skip).
 *   This module therefore does NOT throw on import or on first call.
 * - Values are evaluated lazily once and cached. We do not observe env
 *   mutation at runtime.
 * - **Service role key** (STEP-BILLING-02 で追加):
 *     - `SUPABASE_SERVICE_ROLE_KEY` は server-only secret。`NEXT_PUBLIC_` prefix
 *       を持たないため Next.js は client bundle に inline しない。
 *     - 本 module を client が import しても `process.env.SUPABASE_SERVICE_ROLE_KEY`
 *       は browser では undefined のまま → `getSupabaseServiceRoleKey()` は null を返す。
 *     - 実際の consumer (`serviceRoleClient.ts`) 側で `import 'server-only'` で
 *       browser bundle 混入を build error にする多段防御。
 *
 * See: docs/supabase/client_boundary.md §7, docs/supabase/phase1_runtime_strategy.md §9.
 */

export type SupabaseEnv = {
  url: string;
  anonKey: string;
};

let cached: SupabaseEnv | null | undefined;

function readEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function getSupabaseEnv(): SupabaseEnv | null {
  if (cached === undefined) cached = readEnv();
  return cached;
}

export function getSupabaseUrl(): string | null {
  return getSupabaseEnv()?.url ?? null;
}

export function getSupabaseAnonKey(): string | null {
  return getSupabaseEnv()?.anonKey ?? null;
}

export function isSupabaseEnvAvailable(): boolean {
  return getSupabaseEnv() !== null;
}

/**
 * Service role key reader (server-only).
 *
 * - 戻り値が null の場合: 未設定、または browser bundle 経由（NEXT_PUBLIC_
 *   prefix が無いので browser では常に undefined）。
 * - 呼び出し側で必須なら null チェック後に throw すること。本 module 自身は
 *   `env.ts` の "throw しない" 既存契約を保つため throw しない。
 * - 唯一の consumer は `lib/supabase/serviceRoleClient.ts`。それ以外から
 *   import しないこと（service role を扱う module を一箇所に閉じる）。
 */
export function getSupabaseServiceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}
