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

/**
 * メール確認 / OTP マジックリンクの戻り先 URL。
 *
 * - STEP-SUPABASE-IDENTITY-02: クロスデバイスログインの着地点 `/auth/callback`。
 * - SSR / window が無い文脈では undefined を返す（Supabase は Site URL に
 *   フォールバックする）。本 helper を呼ぶのは browser-only な "use client"
 *   経路のみだが、防御的に SSR ガードする。
 */
export function authCallbackUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}/auth/callback`;
}

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

export type SignInWithEmailOtpResult =
  | { kind: "ok" }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * STEP-SUPABASE-IDENTITY-02: 登録済みメール宛に OTP マジックリンクを送る。
 *
 * 目的: 別端末で同じメールから **既存の auth.users.id に復帰** するための
 * ログイン入口。クリック後の着地は `/auth/callback`（exchangeCodeForSession）。
 *
 * 契約:
 *   - `shouldCreateUser: false` を必ず指定する。未登録メールで新規ユーザーを
 *     増やさない（知らないメールはログイン対象外）。
 *   - 本関数は **リンクを送るだけ**。現在のセッション（匿名 / 既存）は変更しない
 *     ＝ 呼んだだけで勝手にログアウトしない。セッション切替はリンク click 後の
 *     callback で起きる。
 *   - never throw。discriminated result を返す。
 *   - 未登録メールの扱い（Supabase が error を返すか success を返すか）は
 *     設定依存のため、UI 側は一般化した文言で表示する責務を持つ
 *     （メール列挙攻撃の手掛かりを与えない）。
 */
export async function signInWithEmailOtp(
  email: string,
): Promise<SignInWithEmailOtpResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    devWarn("[auth] signInWithEmailOtp: no env");
    return { kind: "no-env" };
  }

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: authCallbackUrl(),
        shouldCreateUser: false,
      },
    });
    if (error) {
      devWarn("[auth] signInWithEmailOtp error", error);
      return {
        kind: "error",
        message: error.message ?? "ログインリンクの送信に失敗しました。",
      };
    }
    return { kind: "ok" };
  } catch (err) {
    devWarn("[auth] signInWithEmailOtp threw", err);
    const message =
      err instanceof Error ? err.message : "ログインリンクの送信に失敗しました。";
    return { kind: "error", message };
  }
}
