// AI route の input hash 計算層（STEP5.2 で導入、STEP5.4 / 5.8 / 5.10 / 5.11 で拡張）。
//
// 役割:
//   AI に渡す「入力素材」を deterministic に hash 化し、同入力なら AI call を skip する
//   判定の cache key を作る。client side の「呼ぶ前」レイヤーに置く。
//
// 出力 hash との責務分離:
//   lib/studentProfile.ts の hashSourceContent / StudentProfile.sourceHash は
//   AI 出力素材を hash する「出力 hash」で、用途は localStorage 書き込みの dedup。
//   本ファイルの input hash とは概念も計算式も別で、相互に意味は流用しない。
//
// 関連（保存層は route ごとに別ファイル）:
//   - lib/wallHittingInputHashStorage.ts        ← /api/analysis（hash のみ。wallHittingResult と AND）
//   - lib/additionalQuestionsCache.ts           ← /api/analysis/additional（hash + questions 同居）
//   - lib/summarizeCache.ts                     ← /api/summarize（hash + SummaryResult 同居）
//   - lib/statementReviewCache.ts               ← /api/statement-review（hash + response 同居）
//   - lib/essayReviewCache.ts                   ← /api/essay-review（hash + ReviewResult 同居）
//   - lib/aiCacheLog.ts                         ← hit/miss 観測ログ（logAiCache）
//   - docs/principles/ai_cache_observability.md ← 観測仕様と route 別の hit 時セマンティクス

import { djb2 } from '@/lib/hash/djb2';

// プロンプト本文を変更した時に bump する版数。これを上げると既存 cache が一律 miss になる。
// STEP5.2 時点では 1。ANALYSIS_SYSTEM_PROMPT / buildWallHittingPrompt を改修するときに +1 する。
//
// PROMPT_VERSION bump 履歴:
//   v1 → v2 : STEP15f で SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE /
//             ANALYSIS_SUBJECT_GRADES_QUALIFIER を SYSTEM_PROMPT に接続。
//             user prompt（buildWallHittingPrompt の戻り値）は byte-identical。
//             analysis の出力は StudentProfile に固定化され下流に伝染するため、
//             qualifier では「評定値・欠席日数を strengths/weaknesses/futureConnections/summary
//             に残さない」を最重要制約として明示している。既存 cache の意味的妥当性が変わるため
//             lane を分離する必要があり bump 必須。
export const ANALYSIS_PROMPT_VERSION = 2;

// /api/analysis が使用するモデル。server route.ts 側の MODEL 定数と一致させること。
// モデル変更は cache invalidation の主因なので hash 入力に必ず含める。
export const ANALYSIS_MODEL = 'claude-sonnet-4-6';

export type HashAnalysisInput = {
  activityData: unknown;
  basicInfo: unknown;
  universityContext: unknown;
  model: string;
  promptVersion: number;
};

export function hashAnalysisInput(input: HashAnalysisInput): string {
  return djb2(stableStringify(input));
}

// ── /api/analysis/additional 用（STEP5.4） ─────────────────────────
//
// 追加質問生成 route の input hash。STEP5.2 の hashAnalysisInput とは
// signature が違う（existingQuestions が入る）ので別 export として並列に置く。
// stableStringify / djb2 内部ヘルパーは共通利用。
// ANALYSIS_* の contract には一切手を入れない。
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

// ── /api/summarize 用（STEP5.8 / STEP-self-analysis-2: deepAnswers / STEP-self-analysis-3: mode） ──
//
// 活動まとめ生成 route の input hash。同 file の他 hash 関数とは signature が違う
// （analysis スナップショット + answers が入る）ので別 export として並列に置く。
// stableStringify / djb2 内部ヘルパーは共通利用。
// ANALYSIS_* / ADDITIONAL_QUESTIONS_* の contract には一切手を入れない。
//
// 注: displayedQuestions は別途含めない。呼び出し側で analysis.questions を
// displayedQuestions に差し替えてから渡す前提（page.tsx:handleSummarize 参照）。
// 二重カウントを避けるため。
//
// PROMPT_VERSION bump 履歴:
//   v1 → v2 : prompt に `【受験生の追加深掘りメモ】` optional section を追加
//             （hash 入力にも deepAnswers が増えるため既存 cache とは別レーン化）
//   v2 → v3 : system prompt を light / deep の二系統に分岐
//             （hash 入力に mode が増え、同じ素材でも light と deep は別 cache key になる）
//   v3 → v4 : prompt に `【受験生の自由メモ】` optional section と「未整理な思考として扱う」
//             system 注意文を追加（hash 入力にも freeMemo が増えるため既存 cache と別レーン化）
import type { SummarizeMode } from '@/types/analysis';

