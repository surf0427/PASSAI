/**
 * Server-side Supabase client boundary (SSR-safe).
 *
 * - Per-request scope. A fresh client is built on each call so that the
 *   bound cookie store matches the current request. The Supabase SSR
 *   guidance is explicit: never share a server client across requests.
 * - Returns `null` whenever env is missing. Callers must treat `null` as
 *   "mirror disabled / no-op skip" (Phase1 contract).
 * - No feature-specific logic, no mirror logic, no schema knowledge here.
 * - Only `lib/supabase/env.ts` is used to resolve env. No direct
 *   `process.env` access. Server-only secrets (e.g. service-role) are not
 *   read in Phase1 and are not exposed by this boundary.
 *
 * IMPORTANT: This module imports `next/headers` and is for server contexts
 * only (route handlers, server components, server-only utilities). It must
 * NEVER be imported from a browser bundle / `"use client"` module. The
 * cross-environment counterpart is `lib/supabase/browserClient.ts`; these
 * two files must not import each other.
 *
 * Phase1 status: nothing in the app imports this file yet. It is staged so
 * that the first server-side mirror integration lands without touching env
 * or singleton policy again.
 *
 * See: docs/supabase/client_boundary.md §5, §6, §7, §8.
 */

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

export async function getServerSupabaseClient(): Promise<SupabaseClient | null> {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a server component where cookies cannot be set.
          // Safe to ignore: a future middleware will refresh sessions.
        }
      },
    },
  });
}
