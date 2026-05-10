import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { InterviewHistoryClient } from './components/InterviewHistoryClient';

export default function InterviewHistoryPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">

      <Link
        href="/interview"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors mb-8"
      >
        ← 面接練習トップへ戻る
      </Link>

      <PageHeader
        title="過去の練習記録"
        description="これまでの面接練習の記録と改善ポイントを確認できます。"
        className="mb-8"
      />

      <InterviewHistoryClient />

    </div>
  );
}
