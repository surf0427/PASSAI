import Link from 'next/link';

import { PageHeader } from '@/components/ui/PageHeader';

import { PresentationHubClient } from './PresentationHubClient';

export default function PresentationPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <Link
        href="/home"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors mb-8"
      >
        ← ホームへ戻る
      </Link>

      <PageHeader
        title="プレゼン練習"
        description="本番に近いプレゼン練習。録画した発表を AI がカテゴリ評価し、発表後に深掘り質問を行います（Premium 限定）。"
        className="mb-8"
      />

      <PresentationHubClient />
    </div>
  );
}
