import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';

// ── /terms（利用規約・仮ページ） ───────────────────────────────
// 正式リリース前の placeholder。
// 注意文ブロックは callout 風（slate-50 背景 + ring）にして、
// 「これは大事な前提」と読者に伝わるように軽く強調する。

export const metadata: Metadata = {
  title: '利用規約 | PASSAI',
};

export default function TermsPage() {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-8 transition-colors"
        >
          ← トップに戻る
        </Link>

        <PageHeader title="利用規約" />

        <div className="space-y-5 text-slate-700 leading-relaxed">
          <p>
            このページでは、PASSAIの利用に関する基本的なルールを掲載予定です。
          </p>
          <p>
            現在、正式リリースに向けて利用規約を準備中です。
            <br />
            正式な内容は、サービス公開時に掲載します。
          </p>
        </div>

        {/* 注意文（断定を避け、サポート目的であることを明示） */}
        <div className="mt-8 bg-slate-50 border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-2">
          <p className="text-sm text-slate-600 leading-relaxed">
            本サービスは、受験生の考えを整理し、学習や出願準備をサポートすることを目的としています。
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            合格を保証するものではありません。
          </p>
        </div>
      </div>
    </div>
  );
}
