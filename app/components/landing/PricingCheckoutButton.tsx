'use client';

/**
 * STEP-BILLING-04: PricingSection の CTA を Checkout に結線する client button。
 *
 * 振る舞い:
 *   1. クリック → POST /api/billing/checkout { plan }
 *   2. 200 { url } → window.location.href = url で Stripe Checkout に遷移
 *   3. 400 email-required → /account/email?next=... で email 登録に誘導
 *   4. その他のエラー → button 下にエラーメッセージを出す
 *   5. auth 未確定 / loading 中は disabled
 *
 * 親 (PricingSection) のスタイルを維持するため、ボタンの className は
 * 旧 <Link> と同等にする (bg-{brand|accent}-600 / rounded-xl / shadow-sm)。
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useCurrentUserId } from '@/app/components/AuthProvider';
import type { PlanId } from '@/lib/billing/plans';

type Props = {
  plan: PlanId;
  label: string;
  highlight?: boolean;
};

type CheckoutResponse = {
  url?: string;
  error?: string;
  message?: string;
};

export function PricingCheckoutButton({ plan, label, highlight }: Props) {
  const userId = useCurrentUserId();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = loading || userId === null;

  async function handleClick() {
    if (disabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data: CheckoutResponse = await res.json().catch(() => ({}));

      if (res.status === 400 && data.error === 'email-required') {
        const next = `/?plan=${plan}#pricing`;
        router.push(`/account/email?next=${encodeURIComponent(next)}`);
        return;
      }

      if (res.status === 401) {
        setError('ログインが確認できませんでした。ページを再読み込みしてください。');
        setLoading(false);
        return;
      }

      if (!res.ok || !data.url) {
        setError(data.message ?? 'チェックアウトを開始できませんでした。');
        setLoading(false);
        return;
      }

      // 成功: Stripe Checkout に遷移
      window.location.href = data.url;
    } catch {
      setError('通信エラーが発生しました。時間をおいてお試しください。');
      setLoading(false);
    }
  }

  return (
    <div className="mt-auto">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`inline-flex w-full justify-center items-center font-bold text-sm sm:text-base px-6 py-3 rounded-xl shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
          highlight
            ? 'bg-accent-600 hover:bg-accent-700 text-white'
            : 'bg-brand-600 hover:bg-brand-700 text-white'
        }`}
      >
        {loading
          ? '読み込み中…'
          : userId === null
            ? '認証情報を読み込み中…'
            : label}
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-600 leading-relaxed">{error}</p>
      )}
    </div>
  );
}
