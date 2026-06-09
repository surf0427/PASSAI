/**
 * STEP-BILLING-03: Stripe Webhook handler.
 *
 * 責務:
 *   - Stripe からの POST を署名検証する。検証失敗 → 400。
 *   - stripe_events table で event_id 単位の冪等化を行う:
 *       1. 既存 row があり processed_at が non-null → 重複として 200 idempotent
 *       2. 既存 row があり processed_at が null → 前回失敗。再処理する
 *       3. 行なし → INSERT してから処理
 *   - 5 種のイベントを dispatch:
 *       customer.subscription.created/updated/deleted → syncSubscriptionFromStripe
 *       checkout.session.completed → ログのみ（state は subscription.* で同期）
 *       invoice.payment_failed     → ログのみ（status は subscription.updated 経由）
 *   - 結果に応じて stripe_events.processed_at / error を更新。
 *
 * エラー応答方針:
 *   - 署名検証失敗 → 400 (永続失敗、Stripe は retry しない)
 *   - DB の transient failure → 500 (Stripe が retry する)
 *   - permanent failure (no-user-id / unknown-plan / no-items) → 200 + error 記録
 *     （retry しても直らないため。Dashboard で手動 triage する前提）
 *
 * Runtime:
 *   - Stripe SDK は crypto を使うため Node.js runtime 必須。Edge では動かない。
 *   - dynamic = 'force-dynamic' で webhook が誤って静的キャッシュ対象にされないよう保険。
 *
 * 必要 env:
 *   - STRIPE_SECRET_KEY            (BILLING-02 で設定済み)
 *   - STRIPE_WEBHOOK_SECRET        (本 STEP で設定要 — stripe listen で取得)
 *   - SUPABASE_SERVICE_ROLE_KEY    (本 STEP で設定要 — Supabase Dashboard で取得)
 *   - STRIPE_PRICE_ID_{BASIC,PREMIUM}  (BILLING-02 で設定済み)
 */

import 'server-only';

import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { syncSubscriptionFromStripe } from '@/lib/billing/syncSubscription';
import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { getStripeClient } from '@/lib/stripe/server';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HANDLED_EVENT_TYPES = new Set<string>([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'checkout.session.completed',
  'invoice.payment_failed',
]);

function readWebhookSecret(): string {
  const v = process.env.STRIPE_WEBHOOK_SECRET;
  if (!v) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  return v;
}

