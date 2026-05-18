/**
 * Supabase environment-variable access boundary.
 *
 * - Centralizes every read of `NEXT_PUBLIC_SUPABASE_*` so the rest of the
 *   codebase never touches `process.env.SUPABASE_*` directly.
 * - Phase1: missing env is a normal state (mirror simply becomes a no-op skip).
 *   This module therefore does NOT throw on import or on first call.
 * - Values are evaluated lazily once and cached. We do not observe env
 *   mutation at runtime.
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
