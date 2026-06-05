'use client';

/**
 * STEP-BILLING-04: Stripe Checkout 完了戻り先。
 *
 * Checkout が完了して Stripe 側で支払いが通っても、subscriptions テーブルの
 * 反映は webhook (customer.subscription.created) 経由で行われるため数秒の
 * 遅延がある。ここでは:
 *   1. browser supabase client で自分の subscriptions を 2 秒毎に poll
 *   2. status='active' / 'trialing' を観測したら成功表示
 *   3. 30 秒経っても見えなければ "反映に時間がかかっています" を表示
 * という UX で穴を埋める。
 *
 * 認可境界:
 *   - subscriptions の SELECT は STEP-BILLING-01 RLS で auth.uid()=user_id のみ
 *     に閉じている。browser から直接 SELECT して問題なし。
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { useCurrentUserId } from '@/app/components/AuthProvider';
import { PLANS, type PlanId } from '@/lib/billing/plans';
import { getBrowserSupabaseClient } from '@/lib/supabase/browserClient';

type Status =
  | { kind: 'pending' }
  | { kind: 'active'; plan: PlanId }
  | { kind: 'timeout' };

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

export default function BillingSuccessPage() {
  const userId = useCurrentUserId();
  const [status, setStatus] = useState<Status>({ kind: 'pending' });
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    const supabase = getBrowserSupabaseClient();
    if (!supabase) return;

    startedAtRef.current = Date.now();
    let cancelled = false;

    async function poll() {
      if (cancelled || !supabase) return;
      const { data } = await supabase
        .from('subscriptions')
        .select('plan, status')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const planRaw = (data?.plan as string | undefined) ?? null;
      const stat = (data?.status as string | undefined) ?? null;
      const isActive = stat === 'active' || stat === 'trialing';
      if (
        isActive &&
        planRaw &&
        (planRaw === 'basic' || planRaw === 'premium')
      ) {
        setStatus({ kind: 'active', plan: planRaw });
        return; // 終了
      }
      const elapsed = startedAtRef.current
        ? Date.now() - startedAtRef.current
        : 0;
      if (elapsed > POLL_TIMEOUT_MS) {
        setStatus({ kind: 'timeout' });
        return;
      }
      window.setTimeout(poll, POLL_INTERVAL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div className="mx-auto max-w-xl px-6 py-16 text-center">
      {status.kind === 'pending' && <PendingView />}
      {status.kind === 'active' && <ActiveView plan={status.plan} />}
      {status.kind === 'timeout' && <TimeoutView />}
    </div>
  );
}

function PendingView() {
  return (
    <>
      <Spinner />
      <h1 className="text-xl sm:text-2xl font-bold mt-6 mb-3">
        プランを有効化しています…
      </h1>
      <p className="text-sm text-slate-600 leading-relaxed">
        Stripe からの反映を待っています。通常 5〜10 秒ほどで完了します。
      </p>
    </>
  );
}

function ActiveView({ plan }: { plan: PlanId }) {
  const label = PLANS[plan].label;
  return (
    <>
      <h1 className="text-xl sm:text-2xl font-bold mb-3 text-brand-700">
        {label} プランが有効になりました
      </h1>
      <p className="text-sm text-slate-600 leading-relaxed mb-8">
        ご購読ありがとうございます。マイページから利用状況を確認できます。
      </p>
      <Link
        href="/mypage"
        className="inline-flex items-center justify-center font-bold text-sm sm:text-base px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white shadow-sm transition-colors"
      >
        マイページへ
      </Link>
    </>
  );
}

function TimeoutView() {
  return (
    <>
      <h1 className="text-xl sm:text-2xl font-bold mb-3">
        反映に時間がかかっています
      </h1>
      <p className="text-sm text-slate-600 leading-relaxed mb-8">
        購読自体は完了している可能性があります。マイページからプラン状態を
        ご確認ください。数分待っても反映されない場合はサポートまでご連絡ください。
      </p>
      <Link
        href="/mypage"
        className="inline-flex items-center justify-center font-bold text-sm sm:text-base px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white shadow-sm transition-colors"
      >
        マイページで確認する
      </Link>
    </>
  );
}

function Spinner() {
  return (
    <div className="mx-auto h-10 w-10 rounded-full border-4 border-slate-200 border-t-brand-600 animate-spin" />
  );
}
