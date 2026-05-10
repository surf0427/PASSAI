import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';

// ── /contact（お問い合わせ・仮ページ） ────────────────────────
// 正式リリース前の placeholder。フォームは未実装。
// リリース時にフォームまたは連絡先（メール / 問い合わせ先 URL）を差し込む。

export const metadata: Metadata = {
  title: 'お問い合わせ | PASSAI',
};

export default function ContactPage() {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-8 transition-colors"
        >
          ← トップに戻る
        </Link>

        <PageHeader title="お問い合わせ" />

        <div className="space-y-5 text-slate-700 leading-relaxed">
          <p>PASSAIに関するお問い合わせは、現在準備中です。</p>
          <p>
            正式リリース時には、お問い合わせフォームまたは連絡先を掲載予定です。
          </p>
        </div>
      </div>
    </div>
  );
}
