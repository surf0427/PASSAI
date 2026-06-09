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
  | {
      kind: "ok";
      userId: string;
      /**
       * STEP-AUTH-P0: 確定した auth.users.email。匿名ユーザーは null。
       * UI の「永続ユーザー判定 / ログイン誘導」に使う（認証キーではない）。
       */
      email: string | null;
      /** STEP-AUTH-P0: auth.users.is_anonymous。匿名なら true。 */
      isAnonymous: boolean;
    }
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
export function authCallbackUrl(next?: string | null): string | undefined {
  if (typeof window === "undefined") return undefined;
  const base = `${window.location.origin}/auth/callback`;
  // next（同一オリジン相対パス、呼び出し側で sanitize 済み前提）を載せて、
  // マジックリンク経由でもコード入力経路と同じ遷移先に着地させる。
  // next 値自体が ?plan=... を含むため 1 段 encode して query 値に載せる。
  if (next && next.startsWith("/")) {
    return `${base}?next=${encodeURIComponent(next)}`;
  }
  return base;
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
      // STEP-AUTH-P0: permanent / anonymous の判定材料を一緒に返す。
      // メールログイン済み（permanent）なら user.email が入り is_anonymous は
      // false/undefined。匿名のままなら email=null / is_anonymous=true。
      return {
        kind: "ok",
        userId: data.user.id,
        email: data.user.email ?? null,
        isAnonymous: data.user.is_anonymous ?? false,
      };
    }
    if (error) {
      // session が無い場合は AuthSessionMissingError が返るのが正常系。
      // ここでは debug 用に warn にとどめ、signInAnonymously へフォールスルー。
      devWarn("[auth] getUser returned error (will try signInAnonymously)", error);
    }
  } catch (err) {
    devWarn("[auth] getUser threw (will try signInAnonymously)", err);
  }

  // 1.5. getSession() ガード。
  //   getUser() は network 検証のため一過性失敗で error/null を返し得る。その直後に
  //   signInAnonymously() すると、verifyEmailOtp 直後にフル遷移してきた permanent
  //   session（cookie に存在）を、新規 anonymous user で上書きしてしまう。
  //   そこで匿名発行の前に getSession()（storage 読み・network 不要）を確認し、
  //   既存 session があればそれを採用して匿名の新規発行を行わない。
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData.session?.user;
    if (sessionUser?.id) {
      return {
        kind: "ok",
        userId: sessionUser.id,
        email: sessionUser.email ?? null,
        isAnonymous: sessionUser.is_anonymous ?? false,
      };
    }
  } catch (err) {
    devWarn("[auth] getSession threw (will try signInAnonymously)", err);
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
    // 新規発行直後は必ず匿名・email なし。
    return {
      kind: "ok",
      userId: data.user.id,
      email: data.user.email ?? null,
      isAnonymous: data.user.is_anonymous ?? true,
    };
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
 *   - 既定では `shouldCreateUser: false`。未登録メールで新規ユーザーを
 *     増やさない（知らないメールはログイン対象外＝/account/email の「別端末から
 *     続ける」用途）。
 *   - STEP-AUTH-P0: `allowSignup: true` を渡すと `shouldCreateUser: true` になり、
 *     未登録メールでも新規アカウントを発行する。これは課金前ログイン（/login）の
 *     ように「初回購入者の新規登録」と「既存ユーザーの別端末ログイン」を
 *     同一入口で扱う用途のためのフラグ。display_user_id は認証キーにしない原則は
 *     不変（identity は常に auth.users.id / email）。
 *   - 送信前に **ローカルセッションを破棄** する。匿名セッションが残ったまま
 *     `signInWithOtp` を呼ぶと、Supabase がこれを「現在の(匿名)ユーザーへの
 *     email 追加＝メール変更」と解釈し、ログイン用 OTP ではなく
 *     「Confirm your new email address」確認メールを送ってしまうため
 *     （未認証状態で叩くと正しい sign-in OTP / マジックリンクが届く）。
 *     セッション確立は (a) リンク click 後の `/auth/callback`、または
 *     (b) `verifyEmailOtp()` でコード検証したときに起きる。
 *   - never throw。discriminated result を返す。
 *   - 未登録メールの扱い（Supabase が error を返すか success を返すか）は
 *     設定依存のため、UI 側は一般化した文言で表示する責務を持つ
 *     （メール列挙攻撃の手掛かりを与えない）。
 */
export async function signInWithEmailOtp(
  email: string,
  options?: { allowSignup?: boolean; next?: string | null },
): Promise<SignInWithEmailOtpResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    devWarn("[auth] signInWithEmailOtp: no env");
    return { kind: "no-env" };
  }

  // 匿名セッションが残っていると signInWithOtp が「メール変更」と解釈され、
  // 「Confirm your new email address」が送られてしまう。ログイン用 OTP を
  // 送るため、送信前にローカルセッションだけ破棄して未認証状態にする。
  // （匿名ユーザーのデータは localStorage が正本で AuthProvider が再 backfill するため、
  //   ここでローカルセッションを切っても利用者視点のデータ欠落は起きない）
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (err) {
    devWarn("[auth] signInWithEmailOtp: local signOut before OTP failed (continuing)", err);
  }

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: authCallbackUrl(options?.next),
        shouldCreateUser: options?.allowSignup ?? false,
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

export type VerifyEmailOtpResult =
  | { kind: "ok"; userId: string; email: string | null }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * STEP-AUTH-P0: メールに届いた 6 桁 OTP コードを検証してセッションを確立する。
 *
 * 目的: マジックリンク（/auth/callback 経路）と同じ「同一 auth.users.id への
 * 復帰 / 永続アカウント確立」を、メールアプリ往復なしの **コード入力** で完結
 * させる（離脱低減）。`/login` の主経路。
 *
 * 契約:
 *   - `verifyOtp({ email, token, type: 'email' })` を呼ぶ。成功すると browser
 *     supabase client がセッションを cookie / localStorage に永続化するため、
 *     以降サーバー（checkout route 等）でも同一 user が見える。
 *   - 成功で現在のセッションは検証したメールの user に切り替わる。匿名セッション
 *     だった場合はそのメールの永続ユーザーへ移る（identity = auth.users.id）。
 *   - never throw。discriminated result を返す。
 *   - コードは Supabase の Email テンプレートに `{{ .Token }}` が含まれる場合に
 *     届く。テンプレートがリンクのみの構成なら、ユーザーはリンク経由
 *     （/auth/callback）でログインする。両経路とも同じ user_id に着地する。
 */
export async function verifyEmailOtp(
  email: string,
  token: string,
): Promise<VerifyEmailOtpResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    devWarn("[auth] verifyEmailOtp: no env");
    return { kind: "no-env" };
  }

  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: token.trim(),
      type: "email",
    });
    if (error || !data?.user?.id) {
      devWarn("[auth] verifyEmailOtp error", error ?? "(no user)");
      return {
        kind: "error",
        message:
          error?.message ?? "コードを確認できませんでした。再度お試しください。",
      };
    }
    return {
      kind: "ok",
      userId: data.user.id,
      email: data.user.email ?? null,
    };
  } catch (err) {
    devWarn("[auth] verifyEmailOtp threw", err);
    const message =
      err instanceof Error ? err.message : "コードの確認に失敗しました。";
    return { kind: "error", message };
  }
}
