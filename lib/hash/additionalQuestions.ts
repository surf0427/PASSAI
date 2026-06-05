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
//   v4 → v5 : STEP-DIVERGENCE-03C で ThemeFrequency Layer を追加質問生成に導入。activityData から
//             決定論派生したテーマ偏り（よく出ている / まだ薄いテーマ）を user prompt に
//             【テーマ探索の参考】section として注入し、同じテーマばかり語ることによる探索範囲の
//             縮小を防ぐ。SYSTEM_PROMPT 側に ADDITIONAL_QUESTIONS_THEME_FREQUENCY_QUALIFIER を追加
//             （探索型のみ / 強み断定せず / 存在しない経験を前提にせず / StudentProfile に反映しない /
//             活動データに接続できる場合のみ / generic 禁止・v3/v4 品質要件を維持）。
//             ThemeFrequency は activityData からの deterministic 派生で、activityData は既に
//             HashAdditionalQuestionsInput に含まれている（DET 系と同型）。よって hash 入力構造
//             （signature）は不変・新規 field を追加しない（同 activityData → 同 ThemeFrequency →
//             同 prompt body の関係で cache identity を保つ）。route 側で buildThemeFrequency() を
//             生成するため body 追加も caller 変更も不要。質問生成のみに作用し、profile 生成
//             （analysisPrompt / summarizePrompt / toStudentProfile）には一切影響しない。
//             prompt 本文が変わり出力が変わるため bump 必須。bump により旧 v4 cache は一律 miss
//             （intentional 1 回損失）。questions=2 ルール / JSON schema / response shape は不変。
export const ADDITIONAL_QUESTIONS_PROMPT_VERSION = 5;
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
