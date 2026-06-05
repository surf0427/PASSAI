// /api/essay-review の input hash。STEP-LIB-02 で lib/aiInputHash.ts から分離。
// 小論文添削 route の input hash。
// VERSION / MODEL / Hash 型 / 関数の signature と値は分離前と完全に同一。
//
// 関連保存層: lib/essayReviewCache.ts
// 観測ログ: lib/aiCacheLog.ts / docs/principles/ai_cache_observability.md
//
// 注: signature は他 hash 関数と違う（theme/themeType/conclusion/reasonOne/reasonTwo/essayBody が入る）。
// stableStringify / djb2 は共通利用。
// ANALYSIS_* / ADDITIONAL_QUESTIONS_* / SUMMARIZE_* / STATEMENT_REVIEW_* の contract には一切影響しない。
//
// hash に含めないもの:
//   - savedReview / reviewHistory の生データ（本文 snapshot / score 系。出力ストックそのもの）
//   - output / feedback / score 系（出力）
//   - loading / error / UI state
//   - temperature / max_tokens は PROMPT_VERSION 側で invalidate を集約
//
// hash に含めるもの（STEP-DIVERGENCE-02B で追加）:
//   - previousOutputSummary（workspace.reviews[] から派生した「既出の助言」の圧縮）。
//     DET-3（essayBody から deterministic 派生・hash 不変）と異なり、reviews は再添削で
//     蓄積し時間で変化するため、これを hash に含めないと「同本文 + 履歴変化」で
//     essayReviewInputHash cache が hit し、divergence prompt が再実行されず feature が
//     実質無効になる。意図的に hash 入力へ含める（statement 02A と同方針）。

import { djb2 } from '@/lib/hash/djb2';
import { stableStringify } from '@/lib/hash/stableStringify';
import type { PreviousOutputSummary } from '@/types/divergence';

// PROMPT_VERSION bump 履歴:
//   v1 → v2 : STEP15h で SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE /
//             ESSAY_REVIEW_SUBJECT_GRADES_QUALIFIER を SYSTEM_PROMPT に接続。
//             user prompt（buildExamTypeEssayGuidance / userMessage 組み立て）は byte-identical。
//             既存 cache の意味的妥当性が変わるため lane を分離する必要があり bump 必須。
//             essay-chat も同 STEP で改修したが cache 概念がないため bump 対象外。
//   v2 → v3 : DET-3 で analyzeStructure() の判定結果を user prompt に【既存構造分析】section と
//             して注入。AI が同じ 6 要素（trigger / problem / action / learning / future /
//             universityConnection）を再 discovery することを避け、改善提案 / 具体例 /
//             improvement の質に token を割けるようにする。構造分析は essayBody から
//             deterministic に派生するため、hash 入力構造（HashEssayReviewInput の signature）は
//             不変（同 essayBody → 同 structure → 同 prompt body の関係が cache identity を保つ）。
//             response shape / JSON contract / breakdown 5 軸 0〜20 / verdict 4 値 / totalScore 0〜100
//             / deriveVerdict 等のサーバ側 normalize はすべて不変。SYSTEM_PROMPT 側に
//             ESSAY_REVIEW_STRUCTURE_ANALYSIS_QUALIFIER を追加し、section の解釈ルール
//             （再判定を抑える / 重複指摘を避ける / 採点には反映しない）を AI に伝える。
//             bump により旧 v2 cache は一律 miss になる（intentional 1 回損失）が、cache hit
//             経路の仕様は何も変えていない。
//   v3 → v4 : STEP-DIVERGENCE-02B で Divergence Layer を essay-review に横展開。
//             workspace.reviews[] から派生した PreviousOutputSummary（既出の weakPoints /
//             improvement の圧縮）を user prompt に【過去に提示済みのフィードバック】section
//             として注入し、出力収束（毎回同じ弱点・同じ improvement・同じ改善指示）を抑える。
//             SYSTEM_PROMPT 側に ESSAY_REVIEW_PREVIOUS_OUTPUT_QUALIFIER を追加（探索型 + 安全弁 /
//             採点・breakdown には不反映）。DET-3 と違い入力源（reviews）が時間で変化するため
//             previousOutputSummary を hash 入力構造（HashEssayReviewInput）にも追加した。
//             同本文でも履歴が変われば hash が変わり、essayReviewInputHash cache を miss させて
//             divergence prompt を必ず再実行させる（これが無いと feature が cache-hit 経路で
//             無効化される）。履歴 0/1 件・projection 空のときは previousOutputSummary が空 struct に
//             なり section も出ないため prompt 本文は旧挙動と等価。bump により旧 v3 cache は一律
//             miss（intentional 1 回損失）。response shape / JSON contract / breakdown 5 軸 0〜20 /
//             verdict 4 値 / totalScore 0〜100 / deriveVerdict 等のサーバ側 normalize は不変。
export const ESSAY_REVIEW_PROMPT_VERSION = 4;
export const ESSAY_REVIEW_MODEL = 'claude-sonnet-4-6';

export type HashEssayReviewInput = {
  theme: string;
  themeType: string;
  conclusion: string;
  reasonOne: string;
  reasonTwo: string;
  essayBody: string;
  basicInfo: unknown;
  // STEP-DIVERGENCE-02B: 過去 review の派生 summary。未指定は関数内で null 正規化する。
  previousOutputSummary?: PreviousOutputSummary | null;
  model: string;
  promptVersion: number;
};

export function hashEssayReviewInput(input: HashEssayReviewInput): string {
  // STEP-DIVERGENCE-02B: previousOutputSummary を hash 対象に含める。未指定は null に正規化し、
  // projection を送らない caller（write/body・structure/body・essay-practice 等）含めて
  // caller 横断で決定論的に同じ hash になるようにする。
  const normalized = {
    ...input,
    previousOutputSummary: input.previousOutputSummary ?? null,
  };
  return djb2(stableStringify(normalized));
}
