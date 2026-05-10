import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { InterviewQuestionForm } from './components/InterviewQuestionForm';

export default function InterviewQuestionsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">

      <Link
        href="/interview"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors mb-8"
      >
        ← 面接練習トップへ戻る
      </Link>

      <PageHeader
        title="予想質問を作る"
        description="志望大学や活動内容を入力すると、面接で聞かれそうな質問を作成できます。"
        className="mb-8"
      />

      <InterviewQuestionForm />

    </div>
  );
}
