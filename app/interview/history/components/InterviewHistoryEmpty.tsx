import Link from 'next/link';

export function InterviewHistoryEmpty() {
  return (
    <div className="text-center py-24">
      <p className="text-gray-400 text-base mb-2">まだ面接練習の記録がありません。</p>
      <p className="text-gray-400 text-sm mb-8">
        練習結果を記録すると、ここに一覧で表示されます。
      </p>
      <Link
        href="/interview/record"
        className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
      >
        練習結果を記録する
      </Link>
    </div>
  );
}
