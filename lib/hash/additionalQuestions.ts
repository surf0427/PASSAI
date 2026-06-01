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
//   v2 → v3 : STEP-SELFANALYSIS-QUESTION-QUALITY-01 で「質問品質要件（必須）」と「禁止」
//             section を ADDITIONAL_QUESTIONS_SYSTEM_PROMPT に追加。activity 名・テーマ・
//             固有名詞への直接言及を必須化し、generic 質問（「なぜ始めましたか」等）を
//             明示的に禁止した。同 STEP で deterministic pool skip 経路（additionalQuestionsPool.ts）
//             も完全廃止し、AI 経路のみとなる。
//             prompt の意味が大きく変わるため lane 分離が必要で bump 必須。
//   v3 → v4 : STEP-SELFANALYSIS-QUESTION-QUALITY-02 で【読みやすさ要件】と NG / OK 例を
//             ADDITIONAL_QUESTIONS_SYSTEM_PROMPT に追加。1 質問に複数の問いを詰め込まない
//             ことと 60〜110 字目安を明文化。具体言及・generic 禁止ルールは不変。
//             prompt の指示が増えるため v3 cache の意味的妥当性が変わり bump 必須。
export const ADDITIONAL_QUESTIONS_PROMPT_VERSION = 4;
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
