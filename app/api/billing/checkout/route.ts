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
import { getStripeClient, getStripePriceId } from '@/lib/stripe/server';
import { logAuthFail } from '@/lib/supabase/authFailLog';
import { getServerSupabaseClient } from '@/lib/supabase/serverClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
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
  const email = userData.user.email;
  if (!email) {
    // 匿名のままだと Stripe Customer が email を持たない → receipt / Portal が
    // 機能しない。/account/email での登録を強制する。
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
    return NextResponse.json(
      { error: 'stripe-error', message },
      { status: 500 },
    );
  }
}
