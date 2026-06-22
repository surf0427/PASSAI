import Link from 'next/link';

import { PageHeader } from '@/components/ui/PageHeader';

import { PresentationSetupClient } from './PresentationSetupClient';

export default function PresentationSetupPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <Link
        href="/presentation"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors mb-8"
      >
        ← プレゼン対策トップへ戻る
      </Link>

      <PageHeader
        title="テーマ設定"
        description="プレゼンの条件を設定します。設定後に録画へ進みます。"
        className="mb-8"
      />

      <PresentationSetupClient />
    </div>
  );
}
