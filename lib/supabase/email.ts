"use client";

/**
 * STEP-AUTH-EMAIL-OPTIN-01: 任意メール登録の境界 helper。
 *
 * - 保存先は **`auth.users.email`**（Supabase 標準の identity 列）。
 *   `profiles` テーブルへの列追加はしない（`docs/supabase/phase2_auth_boundary.md`
 *   §5.3 の禁止事項に該当するため）。
 * - 呼び出しは `supabase.auth.updateUser({ email })`。これは即時保存ではなく
 *   **email change の確認メール送信を要求** するだけで、ユーザーが確認リンクを
 *   開いて初めて `auth.users.email` が更新される。
 *   それまでは `auth.users.email_change` に新しいアドレスが保留される。
 *   匿名 session は確認完了まで維持され、UX 上のログイン強制は発生しない。
 * - バリデーションは呼び出し側責務（UI で前段チェック済み想定）。
 * - 失敗時は discriminated union で返す。throw しない。
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";

export type RequestEmailChangeResult =
  | { kind: "ok" }
  | { kind: "no-env" }
  | { kind: "not-authenticated" }
  | { kind: "error"; message: string };

/**
 * 任意メール登録の本体。
 *
 * 命名は **「保存」ではなく「変更を要求」** にしている。これは Supabase の
 * `auth.updateUser({ email })` が confirmation flow の起点であり、即時の
 * persist では無いため。UI 側もこの差分に合わせて「確認メール送信済み」
 * を success 文言として表示する。
 */
export async function requestEmailChange(input: {
  email: string;
}): Promise<RequestEmailChangeResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  try {
    // 事前に session の存在を確認しておく。anonymous session が無いまま
    // updateUser を呼ぶと "AuthSessionMissingError" になるので、UI に分かる
    // 形でエラーを返す。
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      devWarn(
        "[email] requestEmailChange: no auth session",
        userErr ?? "(no user)",
      );
      return { kind: "not-authenticated" };
    }

    const { error } = await supabase.auth.updateUser({ email: input.email });
    if (error) {
      devWarn("[email] requestEmailChange updateUser error", error);
      return {
        kind: "error",
        message: error.message ?? "確認メールの送信に失敗しました。",
      };
    }
    return { kind: "ok" };
  } catch (err) {
    devWarn("[email] requestEmailChange threw", err);
    const message =
      err instanceof Error ? err.message : "確認メールの送信に失敗しました。";
    return { kind: "error", message };
  }
}

/**
 * UI 側の事前バリデーション。Supabase 側の最終バリデーションは別途行われる。
 * 厳密な RFC5322 は使わず、十分な実用バリデーションに留める。
 */
export function isValidEmailFormat(email: string): boolean {
  if (email.length === 0 || email.length > 254) return false;
  // 簡易だが ASCII / 1 つの @ / ドット付きドメインを満たす形式。
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
