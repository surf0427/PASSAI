"use client";

/**
 * Anonymous-auth helper (STEP-AUTH-01 / AUTH DEBUG FIX 01).
 *
 * - Browser-only boundary on top of `getBrowserSupabaseClient()`.
 * - Never throws. Returns a discriminated result so callers can distinguish
 *   "no env", "auth error", and "success".
 * - In development, swallowed Supabase errors are also surfaced via
 *   `devWarn` so the Console exposes the root cause without leaking to
 *   production builds.
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";

export type EnsureAnonymousUserResult =
  | { kind: "ok"; userId: string }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

let inflight: Promise<EnsureAnonymousUserResult> | null = null;

async function resolveAnonymousUserId(): Promise<EnsureAnonymousUserResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    devWarn("[auth] getBrowserSupabaseClient() returned null (env missing)");
    return { kind: "no-env" };
  }

  // 1. 既存 session があればそれを使う。
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data?.user?.id) {
      return { kind: "ok", userId: data.user.id };
    }
    if (error) {
      // session が無い場合は AuthSessionMissingError が返るのが正常系。
      // ここでは debug 用に warn にとどめ、signInAnonymously へフォールスルー。
      devWarn("[auth] getUser returned error (will try signInAnonymously)", error);
    }
  } catch (err) {
    devWarn("[auth] getUser threw (will try signInAnonymously)", err);
  }

  // 2. signInAnonymously で新規 anonymous user を発行。
  try {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      devWarn("[auth] signInAnonymously error", error);
      return {
        kind: "error",
        message: error.message ?? "signInAnonymously failed",
      };
    }
    if (!data?.user?.id) {
      devWarn("[auth] signInAnonymously returned no user");
      return {
        kind: "error",
        message: "signInAnonymously returned no user",
      };
    }
    return { kind: "ok", userId: data.user.id };
  } catch (err) {
    devWarn("[auth] signInAnonymously threw", err);
    const message =
      err instanceof Error ? err.message : "signInAnonymously threw";
    return { kind: "error", message };
  }
}

export function ensureAnonymousUser(): Promise<EnsureAnonymousUserResult> {
  if (inflight) return inflight;
  inflight = resolveAnonymousUserId().finally(() => {
    inflight = null;
  });
  return inflight;
}
