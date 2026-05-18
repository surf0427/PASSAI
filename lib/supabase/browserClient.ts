"use client";

/**
 * Browser-side Supabase client boundary.
 *
 * - Singleton per tab/process. Callers invoke `getBrowserSupabaseClient()`
 *   on each use and MUST NOT retain the returned reference long-term — the
 *   boundary owns the lifecycle (kill-switch / disable / replace).
 * - Returns `null` whenever env is missing. Callers must treat `null` as
 *   "mirror disabled / no-op skip" (Phase1 contract).
 * - No feature-specific logic, no mirror logic, no auth flows, no
 *   persistence here. This file is pure boundary plumbing.
 * - Only `lib/supabase/env.ts` is used to resolve env. No direct
 *   `process.env` access.
 *
 * Must only be imported from `"use client"` modules / browser-only code.
 * See: docs/supabase/client_boundary.md §5, §6, §8.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

let client: SupabaseClient | null | undefined;

export function getBrowserSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    client = null;
    return client;
  }

  client = createBrowserClient(url, anonKey);
  return client;
}
