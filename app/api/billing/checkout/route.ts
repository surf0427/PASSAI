/**
 * STEP-BILLING-04: Stripe Checkout Session 作成 API。
 *
 * 受信:
 *   POST { plan: 'basic' | 'premium' }
 *
 * レスポンス:
 *   200 { url: string }                          → client が window.location で遷移
 *   400 { error: 'invalid-plan' }                → body が不正
 *   400 { error: 'email-required' }              → auth.users.email 未設定 → /account/email へ誘導する責務は client
 *   401 { error: 'unauthenticated' }             → ログインなし
 *   500 { error: 'origin-unresolved' | 'stripe-error', message? }
 *
 * BILLING-03 webhook との契約:
 *   - subscription_data.metadata.app_user_id = userId
 *     ([lib/billing/syncSubscription.ts] の METADATA_USER_ID_KEY と一致)
 *   - client_reference_id = userId  (fallback resolve 経路)
 *
 * Customer 戦略:
 *   - subscriptions に既存行があれば stripe_customer_id を再利用 → 重複 Customer 防止
 *   - 無ければ customer_email を渡して Stripe に Customer 自動生成させる
 *   - 重複 Customer リスク (checkout 中断を繰り返した場合) は test mode で許容。
 *     恒久的解決は profiles.stripe_customer_id 追加で BILLING-05 以降に検討。
 *
 * Runtime:
 *   - nodejs 必須 (Stripe SDK)
 *   - force-dynamic: per-user の checkout なので絶対にキャッシュしない
 */

import 'server-only';

import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import type Stripe from 'stripe';

import { isPlanId } from '@/lib/billing/plans';
import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { getStripeClient, getStripePriceId } from '@/lib/stripe/server';
import { logAuthFail } from '@/lib/supabase/authFailLog';
import { getServerSupabaseClient } from '@/lib/supabase/serverClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 課金メール解決。Magic Link 経由などで top-level `user.email` が null でも、
// `user_metadata.email` / `identities[].identity_data.email` に確定メールが入って
// いるケースがあるため、複数ソースから最初の有効なメールを採用する。
// （server-only route のため client 専用の isValidEmailFormat は import せず、
//   同等の簡易バリデーションをここに inline する。認証方式は不変。）
type CheckoutEmailSource =
  | 'user.email'
  | 'user_metadata.email'
  | 'identity.identity_data.email'
  | 'none';

const CHECKOUT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmailLike(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 254 &&
    CHECKOUT_EMAIL_RE.test(value)
  );
}

function getCheckoutEmail(user: User): {
  email: string | null;
  source: CheckoutEmailSource;
} {
  if (isEmailLike(user.email)) {
    return { email: user.email, source: 'user.email' };
  }
  const metaEmail = user.user_metadata?.email;
  if (isEmailLike(metaEmail)) {
    return { email: metaEmail, source: 'user_metadata.email' };
  }
  for (const identity of user.identities ?? []) {
    const idEmail = identity.identity_data?.email;
    if (isEmailLike(idEmail)) {
      return { email: idEmail, source: 'identity.identity_data.email' };
    }
  }
  return { email: null, source: 'none' };
}

// ログ用 masked email（生メールは出さない）。先頭1文字 + ドメインのみ残す。
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}

export async function POST(req: Request) {
  const t0 = Date.now();
  // 1. body parse
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }
  const planRaw = (body as { plan?: unknown })?.plan;
  if (!isPlanId(planRaw)) {
    return NextResponse.json({ error: 'invalid-plan' }, { status: 400 });
  }
  const plan = planRaw;

  // 2. auth (user-scoped client, RLS 配下)
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'supabase-unavailable' },
      { status: 500 },
    );
  }

  const tAuth = Date.now();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    // Phase 0 instrumentation: 「401 + 10秒待ち」が ConnectTimeoutError 由来か
    // 本物の未認証かを切り分ける。既存挙動 (401 を返す) は変更しない。
    logAuthFail({
      route: 'billing/checkout',
      feature: 'checkout',
      phase: 'getUser',
      err: userErr ?? null,
      hasUser: Boolean(userData?.user),
      elapsedMs: Date.now() - tAuth,
    });
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userData.user.id;
  // top-level user.email だけでなく user_metadata / identities も見て解決する。
  const resolved = getCheckoutEmail(userData.user);
  const email = resolved.email;

  // 一時診断ログ（TODO: 根本原因確認後に削除）。生メールは出さず masked / boolean のみ。
  // email が user.email・user_metadata・identities のどこに入っているかを確認する。
  console.warn('[checkout][email-resolve]', {
    user_id: userId,
    has_user_email: Boolean(userData.user.email),
    is_anonymous: userData.user.is_anonymous ?? null,
    app_metadata_provider: userData.user.app_metadata?.provider ?? null,
    user_metadata_keys: Object.keys(userData.user.user_metadata ?? {}),
    identity_providers: (userData.user.identities ?? []).map((i) => i.provider),
    has_identity_email: (userData.user.identities ?? []).some((i) =>
      isEmailLike(i.identity_data?.email),
    ),
    resolved_source: resolved.source,
    resolved_email_masked: email ? maskEmail(email) : null,
  });

  if (!email) {
    // 全ソースに有効な email が無い（真の匿名 / 未確定）。Stripe Customer が
    // email を持てず receipt / Portal が機能しないため、メール OTP ログインを促す。
    return NextResponse.json({ error: 'email-required' }, { status: 400 });
  }

  // 3. 既存 Customer の再利用 (RLS で自分の行のみ SELECT 可)
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  const reusedCustomerId =
    (existingSub?.stripe_customer_id as string | undefined) ?? null;

  // 4. success/cancel URL
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ?? req.headers.get('origin') ?? null;
  if (!origin) {
    return NextResponse.json(
      { error: 'origin-unresolved' },
      { status: 500 },
    );
  }

  // 5. Checkout Session 作成
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    line_items: [{ price: getStripePriceId(plan), quantity: 1 }],
    success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing/cancel`,
    client_reference_id: userId,
    subscription_data: {
      // BILLING-03 syncSubscription が読む正規キー
      metadata: { app_user_id: userId },
    },
    metadata: { app_user_id: userId },
    allow_promotion_codes: true,
    ...(reusedCustomerId
      ? { customer: reusedCustomerId }
      : { customer_email: email }),
  };

  try {
    const session = await getStripeClient().checkout.sessions.create(params);
    if (!session.url) {
      return NextResponse.json(
        { error: 'stripe-error', message: 'no session url' },
        { status: 500 },
      );
    }
    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'checkout failed';
    devWarn('[billing/checkout] stripe error', message);
    // Sentry: Stripe Checkout 作成失敗。plan は判明、本文は送らない。
    captureRouteException(
      err,
      { route: 'billing/checkout', feature: 'billing', plan, status: 500 },
      { status: 500, code: 'stripe-error', durationMs: Date.now() - t0 },
    );
    return NextResponse.json(
      { error: 'stripe-error', message },
      { status: 500 },
    );
  }
}