// v4 → v5 履歴は STEP15i:
//   STEP15i で SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE /
//   SUMMARIZE_SUBJECT_GRADES_QUALIFIER を light / deep 両 SYSTEM_PROMPT に接続。
//   user prompt（buildSummarizePrompt の戻り値）は byte-identical。
//   summarize は SummaryResult の 3 フィールドが短文中心で「成績表化」リスクが最大の route。
//   既存 cache の意味的妥当性が変わるため lane を分離する必要があり bump 必須。
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

// ── /api/statement-review 用（STEP5.10） ──────────────────────────
//
// 志望理由書添削 route の input hash。同 file の他 hash 関数とは signature が違う
// （university/faculty/department/essay 等が入る）ので別 export として並列に置く。
// stableStringify / djb2 内部ヘルパーは共通利用。
// ANALYSIS_* / ADDITIONAL_QUESTIONS_* / SUMMARIZE_* の contract には一切手を入れない。
//
// hash に含めないもの:
//   - statementReviewHistory（出力ストック、入力ではない）
//   - statementReviewLimit（観測対象だが AI 入力ではない）
//   - score / feedback / 全 response 系（出力）
//   - temperature / max_tokens は PROMPT_VERSION 側で invalidate を集約
//
// PROMPT_VERSION bump 履歴:
//   v1 → v2 : STEP15b で SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE /
//             STATEMENT_REVIEW_SUBJECT_GRADES_QUALIFIER を SYSTEM_PROMPT に接続。
//             user prompt（buildStatementReviewPrompt の戻り値）は byte-identical。
//             既存 cache の意味的妥当性が変わるため lane を分離。
//   v2 → v3 : STEP4b で Admission Focus Context を user prompt に optional section として接続
//             （universityDbSection の直後に admissionFocusContext を差し込み）。
//             university / faculty / department / examTypes から deterministic に派生するため
//             hash 入力構造は変更しないが、同入力でも prompt 本文が変わり improvements /
//             weaknesses / actions の出力が大学側の評価軸を反映するようになるため bump 必須。
//   v3 → v4 : STEP5b で SYSTEM_PROMPT のスコアルール矛盾を解消。
//             旧 v3 は「各項目 8〜20」「totalScore 60〜100」「totalScore は合計と一致」の
//             三者が低品質エッセイ（各軸合計 40〜59）で同時成立せず、Claude が floor を優先して
//             合計と一致しない totalScore を返していた。v4 では totalScore を「5 項目の単純合計
//             値そのまま・サーバで再計算」と明記し、60 点未満禁止と合計一致の二重制約を撤廃。
//             hash 入力構造 / JSON contract / 各 score 範囲（8〜20）は不変。出力 totalScore の
//             数値分布が変わるため既存 v3 cache の意味的妥当性が変わり bump 必須。
//   v4 → v5 : STEP-F で hash 入力から wallHittingResult を除外し、自己分析素材の
//             cache identity を canonical StudentProfile 一本に揃える。同素材を
//             studentProfile / wallHittingResult の 2 object で二重に hash していたのを
//             1 object に縮める変更（hash 入力構造が変わる）。route.ts / prompt 本文は
//             不変で、prompt 側は今後も studentProfile ?? toStudentProfile(wallHittingResult)
//             の fallback を維持するため、wallHittingResult-only ユーザの prompt 品質は
//             落ちない。bump によって旧 v4 cache は一律 miss になる（intentional 1 回損失）。
//             STEP-F は minimum migration。studentProfile.generatedAt drift の完全解消は
//             別 STEP（hash 入力を sourceHash 一本に絞る等）として残す。
export const STATEMENT_REVIEW_PROMPT_VERSION = 5;
export const STATEMENT_REVIEW_MODEL = 'claude-sonnet-4-6';

// hash と prompt body の input source は STEP-F 以降 intentional に非対称:
//   - hash 入力 (本 type): canonical StudentProfile のみ。wallHittingResult は含めない
//   - prompt body (route.ts に渡す JSON): studentProfile / wallHittingResult の両方
//     （route.ts 側の prompt builder が canonical 優先 + wallHitting fallback で参照する）
// この非対称は、cache identity を canonical 一本に揃えつつ、canonical 不在ユーザの
// prompt 品質を落とさないための trade-off。app/statement/edit/page.tsx 側の呼び出し
// コメントも同趣旨を明記している。
export type HashStatementReviewInput = {
  university: string;
  faculty: string;
  department: string;
  essay: string;
  basicInfo: unknown;
  activityData: unknown;
  studentProfile: unknown;
  model: string;
  promptVersion: number;
};

export function hashStatementReviewInput(input: HashStatementReviewInput): string {
  return djb2(stableStringify(input));
}

