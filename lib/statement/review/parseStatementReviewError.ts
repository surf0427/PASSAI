// STEP9.2: 志望理由書 AI 添削 (/api/statement-review) の error response 解析 helper。
//   API は失敗時に { error: 'AI_REVIEW_TRUNCATED' | 'AI_REVIEW_PARSE_FAILED', message: '...' }
//   の構造化 JSON を返す（STEP5.x で導入）。後方互換のため error フィールドが文言の場合も
//   そのまま fallback に使う。
//
// 設計判断:
//   - pure 関数。side effect / storage / fetch / hook / async は持たない。
//   - statement/review feature-specific。generic な parseAiError(...) は別 feature の
//     error 構造が違う可能性があるため意図的に避ける（STEP9.1 の方針）。
//   - 優先順位: data.message → data.error → fallback の固定文言。
//     submitReview 内のインライン式と完全に同じ semantics を保つ。

export function parseStatementReviewError(data: unknown): string {
  const obj = data as { message?: string; error?: string };

  return (
    obj.message ??
    obj.error ??
    'AIの処理に失敗しました。時間をおいてお試しください。'
  );
}
