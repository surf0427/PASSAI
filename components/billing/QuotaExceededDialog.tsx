'use client';

/**
 * STEP-BILLING-07: quota-exceeded ダイアログ + 共通フック。
 *
 * 表示分岐 (info.plan で出し分け):
 *   - free    : 「契約が必要です」+ "プランを見る" CTA
 *   - basic   : 「今月の<機能名>上限に達しました」+ "Premium なら○回まで" + "プランを見る"
 *   - premium : 「今月の<機能名>上限に達しました」+ "来月リセットされます" のみ
 *
 * ボタン:
 *   - "プランを見る" → /#pricing に遷移 (アンカー込み Link)
 *   - "閉じる"        → onClose()
 *
 * 使い方:
 *   const { handleResponse, dialog } = useQuotaDialog();
 *   const res = await fetch(...);
 *   if (await handleResponse(res)) return;
 *   ...
 *   return (<>{ existingUi }{ dialog }</>);
 *
 * 既存 ConfirmDialog (components/ui/ConfirmDialog.tsx) と同じ modal 作法
 * (backdrop / rounded card / 縦並び→横並び) に揃えて視覚的に統一する。
 * 二択 + 補足コピーを持つので ConfirmDialog の薄ラッパでは収まらず別実装。
 */

import Link from 'next/link';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { PLANS } from '@/lib/billing/plans';
import {
  parseQuotaError,
  type QuotaErrorInfo,
} from '@/lib/billing/quotaClient';
import { QUOTAS, type QuotaFeature } from '@/lib/billing/quotas';

const FEATURE_LABELS: Record<QuotaFeature, string> = {
  statement: '志望理由書添削',
  essay: '小論文添削',
  'self-pr': '自己PR添削',
  interview: '面接フィードバック',
  'interview-ai': '面接AI',
  'interview-ai-realtime': 'リアルタイム音声面接',
  presentation: 'プレゼン',
  tutor: 'Tutor',
};

type Props = {
  isOpen: boolean;
  info: QuotaErrorInfo | null;
  onClose: () => void;
};

export function QuotaExceededDialog({ isOpen, info, onClose }: Props) {
  if (!isOpen || !info) return null;

  const featureLabel = FEATURE_LABELS[info.feature];
  const premiumLimit = QUOTAS.premium[info.feature];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        {info.plan === 'free' ? (
          <FreeBody featureLabel={featureLabel} />
        ) : (
          <PaidBody
            featureLabel={featureLabel}
            used={info.used}
            limit={info.limit}
            plan={info.plan}
            premiumLimit={
              typeof premiumLimit === 'number' ? premiumLimit : null
            }
          />
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
          <Button
            variant="secondary"
            onClick={onClose}
            className="sm:w-auto w-full"
          >
            閉じる
          </Button>
          <Link
            href="/#pricing"
            onClick={onClose}
            className="sm:w-auto w-full inline-flex items-center justify-center font-bold text-sm px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white shadow-sm transition-colors"
          >
            プランを見る
          </Link>
        </div>
      </div>
    </div>
  );
}

function FreeBody({ featureLabel }: { featureLabel: string }) {
  return (
    <>
      <h2 className="text-base font-bold text-slate-900 mb-2">
        {featureLabel}を利用するにはプラン契約が必要です
      </h2>
      <p className="text-sm text-slate-600 leading-relaxed">
        PASSAI は契約者向けのサービスです。プランを選択するとすぐに利用を開始できます。
      </p>
    </>
  );
}

function PaidBody({
  featureLabel,
  used,
  limit,
  plan,
  premiumLimit,
}: {
  featureLabel: string;
  used: number;
  limit: number;
  plan: 'basic' | 'premium';
  premiumLimit: number | null;
}) {
  return (
    <>
      <h2 className="text-base font-bold text-slate-900 mb-2">
        今月の利用上限に達しました
      </h2>
      <p className="text-sm text-slate-700 leading-relaxed">
        <span className="font-semibold">{featureLabel}</span>{' '}
        <span className="text-slate-900 font-bold">
          {used} / {limit} 回
        </span>{' '}
        利用済みです。
      </p>

      {plan === 'basic' && premiumLimit !== null ? (
        <p className="mt-3 text-sm text-accent-700 bg-accent-50 px-3 py-2 rounded-lg leading-relaxed">
          <span className="font-bold">{PLANS.premium.label}プラン</span>では
          {premiumLimit}回まで利用できます。
        </p>
      ) : (
        <p className="mt-3 text-xs text-slate-500 leading-relaxed">
          来月の月初 (UTC) にリセットされます。
        </p>
      )}
    </>
  );
}

/**
 * AI fetch のレスポンスを 1 行で渡せばダイアログ管理を肩代わりするフック。
 * 戻り値の `dialog` をコンポーネントの末尾に挿入する。
 *
 * handleResponse(res):
 *   - res.status === 402 + quota-exceeded shape → dialog を open し true を返す
 *   - それ以外 → false (呼び出し側は通常 error handling を続けてよい)
 */
export function useQuotaDialog() {
  const [info, setInfo] = useState<QuotaErrorInfo | null>(null);

  const handleResponse = useCallback(
    async (res: Response): Promise<boolean> => {
      const parsed = await parseQuotaError(res);
      if (parsed) {
        setInfo(parsed);
        return true;
      }
      return false;
    },
    [],
  );

  const dialog = (
    <QuotaExceededDialog
      isOpen={info !== null}
      info={info}
      onClose={() => setInfo(null)}
    />
  );

  return { handleResponse, dialog };
}