// ── /api/essay-review 用（STEP5.11） ──────────────────────────────
//
// 小論文添削 route の input hash。同 file の他 hash 関数とは signature が違う
// （theme/themeType/conclusion/reasonOne/reasonTwo/essayBody が入る）ので
// 別 export として並列に置く。stableStringify / djb2 内部ヘルパーは共通利用。
// ANALYSIS_* / ADDITIONAL_QUESTIONS_* / SUMMARIZE_* / STATEMENT_REVIEW_* の
// contract には一切手を入れない。
//
// hash に含めないもの:
//   - savedReview / reviewHistory（出力ストック）
//   - output / feedback / score 系（出力）
//   - loading / error / UI state
//   - temperature / max_tokens は PROMPT_VERSION 側で invalidate を集約
// PROMPT_VERSION bump 履歴:
//   v1 → v2 : STEP15h で SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE /
//             ESSAY_REVIEW_SUBJECT_GRADES_QUALIFIER を SYSTEM_PROMPT に接続。
//             user prompt（buildExamTypeEssayGuidance / userMessage 組み立て）は byte-identical。
//             既存 cache の意味的妥当性が変わるため lane を分離する必要があり bump 必須。
//             essay-chat も同 STEP で改修したが cache 概念がないため bump 対象外。
export const ESSAY_REVIEW_PROMPT_VERSION = 2;
export const ESSAY_REVIEW_MODEL = 'claude-sonnet-4-6';

export type HashEssayReviewInput = {
  theme: string;
  themeType: string;
  conclusion: string;
  reasonOne: string;
  reasonTwo: string;
  essayBody: string;
  basicInfo: unknown;
  model: string;
  promptVersion: number;
};

export function hashEssayReviewInput(input: HashEssayReviewInput): string {
  return djb2(stableStringify(input));
}

// ── /api/interview-questions 用（STEP8） ──────────────────────────
//
// 面接質問生成 route の input hash。同 file の他 hash 関数とは signature が違う
// （statementDraft / studentProfile / activitySummary が入る）ので別 export として並列に置く。
// stableStringify / djb2 内部ヘルパーは共通利用。
// 既存 _PROMPT_VERSION / _MODEL の contract には一切手を入れない。
//
// hash に含めるもの:
//   - basicInfo（大学 / 学部 / 学科 / 受験方式）→ user prompt と route 内 universityContext を左右する
//   - statementDraft（university/faculty/department/statementText）→ 個別質問の根拠
//   - studentProfile（strengths / valueKeywords / futureConnections / 等）→ 自己分析セクション
//   - activitySummary（壁打ち由来の活動まとめ）→ 活動深掘り質問の根拠
//
// hash に含めないもの:
//   - generatedAt / sourceHash 等の出力メタ
//   - loading / UI state
//   - additionalQuestions の追加結果（legacy 用、AI 出力対象外）
//
// PROMPT_VERSION bump 履歴:
//   v1 → v2 : STEP15c で SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE /
//             INTERVIEW_QUESTIONS_SUBJECT_GRADES_QUALIFIER を SYSTEM_PROMPT に接続。
//             user prompt（buildInterviewQuestionUserPrompt / buildInterviewQuestionMaterials の
//             戻り値）は byte-identical。既存 cache の意味的妥当性が変わるため lane を分離。
export const INTERVIEW_QUESTIONS_PROMPT_VERSION = 2;
export const INTERVIEW_QUESTIONS_MODEL = 'claude-sonnet-4-6';

export type HashInterviewQuestionsInput = {
  basicInfo: unknown;
  statementDraft: unknown;
  studentProfile: unknown;
  activitySummary: unknown;
  model: string;
  promptVersion: number;
};

export function hashInterviewQuestionsInput(input: HashInterviewQuestionsInput): string {
  return djb2(stableStringify(input));
}

// ── 内部ヘルパ ─────────────────────────────────────────────────────

// 正規化方針:
//   - object key は ASCII 昇順に並べ替える（入力の field 順ゆらぎを吸収）
//   - undefined フィールドは object から除外（"無い" と "明示的 undefined" を同一視）
//   - string は trim（前後空白の差で別 hash になるのを防ぐ）
//   - array は順序を維持（順序は本質的な意味を持つ場合があるため）
//   - null は null のまま保持
// 同じ「意味の入力」を同じ文字列に正規化することで、hash 一致を再現可能にする。
function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const normalized = normalize(obj[key]);
      if (normalized === undefined) continue;
      out[key] = normalized;
    }
    return out;
  }
  // function / symbol / bigint は AI 入力には現れない想定。混入時は null として畳む。
  return null;
}

// djb2 hash 本体は lib/hash/djb2.ts に集約（STEP-D）。
// 用途は input hash（同入力なら AI call を skip する cache key）で、
// lib/studentProfile.ts:hashSourceContent（出力 hash）とは責務が違う点は不変。
// hash 値は集約前と完全に同一（同入力 → 同 hash）。
