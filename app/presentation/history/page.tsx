import Link from 'next/link';

import { PageHeader } from '@/components/ui/PageHeader';

import { PresentationHistoryClient } from './PresentationHistoryClient';

export default function PresentationHistoryPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <Link
        href="/presentation"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors mb-8"
      >
        ← プレゼン対策トップへ戻る
      </Link>

      <PageHeader
        title="プレゼン対策履歴"
        description="録画したプレゼンと AI 評価を見返せます。"
        className="mb-8"
      />

      <PresentationHistoryClient />
    </div>
  );
}
