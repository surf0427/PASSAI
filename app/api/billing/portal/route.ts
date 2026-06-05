/**
 * STEP-BILLING-05: Stripe Billing Portal Session 作成 API。
 *
 * 受信:
 *   POST (body 不要)
 *
 * レスポンス:
 *   200 { url: string }                      → client が window.location で遷移
 *   400 { error: 'no-customer' }             → subscriptions に行が無い (未契約 / webhook 未着)
 *   401 { error: 'unauthenticated' }
 *   500 { error: 'origin-unresolved' | 'stripe-error' | 'supabase-unavailable', message? }
 *
 * 用途:
 *   ユーザー自身が Stripe Customer Portal で
 *     - サブスクの解約 / 再開
 *     - 支払い方法 (カード) の更新
 *     - 過去の請求書 / 領収書のダウンロード
 *     - 請求情報 (住所等) の編集
 *   を行えるようにする。
 *
 * 認可:
 *   user-scoped client (RLS 配下) で subscriptions を SELECT し、自分の
 *   stripe_customer_id を取得する。service_role 不要。
 *
 * Runtime:
 *   - nodejs 必須 (Stripe SDK)
 *   - force-dynamic: per-user の portal session で絶対にキャッシュしない
 *
 * Stripe Dashboard 側設定:
 *   Customer Portal が test mode で activate されていないと
 *   billingPortal.sessions.create() が下記エラーで失敗する:
 *     "You must activate your Customer portal in test mode at
 *      https://dashboard.stripe.com/test/settings/billing/portal"
 *   設定手順は STEP-BILLING-05 完了報告 §8 を参照。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { getStripeClient } from '@/lib/stripe/server';
import { getServerSupabaseClient } from '@/lib/supabase/serverClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'supabase-unavailable' },
      { status: 500 },
    );
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userData.user.id;

  // 自分の subscriptions 行から stripe_customer_id を取る (RLS 配下)
  const { data: subRow } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const customerId =
    (subRow?.stripe_customer_id as string | undefined) ?? null;
  if (!customerId) {
    // 一度も Checkout を完了していない / webhook 未着の場合
    return NextResponse.json({ error: 'no-customer' }, { status: 400 });
  }

  const origin =
    process.env.NEXT_PUBLIC_APP_URL ?? req.headers.get('origin') ?? null;
  if (!origin) {
    return NextResponse.json(
      { error: 'origin-unresolved' },
      { status: 500 },
    );
  }

  try {
    const session = await getStripeClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/mypage`,
    });
    if (!session.url) {
      return NextResponse.json(
        { error: 'stripe-error', message: 'no portal url' },
        { status: 500 },
      );
    }
    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'portal failed';
    devWarn('[billing/portal] stripe error', message);
    return NextResponse.json(
      { error: 'stripe-error', message },
      { status: 500 },
    );
  }
}
