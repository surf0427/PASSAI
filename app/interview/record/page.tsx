import Link from 'next/link';
import { InterviewRecordForm } from './components/InterviewRecordForm';

export default function InterviewRecordPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">

      <Link
        href="/interview"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors mb-8"
      >
        ← 面接練習トップへ戻る
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-3">練習結果を記録する</h1>
        <p className="text-gray-600 text-sm leading-relaxed">
          対人で面接練習をした後に、質問内容や自分の回答を記録できます。
        </p>
      </div>

      <InterviewRecordForm />

    </div>
  );
}
