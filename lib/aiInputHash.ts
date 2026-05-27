// AI route の input hash 計算層の集約 shim。
// STEP-LIB-02 で feature 別ファイル（lib/hash/<feature>.ts）に物理分割した。
// 本ファイルは旧 import path（'@/lib/aiInputHash'）を維持するための re-export 専用。
//
// 役割（不変）:
//   AI に渡す「入力素材」を deterministic に hash 化し、同入力なら AI call を skip する
//   判定の cache key を作る。client side の「呼ぶ前」レイヤーに置く。
//
// 出力 hash との責務分離（不変）:
//   lib/studentProfile.ts の hashSourceContent / StudentProfile.sourceHash は
//   AI 出力素材を hash する「出力 hash」で、用途は localStorage 書き込みの dedup。
//   本ファイル系列の input hash とは概念も計算式も別で、相互に意味は流用しない。
//
// 新規 import の推奨:
//   - 新規 route / 新規 module は `from '@/lib/hash/<feature>'` を direct 参照する。
//   - 本 shim は互換維持。既存 import 側は触らない（diff 局所性のため）。
//
// 関連（保存層は route ごとに別ファイル・不変）:
//   - lib/wallHittingInputHashStorage.ts        ← /api/analysis（hash のみ。wallHittingResult と AND）
//   - lib/additionalQuestionsCache.ts           ← /api/analysis/additional（hash + questions 同居）
//   - lib/summarizeCache.ts                     ← /api/summarize（hash + SummaryResult 同居）
//   - lib/statementReviewCache.ts               ← /api/statement-review（hash + response 同居）
//   - lib/essayReviewCache.ts                   ← /api/essay-review（hash + ReviewResult 同居）
//   - lib/aiCacheLog.ts                         ← hit/miss 観測ログ（logAiCache）
//   - docs/principles/ai_cache_observability.md ← 観測仕様と route 別の hit 時セマンティクス

export {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_MODEL,
  hashAnalysisInput,
} from '@/lib/hash/analysis';
export type { HashAnalysisInput } from '@/lib/hash/analysis';

export {
  ADDITIONAL_QUESTIONS_PROMPT_VERSION,
  ADDITIONAL_QUESTIONS_MODEL,
  hashAdditionalQuestionsInput,
} from '@/lib/hash/additionalQuestions';
export type { HashAdditionalQuestionsInput } from '@/lib/hash/additionalQuestions';

export {
  SUMMARIZE_PROMPT_VERSION,
  SUMMARIZE_MODEL,
  hashSummarizeInput,
} from '@/lib/hash/summarize';
export type { HashSummarizeInput } from '@/lib/hash/summarize';

export {
  STATEMENT_REVIEW_PROMPT_VERSION,
  STATEMENT_REVIEW_MODEL,
  hashStatementReviewInput,
} from '@/lib/hash/statementReview';
export type { HashStatementReviewInput } from '@/lib/hash/statementReview';

export {
  ESSAY_REVIEW_PROMPT_VERSION,
  ESSAY_REVIEW_MODEL,
  hashEssayReviewInput,
} from '@/lib/hash/essayReview';
export type { HashEssayReviewInput } from '@/lib/hash/essayReview';

export {
  INTERVIEW_QUESTIONS_PROMPT_VERSION,
  INTERVIEW_QUESTIONS_MODEL,
  hashInterviewQuestionsInput,
} from '@/lib/hash/interviewQuestions';
export type { HashInterviewQuestionsInput } from '@/lib/hash/interviewQuestions';

export {
  TUTOR_PROMPT_VERSION,
  TUTOR_MODEL,
} from '@/lib/hash/tutor';

export {
  ESSAY_IMPROVE_SUMMARY_PROMPT_VERSION,
  ESSAY_IMPROVE_SUMMARY_MODEL,
  hashEssayImproveSummaryInput,
} from '@/lib/hash/essayImproveSummary';
export type {
  HashEssayImproveSummaryInput,
  HashEssayImproveSummaryWork,
} from '@/lib/hash/essayImproveSummary';
