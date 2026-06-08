"use client";

/**
 * メールアドレスの形式バリデーション（pure 関数）。
 *
 * 旧 STEP-AUTH-EMAIL-OPTIN-01 の任意メール登録 helper（requestEmailChange）は、
 * メール OTP を正式ログイン導線に一本化し /account/email を廃止したため削除済み。
 * 現在この module は /login 等の「送信前」入力バリデーションのみを提供する。
 */

/**
 * UI 側の事前バリデーション。Supabase 側の最終バリデーションは別途行われる。
 * 厳密な RFC5322 は使わず、十分な実用バリデーションに留める。
 */
export function isValidEmailFormat(email: string): boolean {
  if (email.length === 0 || email.length > 254) return false;
  // 簡易だが ASCII / 1 つの @ / ドット付きドメインを満たす形式。
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
