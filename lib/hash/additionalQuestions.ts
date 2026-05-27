// /api/analysis/additional の input hash。STEP-LIB-02 で lib/aiInputHash.ts から分離。
// 追加質問生成 route の input hash。
// VERSION / MODEL / Hash 型 / 関数の signature と値は分離前と完全に同一。
//
// 関連保存層: lib/additionalQuestionsCache.ts
// 観測ログ: lib/aiCacheLog.ts / docs/principles/ai_cache_observability.md
//
// 注: signature は HashAnalysisInput と違う（existingQuestions が入る）。
// stableStringify / djb2 は共通利用。ANALYSIS_* の contract には一切影響しない。

import { djb2 } from '@/lib/hash/djb2';
import { stableStringify } from '@/lib/hash/stableStringify';

// PROMPT_VERSION bump 履歴:
//   v1 → v2 : STEP15g で SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE /
//             ADDITIONAL_QUESTIONS_SUBJECT_GRADES_QUALIFIER を SYSTEM_PROMPT に接続。
//             user prompt（buildAdditionalQuestionsPrompt の戻り値）は byte-identical。
//             既存 cache の意味的妥当性が変わるため lane を分離する必要があり bump 必須。
export const ADDITIONAL_QUESTIONS_PROMPT_VERSION = 2;
export const ADDITIONAL_QUESTIONS_MODEL = 'claude-sonnet-4-6';

export type HashAdditionalQuestionsInput = {
  activityData: unknown;
  basicInfo: unknown;
  universityContext: unknown;
  // prompt の `【すでに出している質問】` セクションを構成する。
  // 順序が prompt の文面に出るため、stableStringify の array-order 維持に従う。
  existingQuestions: string[];
  model: string;
  promptVersion: number;
};

export function hashAdditionalQuestionsInput(input: HashAdditionalQuestionsInput): string {
  return djb2(stableStringify(input));
}
