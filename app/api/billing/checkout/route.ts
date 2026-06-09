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
import type Stripe from 'stripe';

import { isPlanId } from '@/lib/billing/plans';
import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { getStripeClient, getStripePriceId } from '@/lib/stripe/server';
import { logAuthFail } from '@/lib/supabase/authFailLog';
import { getServerSupabaseClient } from '@/lib/supabase/serverClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// STEP-AUTH-REDESIGN: 課金は member（is_anonymous === false）のみ。member は
// top-level `user.email` を必ず持つため、user.email だけを採用する
// （旧: user_metadata / identities の 3 段フォールバックは廃止）。
// server-only route のため client 専用の isValidEmailFormat は import せず、
// 同等の簡易バリデーションをここに inline する。
const CHECKOUT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmailLike(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 254 &&
    CHECKOUT_EMAIL_RE.test(value)
  );
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
  // 一時ログ（TODO: 確認後に削除）。生メール禁止・boolean / id のみ。
  // checkout が見ているセッションが anonymous か member かを実測する。
  console.warn('[checkout-auth-debug]', {
    userId: userData?.user?.id ?? null,
    isAnonymous: userData?.user?.is_anonymous ?? null,
    hasTopLevelEmail: Boolean(userData?.user?.email),
    hasGetUserError: Boolean(userErr),
  });
  // STEP-AUTH-REDESIGN: 課金は member（is_anonymous === false）のみ。未認証 /
  // セッション喪失 / 旧 anonymous はすべて 401 で弾く（client の isMember ゲートと二重防御）。
  if (userErr || !userData.user || userData.user.is_anonymous === true) {
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
  // member は top-level user.email を必ず持つ。これだけを採用する。
  const email = isEmailLike(userData.user.email) ? userData.user.email : null;
  if (!email) {
    // member なのに email が無い異常系。Stripe Customer が email を持てないため弾く。
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
