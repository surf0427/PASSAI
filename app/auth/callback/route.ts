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
//     /login?error=auth_callback へ redirect。
//   - 成功は /home へ redirect（未課金は client 側 PlanGate が /pricing へ送る）。
//   - 匿名認証フロー・AuthProvider には非干渉（明示リンク click 経由のみ）。

import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';

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

// 認証成功後の遷移先。login の sanitizeNext と同じ規則で、同一オリジンの
// 相対パスのみ許可する（open-redirect 防止）。不正・欠落は /home にフォールバック。
function sanitizeNextPath(raw: string | null): string {
  if (!raw) return '/home';
  if (!raw.startsWith('/')) return '/home';
  if (raw.startsWith('//')) return '/home';
  if (raw.startsWith('/\\')) return '/home';
  return raw;
}

// 一時ログ（TODO: 確認後に削除）。生メール禁止・id / boolean / provider のみ。
// callback が確立したセッションが匿名 A か email user E かを実測し、checkout が見る
// userId（[checkout-auth-debug]）と突き合わせて session 引き継ぎの成否を確定する。
function logCallbackAuth(path: 'code' | 'token_hash', user: User | null): void {
  console.warn('[callback-auth-debug]', {
    path,
    establishedUserId: user?.id ?? null,
    establishedIsAnonymous: user?.is_anonymous ?? null,
    establishedHasEmail: Boolean(user?.email),
    identitiesCount: user?.identities?.length ?? 0,
    providers: user?.identities?.map((i) => i.provider) ?? [],
  });
}

export async function GET(request: Request): Promise<Response> {
  const t0 = Date.now();
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const code = requestUrl.searchParams.get('code');
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const type = requestUrl.searchParams.get('type');
  // ログイン前に選択したプラン等の意図を保持する遷移先（マジックリンク経路でも
  // コード入力経路と同じく safeNext に着地させる）。
  const safeNext = sanitizeNextPath(requestUrl.searchParams.get('next'));

  // 一時ログ（TODO: 確認後に削除）。route が実行されたか自体を最上位で記録する。
  // 出ない = /auth/callback が呼ばれていない（client の OTP コード経路でログイン等）。
  // 出るのに [callback-auth-debug] が出ない = errorRedirect 分岐に入っている。
  // type は OTP 種別の文字列でメール等の機微情報ではない。
  console.warn('[callback-entry]', {
    hasCode: Boolean(code),
    hasTokenHash: Boolean(tokenHash),
    type: type ?? null,
    hasNext: Boolean(requestUrl.searchParams.get('next')),
  });

  const errorRedirect = NextResponse.redirect(
    `${origin}/login?error=auth_callback`,
  );

  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return errorRedirect;
  }

  // (1) code 形式（既存挙動。PKCE / {{ .ConfirmationURL }}）。
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Sentry: code 交換失敗。code 値・token は送らず error code とメタのみ。
      captureRouteException(
        error,
        { route: 'auth/callback', feature: 'auth', status: error.status ?? 'error' },
        { status: error.status, code: error.code ?? 'exchange_code_failed', durationMs: Date.now() - t0 },
      );
      return errorRedirect;
    }
    logCallbackAuth('code', data.user ?? data.session?.user ?? null);
    return NextResponse.redirect(`${origin}${safeNext}`);
  }

  // (2) token_hash + 許可された type 形式（{{ .TokenHash }} テンプレ）。
  //     ここで type は AllowedOtpType に narrow される。
  if (tokenHash && isAllowedOtpType(type)) {
    const { data, error } = await supabase.auth.verifyOtp({
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
    logCallbackAuth('token_hash', data.user ?? data.session?.user ?? null);
    return NextResponse.redirect(`${origin}${safeNext}`);
  }

  // code も (token_hash + 正当な type) も無い / 不明 type → error。
  return errorRedirect;
}