export async function POST(req: Request) {
  // 1. raw body & signature
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json(
      { error: 'missing stripe-signature header' },
      { status: 400 },
    );
  }

  // 2. 署名検証
  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(
      body,
      sig,
      readWebhookSecret(),
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'signature verification failed';

    // ── DEBUG(一時): 400 invalid signature の原因切り分け用。
    // secret 値は絶対に出さず、prefix / length / boolean のみ。
    // devWarn は本番で DCE されるため、本番でも残る console.error で出す。
    const ws = process.env.STRIPE_WEBHOOK_SECRET;
    const sk = process.env.STRIPE_SECRET_KEY;
    console.error('[webhook-debug] verify failed', {
      errName: err instanceof Error ? err.name : null,
      errMessage: message,
      hasSig: Boolean(sig),
      sigPrefix: sig ? sig.slice(0, 3) : null,
      hasWebhookSecret: Boolean(ws),
      webhookSecretPrefix: ws ? ws.slice(0, 6) : null,
      webhookSecretLen: ws ? ws.length : 0,
      hasSecretKey: Boolean(sk),
      secretKeyPrefix: sk ? sk.slice(0, 8) : null,
      nodeEnv: process.env.NODE_ENV,
    });

    devWarn('[billing/webhook] signature verification failed', message);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  const supabase = getServiceRoleSupabaseClient();

  // 3. 冪等化: 既存 row 状態を確認 → 未処理ならクレーム
  const { data: existing, error: selectErr } = await supabase
    .from('stripe_events')
    .select('processed_at')
    .eq('event_id', event.id)
    .maybeSingle();

  if (selectErr) {
    devWarn('[billing/webhook] stripe_events select failed', selectErr);
    // transient と仮定して 500 → Stripe retry
    captureRouteException(selectErr, { route: 'billing/webhook', feature: 'billing', status: 500 }, { status: 500, code: 'stripe_events-select-failed' });
    return NextResponse.json({ error: 'db error' }, { status: 500 });
  }

  if (existing?.processed_at) {
    // 既に処理済み → idempotent skip
    return NextResponse.json(
      { received: true, duplicate: true },
      { status: 200 },
    );
  }

  if (!existing) {
    const { error: insertErr } = await supabase.from('stripe_events').insert({
      event_id: event.id,
      type: event.type,
      payload: event as unknown as Record<string, unknown>,
    });
    // 23505 (unique_violation) は concurrent webhook の race → 続行可
    if (insertErr && (insertErr as { code?: string }).code !== '23505') {
      devWarn('[billing/webhook] stripe_events insert failed', insertErr);
      captureRouteException(insertErr, { route: 'billing/webhook', feature: 'billing', status: 500 }, { status: 500, code: 'stripe_events-insert-failed' });
      return NextResponse.json(
        { error: 'event log insert failed' },
        { status: 500 },
      );
    }
  }

  // 4. dispatch
  const result = await dispatch(event);

  // 5. event row finalize（成功 or 永続失敗をマーク）
  if (result.kind === 'transient-error') {
    await supabase
      .from('stripe_events')
      .update({ error: result.message })
      .eq('event_id', event.id);
    captureRouteException(new Error('webhook dispatch transient error'), { route: 'billing/webhook', feature: 'billing', status: 500 }, { status: 500, code: 'dispatch-transient-error' });
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  const processedAt = new Date().toISOString();
  const finalize: { processed_at: string; error: string | null } =
    result.kind === 'permanent-error'
      ? { processed_at: processedAt, error: result.message }
      : { processed_at: processedAt, error: null };
  const { error: updErr } = await supabase
    .from('stripe_events')
    .update(finalize)
    .eq('event_id', event.id);
  if (updErr) {
    devWarn('[billing/webhook] stripe_events finalize update failed', updErr);
  }

  return NextResponse.json(
    {
      received: true,
      type: event.type,
      handled: result.kind === 'handled',
      ...(result.kind === 'permanent-error' ? { reason: result.message } : {}),
      ...(result.kind === 'ignored' ? { ignored: true } : {}),
    },
    { status: 200 },
  );
}

type DispatchResult =
  | { kind: 'handled' }
  | { kind: 'ignored' }
  | { kind: 'permanent-error'; message: string }
  | { kind: 'transient-error'; message: string };

async function dispatch(event: Stripe.Event): Promise<DispatchResult> {
  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    return { kind: 'ignored' };
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const result = await syncSubscriptionFromStripe(sub);
        return mapSyncResult(result);
      }

      case 'checkout.session.completed': {
        // state は customer.subscription.created で同期されるためログのみ。
        const session = event.data.object as Stripe.Checkout.Session;
        devWarn('[billing/webhook] checkout.session.completed', {
          id: session.id,
          mode: session.mode,
          customer: session.customer,
          subscription: session.subscription,
        });
        return { kind: 'handled' };
      }

      case 'invoice.payment_failed': {
        // status 変化は customer.subscription.updated 経由で同期される。
        // ここでは observability 用のログのみ残す。
        const invoice = event.data.object as Stripe.Invoice;
        devWarn('[billing/webhook] invoice.payment_failed', {
          id: invoice.id,
          customer: invoice.customer,
          // Stripe 2026-05-27.dahlia 以降の Invoice は subscription を直接持たない
          // フィールド構成のため、Subscription 由来の status 同期は別 event に任せる。
        });
        return { kind: 'handled' };
      }

      default:
        return { kind: 'ignored' };
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'handler threw unknown error';
    return { kind: 'transient-error', message };
  }
}

function mapSyncResult(
  result: Awaited<ReturnType<typeof syncSubscriptionFromStripe>>,
): DispatchResult {
  switch (result.kind) {
    case 'ok':
      return { kind: 'handled' };
    case 'no-user-id':
      return {
        kind: 'permanent-error',
        message: `no user_id resolved for customer=${result.customerId} sub=${result.subscriptionId}`,
      };
    case 'unknown-plan':
      return {
        kind: 'permanent-error',
        message: `unknown price_id=${result.priceId} on sub=${result.subscriptionId}`,
      };
    case 'no-items':
      return {
        kind: 'permanent-error',
        message: `subscription ${result.subscriptionId} has no items`,
      };
    case 'db-error':
      return { kind: 'transient-error', message: result.message };
    default: {
      const _exhaustive: never = result;
      return { kind: 'transient-error', message: 'unhandled sync result' };
    }
  }
}
