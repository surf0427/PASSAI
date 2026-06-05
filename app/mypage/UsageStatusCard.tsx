'use client';

/**
 * STEP-BILLING-07: マイページ「今月の利用状況」カード。
 *
 * 表示分岐:
 *   - profile 未取得 (auth pending) / fetch 失敗 → 何も描画しない
 *   - profile.plan === 'free'                     → 描画しない (BillingCard の「契約する」CTA で十分)
 *   - profile.plan ∈ {basic, premium}             → /api/billing/usage/me を fetch して progress 表示
 *
 * 各 feature について:
 *   - 「<機能名> used / limit」+ 横向き Progress Bar
 *   - basic で utilization >= 80% かつ premium に拡張余地あり → Premium 誘導コピー
 *   - limit = 0 の feature (Free 用) や 'unlimited' は表示しない
 *
 * 既存 BillingCard と並んで使われる。重複しないよう "課金状態 (プラン名/状態)" は
 * BillingCard 側、"利用回数の progress" は本カード側、と責務分離する。
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useCurrentUserId, useProfile } from '@/app/components/AuthProvider';
import { Card } from '@/components/ui/Card';
import { PLANS } from '@/lib/billing/plans';
import {
  QUOTAS,
  QUOTA_FEATURES,
  type EffectivePlan,
  type QuotaFeature,
  type QuotaValue,
} from '@/lib/billing/quotas';

type FeatureUsage = { used: number; limit: QuotaValue };
type UsageSummary = {
  plan: EffectivePlan;
  quotas: Record<QuotaFeature, FeatureUsage>;
  resetAt: string;
};

const FEATURE_LABELS: Record<QuotaFeature, string> = {
  statement: '志望理由書',
  essay: '小論文',
  'self-pr': '自己PR',
  interview: '面接',
  tutor: 'Tutor',
};

const UPGRADE_THRESHOLD = 0.8;

export function UsageStatusCard() {
  const userId = useCurrentUserId();
  const profile = useProfile();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!userId) return;
    // Free は描画しないので fetch 自体スキップ (profile.plan が確定してから判断)
    if (profile && profile.plan === 'free') return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/billing/usage/me', { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setError(true);
          return;
        }
        const json = (await res.json()) as UsageSummary;
        if (!cancelled) setSummary(json);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, profile]);

  if (!profile) return null;
  if (profile.plan === 'free') return null;
  if (error || !summary) return null;

  const plan = summary.plan;

  // limit = 'unlimited' / 0 は表示対象外
  const rows = QUOTA_FEATURES.flatMap((feature) => {
    const u = summary.quotas[feature];
    if (!u) return [];
    if (u.limit === 'unlimited') return [];
    if (u.limit === 0) return [];
    return [{ feature, used: u.used, limit: u.limit as number }];
  });

  if (rows.length === 0) return null;

  return (
    <Card padding="md" className="mt-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-bold text-slate-800">今月の利用状況</h2>
        <p className="text-xs text-slate-500">
          月初 (UTC) にリセット
        </p>
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <UsageRow
            key={row.feature}
            feature={row.feature}
            used={row.used}
            limit={row.limit}
            plan={plan}
          />
        ))}
      </ul>
    </Card>
  );
}

function UsageRow({
  feature,
  used,
  limit,
  plan,
}: {
  feature: QuotaFeature;
  used: number;
  limit: number;
  plan: EffectivePlan;
}) {
  const ratio = limit === 0 ? 0 : Math.min(used / limit, 1);
  const pct = Math.round(ratio * 100);

  const reachedLimit = used >= limit;
  const nearLimit = !reachedLimit && ratio >= UPGRADE_THRESHOLD;

  // basic → premium で limit が伸びる場合のみ upgrade CTA を出す
  const premiumLimit = QUOTAS.premium[feature];
  const canUpgrade =
    plan === 'basic' &&
    typeof premiumLimit === 'number' &&
    premiumLimit > limit;

  const barColor = reachedLimit
    ? 'bg-red-500'
    : nearLimit
      ? 'bg-amber-500'
      : 'bg-brand-500';

  return (
    <li>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm text-slate-700">
          {FEATURE_LABELS[feature]}
        </span>
        <span
          className={`text-xs font-semibold ${
            reachedLimit
              ? 'text-red-700'
              : nearLimit
                ? 'text-amber-700'
                : 'text-slate-600'
          }`}
        >
          {used} / {limit}
        </span>
      </div>
      <div
        className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden"
        aria-label={`${FEATURE_LABELS[feature]} 利用率 ${pct}%`}
      >
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {(nearLimit || reachedLimit) && canUpgrade && (
        <p className="mt-1.5 text-xs text-accent-700">
          {PLANS.premium.label}プランなら {premiumLimit} 回まで利用可能{' '}
          <Link
            href="/#pricing"
            className="font-bold underline underline-offset-2 hover:text-accent-800"
          >
            詳細
          </Link>
        </p>
      )}
    </li>
  );
}
