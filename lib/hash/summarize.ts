// /api/summarize の input hash。STEP-LIB-02 で lib/aiInputHash.ts から分離。
// 活動まとめ生成 route の input hash。
// VERSION / MODEL / Hash 型 / 関数の signature と値は分離前と完全に同一。
//
// 関連保存層: lib/summarizeCache.ts
// 観測ログ: lib/aiCacheLog.ts / docs/principles/ai_cache_observability.md
//
// 注: signature は他 hash 関数と違う（analysis スナップショット + answers が入る）。
// stableStringify / djb2 は共通利用。
// ANALYSIS_* / ADDITIONAL_QUESTIONS_* の contract には一切影響しない。
//
// displayedQuestions は別途含めない。呼び出し側で analysis.questions を
// displayedQuestions に差し替えてから渡す前提（page.tsx:handleSummarize 参照）。
// 二重カウントを避けるため。

import { djb2 } from '@/lib/hash/djb2';
import { stableStringify } from '@/lib/hash/stableStringify';
import type { SummarizeMode } from '@/types/analysis';

// PROMPT_VERSION bump 履歴:
//   v1 → v2 : prompt に `【受験生の追加深掘りメモ】` optional section を追加
//             （hash 入力にも deepAnswers が増えるため既存 cache とは別レーン化）
//   v2 → v3 : system prompt を light / deep の二系統に分岐
//             （hash 入力に mode が増え、同じ素材でも light と deep は別 cache key になる）
//   v3 → v4 : prompt に `【受験生の自由メモ】` optional section と「未整理な思考として扱う」
//             system 注意文を追加（hash 入力にも freeMemo が増えるため既存 cache と別レーン化）
//   v4 → v5 : STEP15i で SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE /
//             SUMMARIZE_SUBJECT_GRADES_QUALIFIER を light / deep 両 SYSTEM_PROMPT に接続。
//             user prompt（buildSummarizePrompt の戻り値）は byte-identical。
//             summarize は SummaryResult の 3 フィールドが短文中心で「成績表化」リスクが最大の route。
//             既存 cache の意味的妥当性が変わるため lane を分離する必要があり bump 必須。
export const SUMMARIZE_PROMPT_VERSION = 5;
export const SUMMARIZE_MODEL = 'claude-sonnet-4-6';

export type HashSummarizeInput = {
  activityData: unknown;
  basicInfo: unknown;
  universityContext: unknown;
  // page 側で `{ ...analysis, questions: displayedQuestions }` に差し替え済みの想定。
  analysis: unknown;
  // prompt の `【深掘り質問と回答】` セクションの A 側を構成。順序は questions と一対一対応。
  answers: string[];
  // 各質問に対する任意の「追加深掘りメモ」。answers と index 一対一対応・同長。
  // 呼び出し側で normalizeDeepAnswers(input, answers.length) を通した配列を渡す前提:
  //   - 必ず answers と同じ長さ
  //   - 各要素は trim 済み
  //   - 入力がそもそも存在しなければ全要素空文字
  // server route (app/api/summarize/route.ts) も同 helper で正規化するため、
  // 値が一致すれば hash も一致する（cache 同一視）。client / server で trim/長さの
  // 扱いが分岐すると同入力でも cache miss になるため、必ず lib/summarizeNormalize.ts を経由する。
  deepAnswers: string[];
  // /api/summarize の生成モード。同じ素材でも light と deep は別 cache key になる。
  // 呼び出し側で decideSummarizeMode(answers, deepAnswers) で都度算出した値を渡す前提。
  // server 側も同じ helper か同等の fallback で確定するため、両側で必ず一致する。
  mode: SummarizeMode;
  // 任意の自由メモ（全体単位）。呼び出し側で normalizeFreeMemo(input) を通した
  // 「trim + FREE_MEMO_MAX_CHARS truncate 済み」文字列を渡す前提。
  //   - 入力が無ければ '' を渡す（undefined を渡さない: stableStringify が key を落として
  //     旧 hash と衝突しないようにするため required にする）
  //   - server route も同 helper で truncate するため、client/server で必ず値が一致する
  // /api/summarize の cache key のみに作用する。StudentProfile / Context Builder には流さない。
  freeMemo: string;
  model: string;
  promptVersion: number;
};

export function hashSummarizeInput(input: HashSummarizeInput): string {
  return djb2(stableStringify(input));
}
