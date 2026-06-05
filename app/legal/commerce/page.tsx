/**
 * STEP-BILLING-07: 特定商取引法に基づく表記 (placeholder)。
 *
 * 本ページの目的:
 *   - Stripe Customer Portal 設定 / 本番審査時に「特商法表記 URL」が必要。
 *     本番化までに正式版に差し替えるが、URL は今のうちに確保しておく。
 *   - 仮表記は「準備中」とし、リリース前に下記項目を実値で埋める:
 *       事業者名 / 運営責任者 / 住所 / 連絡先 / 代金支払時期・方法 /
 *       商品引渡時期 / 返品・キャンセル / 動作環境 等
 *
 * 既存の /privacy /terms と同じレイアウト (max-w-3xl / PageHeader / 戻る Link)
 * に揃える。
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = {
  title: '特定商取引法に基づく表記 | PASSAI',
};

export default function CommercePage() {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-8 transition-colors"
        >
          ← トップに戻る
        </Link>

        <PageHeader title="特定商取引法に基づく表記" />

        <div className="space-y-5 text-slate-700 leading-relaxed">
          <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-5 py-4 text-sm text-slate-600">
            正式版を準備中です。本番リリース前に下記項目を実値で記載します。
          </div>

          <PlaceholderRow label="販売事業者">準備中</PlaceholderRow>
          <PlaceholderRow label="運営責任者">準備中</PlaceholderRow>
          <PlaceholderRow label="所在地">
            ご請求があった場合は遅滞なく開示します
          </PlaceholderRow>
          <PlaceholderRow label="連絡先">
            ご請求があった場合は遅滞なく開示します
          </PlaceholderRow>
          <PlaceholderRow label="販売価格">
            各プランのページに表示する価格(税込)
          </PlaceholderRow>
          <PlaceholderRow label="商品代金以外の必要料金">
            通信料はお客様のご負担となります
          </PlaceholderRow>
          <PlaceholderRow label="支払方法">
            クレジットカード決済 (Stripe)
          </PlaceholderRow>
          <PlaceholderRow label="支払時期">
            毎月の更新日に自動課金
          </PlaceholderRow>
          <PlaceholderRow label="商品引渡時期">
            決済完了後ただちにご利用いただけます
          </PlaceholderRow>
          <PlaceholderRow label="返品・キャンセル">
            デジタルサービスの性質上、決済後の返金は原則対応いたしかねます。
            次回更新前の解約はマイページの「請求情報を管理」よりお手続きください。
          </PlaceholderRow>
          <PlaceholderRow label="動作環境">
            最新版の主要ブラウザ (Chrome / Safari / Edge / Firefox) を推奨
          </PlaceholderRow>
        </div>
      </div>
    </div>
  );
}

function PlaceholderRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-1 sm:gap-4 text-sm">
      <p className="font-semibold text-slate-900">{label}</p>
      <p className="text-slate-700">{children}</p>
    </div>
  );
}
