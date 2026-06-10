import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { FooterSection } from '@/app/components/landing/FooterSection';
import { CONTACT_EMAIL } from '@/lib/legal';

// ── /contact（お問い合わせ） ────────────────────────────────────
// 連絡先メール（lib/legal.ts の CONTACT_EMAIL）を表示する。フォームは未実装。

export const metadata: Metadata = {
  title: 'お問い合わせ | PASSAI',
  description: 'PASSAI に関するお問い合わせ先のご案内です。',
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
          <p>
            PASSAI に関するお問い合わせは、以下のメールアドレスまでご連絡ください。
          </p>

          <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-5 py-4 text-sm">
            <p className="mb-1 font-semibold text-slate-900">お問い合わせ先</p>
            <p className="text-slate-700">
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-brand-700 hover:underline"
              >
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>

          <p className="text-sm text-slate-500">
            お問い合わせ内容によっては、回答までにお時間をいただく場合があります。
          </p>
        </div>
      </div>

      <FooterSection />
    </div>
  );
}
