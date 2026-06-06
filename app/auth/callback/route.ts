// STEP-SUPABASE-IDENTITY-02 / 05: Supabase auth callback。
//
// 役割:
//   メール経由（OTP マジックリンク / email-change 確認）の着地点。
//   Supabase Dashboard の Email Template 設定により、callback には 2 形式の
//   いずれかで到達し得るため、両方を吸収する:
//
//     (1) `?code=...`                     … {{ .ConfirmationURL }} / PKCE 経路。
//                                            exchangeCodeForSession で交換。
//     (2) `?token_hash=...&type=...`       … {{ .TokenHash }} テンプレ経路。
//                                            verifyOtp で検証。
//
//   いずれも成功でセッション cookie が確立し、以降 getUser() が同一
//   auth.users.id を返す（クロスデバイス復帰の成立条件）。
//
// 設計:
//   - cookie 書き込みは既存 getServerSupabaseClient（@supabase/ssr の setAll）
//     に委譲。route handler 文脈では cookie 変更が応答に反映される。
//   - never throw。失敗・欠落・不正 type はすべて
//     /account/email?error=auth_callback へ redirect。
//   - 成功は /mypage へ redirect。
//   - 匿名認証フロー・AuthProvider には非干渉（明示リンク click 経由のみ）。

import { NextResponse } from 'next/server';

import { captureRouteException } from '@/lib/sentry/capture';
import { getServerSupabaseClient } from '@/lib/supabase/serverClient';

// verifyOtp に渡してよい email OTP type の allowlist。
// EmailOtpType は `(string & {})` を含み任意文字列を許すため、ここで明示的に
// 絞り込み、不明な type は error redirect に倒す（型安全 + 入力検証）。
const ALLOWED_OTP_TYPES = [
  'email',
  'signup',
  'magiclink',
  'recovery',
  'invite',
  'email_change',
] as const;

type AllowedOtpType = (typeof ALLOWED_OTP_TYPES)[number];

function isAllowedOtpType(value: string | null): value is AllowedOtpType {
  return (
    value !== null && (ALLOWED_OTP_TYPES as readonly string[]).includes(value)
  );
}

export async function GET(request: Request): Promise<Response> {
  const t0 = Date.now();
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const code = requestUrl.searchParams.get('code');
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const type = requestUrl.searchParams.get('type');

  const errorRedirect = NextResponse.redirect(
    `${origin}/account/email?error=auth_callback`,
  );

  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return errorRedirect;
  }

  // (1) code 形式（既存挙動。PKCE / {{ .ConfirmationURL }}）。
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Sentry: code 交換失敗。code 値・token は送らず error code とメタのみ。
      captureRouteException(
        error,
        { route: 'auth/callback', feature: 'auth', status: error.status ?? 'error' },
        { status: error.status, code: error.code ?? 'exchange_code_failed', durationMs: Date.now() - t0 },
      );
      return errorRedirect;
    }
    return NextResponse.redirect(`${origin}/mypage`);
  }

  // (2) token_hash + 許可された type 形式（{{ .TokenHash }} テンプレ）。
  //     ここで type は AllowedOtpType に narrow される。
  if (tokenHash && isAllowedOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error) {
      // Sentry: OTP 検証失敗。token_hash・type 値は送らず error code とメタのみ。
      captureRouteException(
        error,
        { route: 'auth/callback', feature: 'auth', status: error.status ?? 'error' },
        { status: error.status, code: error.code ?? 'verify_otp_failed', durationMs: Date.now() - t0 },
      );
      return errorRedirect;
    }
    return NextResponse.redirect(`${origin}/mypage`);
  }

  // code も (token_hash + 正当な type) も無い / 不明 type → error。
  return errorRedirect;
}
