/**
 * STEP-BILLING-04: Stripe Checkout キャンセル戻り先。
 *
 * 静的ページ。Stripe Checkout で「戻る / 中断」した場合の着地点。
 * 課金は発生していない旨を明示し、トップに戻る導線だけ用意する。
 */

import Link from 'next/link';

export default function BillingCancelPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-16 text-center">
      <h1 className="text-xl sm:text-2xl font-bold mb-3">
        購読手続きを中断しました
      </h1>
      <p className="text-sm text-slate-600 leading-relaxed mb-8">
        課金は発生していません。プランをもう一度確認したい場合は
        トップページの料金プランからやり直せます。
      </p>
      <Link
        href="/#pricing"
        className="inline-flex items-center justify-center font-bold text-sm sm:text-base px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white shadow-sm transition-colors"
      >
        料金プランに戻る
      </Link>
    </div>
  );
}
