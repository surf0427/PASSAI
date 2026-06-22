import Link from 'next/link';

import { PageHeader } from '@/components/ui/PageHeader';

import { PresentationUniversityClient } from './PresentationUniversityClient';

export default function PresentationUniversityPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <Link
        href="/presentation"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors mb-8"
      >
        ← プレゼン対策トップへ戻る
      </Link>

      <PageHeader
        title="志望大学の設定"
        description="志望大学・学部・入試方式に合わせてプレゼン対策を最適化します。大学名以外は任意です。"
        className="mb-8"
      />

      <PresentationUniversityClient />
    </div>
  );
}
