import { Suspense } from 'react';
import Link from 'next/link';

import { PageHeader } from '@/components/ui/PageHeader';

import { PresentationResultClient } from './PresentationResultClient';

export default function PresentationResultPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <Link
        href="/presentation"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors mb-8"
      >
        ← プレゼン対策トップへ戻る
      </Link>

      <PageHeader
        title="プレゼン評価"
        description="AI によるカテゴリ評価と、録画の見返しができます。"
        className="mb-8"
      />

      <Suspense fallback={<p className="text-sm text-slate-500">読み込み中…</p>}>
        <PresentationResultClient />
      </Suspense>
    </div>
  );
}
