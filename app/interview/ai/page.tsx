import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { InterviewAiClient } from './InterviewAiClient';

export default function InterviewAiPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <Link
        href="/interview"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors mb-8"
      >
        ← 面接練習トップへ戻る
      </Link>

      <PageHeader
        title="AI面接を受ける"
        description="AIが面接官役になり、質問と深掘りを行います。回答は音声またはテキストで答えられます。"
        className="mb-8"
      />

      <InterviewAiClient />
    </div>
  );
}
