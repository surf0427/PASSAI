import Link from 'next/link';
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

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-3">過去の練習記録</h1>
        <p className="text-gray-600 text-sm leading-relaxed">
          これまでの面接練習の記録と改善ポイントを確認できます。
        </p>
      </div>

      <InterviewHistoryClient />

    </div>
  );
}
