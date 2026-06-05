'use client';

/**
 * STEP-BILLING-05: マイページの課金情報カード。
 *
 * 表示分岐:
 *   - profile 未取得 (auth pending)         → 何も描画しない (chrome をぶらさない)
 *   - profile.plan === 'free'                → 「Free」+「プランを契約する」 CTA (/#pricing)
 *   - profile.plan ∈ {basic, premium}        → プラン名 + status バッジ + 次回更新日 (or 解約予定日) +
 *                                              「請求情報を管理」 CTA (POST /api/billing/portal)
 *
 * データソース:
 *   - profile.plan:        AuthProvider.useProfile() (webhook が同期した denormalized cache)
 *   - status / period_end / cancel_at_period_end: browser supabase で自分の subscriptions を 1 行 SELECT
 *     (RLS で auth.uid()=user_id のみ可)
 *
 * 既存 mypage の規約:
 *   - localStorage 経由のみ という規約はマイページ "本体" の話。本カードは
 *     auth 由来の課金状態を扱う独立コンポーネントとして mypage の外側 (Supabase)
 *     にアクセスする。schema 変更 / write は行わない。
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useCurrentUserId, useProfile } from '@/app/components/AuthProvider';
import { Card } from '@/components/ui/Card';
import { isPlanId, PLANS, type PlanId } from '@/lib/billing/plans';
import { getBrowserSupabaseClient } from '@/lib/supabase/browserClient';

type SubInfo = {
  plan: PlanId;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export function BillingCard() {
  const userId = useCurrentUserId();
  const profile = useProfile();
  const [sub, setSub] = useState<SubInfo | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    const supabase = getBrowserSupabaseClient();
    if (!supabase) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('subscriptions')
        .select('plan, status, current_period_end, cancel_at_period_end')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data && isPlanId(data.plan as string)) {
        setSub({
          plan: data.plan as PlanId,
          status: (data.status as string) ?? 'unknown',
          currentPeriodEnd:
            (data.current_period_end as string | null) ?? null,
          cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!profile) return null;

  if (profile.plan === 'free') {
    return <FreeView />;
  }

  return (
    <PaidView
      cachedPlan={profile.plan}
      sub={sub}
      onPortalClick={async () => {
        if (portalLoading) return;
        setPortalLoading(true);
        setPortalError(null);
        try {
          const res = await fetch('/api/billing/portal', { method: 'POST' });
          const data = (await res.json().catch(() => ({}))) as {
            url?: string;
            error?: string;
            message?: string;
          };
          if (res.ok && data.url) {
            window.location.href = data.url;
            return;
          }
          if (data.error === 'no-customer') {
            setPortalError(
              '購読情報が見つかりません。サポートまでお問い合わせください。',
            );
          } else {
            setPortalError(
              data.message ?? '請求情報ページを開けませんでした。',
            );
          }
          setPortalLoading(false);
        } catch {
          setPortalError('通信エラーが発生しました。');
          setPortalLoading(false);
        }
      }}
      portalLoading={portalLoading}
      portalError={portalError}
    />
  );
}

function FreeView() {
  return (
    <Card padding="md" className="mt-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs font-medium text-slate-500">現在のプラン</p>
          <p className="mt-1 text-xl font-bold text-slate-700">Free</p>
        </div>
        <Link
          href="/#pricing"
          className="inline-flex items-center justify-center font-bold text-sm px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white shadow-sm transition-colors"
        >
          プランを契約する
        </Link>
      </div>
    </Card>
  );
}

function PaidView({
  cachedPlan,
  sub,
  onPortalClick,
  portalLoading,
  portalError,
}: {
  cachedPlan: string;
  sub: SubInfo | null;
  onPortalClick: () => void;
  portalLoading: boolean;
  portalError: string | null;
}) {
  // sub が取得済みならそちらを正、無ければ profile.plan を仮表示
  const planLabel = isPlanId(sub?.plan ?? '')
    ? PLANS[sub!.plan].label
    : isPlanId(cachedPlan)
      ? PLANS[cachedPlan].label
      : cachedPlan;

  return (
    <Card padding="md" className="mt-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs font-medium text-slate-500">現在のプラン</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{planLabel}</p>
        </div>
        {sub && <StatusBadge status={sub.status} />}
      </div>

      {sub?.currentPeriodEnd && (
        <p className="mt-3 text-xs text-slate-600">
          {sub.cancelAtPeriodEnd ? (
            <>
              <span className="text-amber-700 font-medium">解約予定日</span>:{' '}
              {formatDate(sub.currentPeriodEnd)}
              <span className="ml-1 text-slate-500">
                （この日まで利用できます）
              </span>
            </>
          ) : (
            <>
              次回更新日: {formatDate(sub.currentPeriodEnd)}
            </>
          )}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={onPortalClick}
          disabled={portalLoading}
          className="inline-flex w-full sm:w-auto justify-center items-center font-bold text-sm px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {portalLoading ? '読み込み中…' : '請求情報を管理'}
        </button>
        {portalError && (
          <p className="text-xs text-red-600 leading-relaxed">
            {portalError}
          </p>
        )}
        <p className="text-xs text-slate-500 leading-relaxed">
          Stripe の請求情報ページに遷移します。解約・カード変更・領収書ダウンロードが行えます。
        </p>
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const meta = statusMeta(status);
  return (
    <span
      className={`inline-flex items-center text-xs font-semibold px-2 py-1 rounded-full ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

function statusMeta(status: string): { label: string; className: string } {
  switch (status) {
    case 'active':
      return { label: '利用中', className: 'bg-emerald-100 text-emerald-800' };
    case 'trialing':
      return { label: 'トライアル中', className: 'bg-blue-100 text-blue-800' };
    case 'past_due':
      return { label: '支払い遅延', className: 'bg-amber-100 text-amber-800' };
    case 'canceled':
      return { label: '解約済み', className: 'bg-slate-200 text-slate-700' };
    case 'unpaid':
      return { label: '未払い', className: 'bg-red-100 text-red-800' };
    case 'incomplete':
    case 'incomplete_expired':
      return { label: '手続き中', className: 'bg-slate-200 text-slate-700' };
    case 'paused':
      return { label: '一時停止', className: 'bg-slate-200 text-slate-700' };
    default:
      return { label: status, className: 'bg-slate-200 text-slate-700' };
  }
}

function formatDate(iso: string): string {
  // ISO の日付部分だけ簡易表示。タイムゾーンは UTC のままで OK
  // (period_end が "次回更新日" としてユーザーに見せる以上の精度は不要)
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}
