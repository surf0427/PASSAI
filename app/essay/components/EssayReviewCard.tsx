// 1 件の添削結果（ReviewEntry）を表示するカード（STEP C 新規）。
// /essay/result/[wid] で reviews 配列を append-only 時系列表示するために使う。
//
// 表示項目:
//   - 第 N 回 + createdAt
//   - verdict + totalScore
//   - breakdown 5 軸
//   - improvement（最重要枠）
//   - goodPoints
//   - weakPoints
//
// 改善ボタンや rewrite 動線は持たない（STEP C は view only）。

import { formatReviewDate } from '@/lib/essayPracticeStorage';
import type { ReviewEntry } from '@/types/essay';

export function EssayReviewCard({
  review,
  index,
}: {
  review: ReviewEntry;
  index: number;
}) {
  // STEP-SILENT-FALLBACK-01:
  //   review.source が 'fallback' / 'partial' のとき、AI 出力ではなく基本テンプレートが
  //   含まれている可能性があるため UI で明示する。旧データ（source=undefined）は従来挙動。
  const isFallback = review.source === 'fallback';
  const isPartial = review.source === 'partial';

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      {/* ヘッダ: 回数 + 日時 + verdict + totalScore */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold text-gray-600">
          第 {index + 1} 回 添削 · {formatReviewDate(review.createdAt)}
        </p>
        <div className="flex items-center gap-2">
          {review.verdict && (
            <span className="text-xs text-gray-500">{review.verdict}</span>
          )}
          <span className="inline-block text-sm font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {review.totalScore}
          </span>
        </div>
      </div>

      {/* STEP-SILENT-FALLBACK-01: fallback 注意文 */}
      {(isFallback || isPartial) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
          <p className="text-xs text-amber-800 leading-relaxed">
            {isFallback
              ? '一時的にAI生成に失敗したため、基本テンプレートを表示しています。再生成をお試しください。'
              : '一部の内容は基本テンプレートで表示されています。必要に応じて再生成してください。'}
          </p>
        </div>
      )}

      {/* breakdown 5 軸 */}
      {review.breakdown.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
          {review.breakdown.map((item) => (
            <div
              key={item.label}
              className="bg-gray-50 rounded-lg p-2 text-center"
            >
              <p className="text-xs text-gray-500 mb-1">{item.label}</p>
              <p className="text-sm font-semibold text-gray-800">{item.score}</p>
            </div>
          ))}
        </div>
      )}

      {/* improvement（最重要枠） */}
      {review.improvement && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-3">
          <p className="text-xs font-semibold text-blue-700 mb-1">
            最重要の改善点
          </p>
          <p className="text-sm text-gray-800 leading-relaxed">
            {review.improvement}
          </p>
        </div>
      )}

      {/* goodPoints */}
      {review.goodPoints.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-gray-600 mb-1">良かった点</p>
          <ul className="space-y-1">
            {review.goodPoints.map((p, i) => (
              <li key={i} className="text-sm text-gray-800 leading-relaxed">
                ・{p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* weakPoints */}
      {review.weakPoints.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">
            改善できる点
          </p>
          <ul className="space-y-1">
            {review.weakPoints.map((p, i) => (
              <li key={i} className="text-sm text-gray-800 leading-relaxed">
                ・{p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
