// /api/statement-review の input hash。STEP-LIB-02 で lib/aiInputHash.ts から分離。
// 志望理由書添削 route の input hash。
// VERSION / MODEL / Hash 型 / 関数の signature と値は分離前と完全に同一。
//
// 関連保存層: lib/statementReviewCache.ts
// 観測ログ: lib/aiCacheLog.ts / docs/principles/ai_cache_observability.md
//
// 注: signature は他 hash 関数と違う（university/faculty/department/essay 等が入る）。
// stableStringify / djb2 は共通利用。
// ANALYSIS_* / ADDITIONAL_QUESTIONS_* / SUMMARIZE_* の contract には一切影響しない。
//
// hash に含めないもの:
//   - statementReviewHistory（出力ストック、入力ではない）
//   - statementReviewLimit（観測対象だが AI 入力ではない）
//   - score / feedback / 全 response 系（出力）
//   - temperature / max_tokens は PROMPT_VERSION 側で invalidate を集約

import { djb2 } from '@/lib/hash/djb2';
import { stableStringify } from '@/lib/hash/stableStringify';

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
//   v5 → v6 : STEP C（applicantType）で buildStatementStudentProfileContext に
//             applicantType（5 種 enum）から派生する「傾向: ラベル — ヒント」1 行を
//             optional context として注入。APPLICANT_TYPE_LABELS と statement-review
//             ローカルの hint table から日本語ラベル + 短い AI 向けヒントを「断定ではない
//             参考情報」として 1 行追加する。scoring rule（5 軸 8〜20）には踏み込まない。
//             hash 入力構造（HashStatementReviewInput の signature）は不変。
//             studentProfile field は STEP A/B で applicantType を持つ形に拡張済みのため、
//             applicantType を持つ profile は studentProfile JSON の差で hash が変わる
//             （applicantType=undefined の旧 profile は hash 等価のまま）。bump によって
//             旧 v5 cache が新 prompt 出力契約に流入することを防ぐ（intentional 1 回 miss）。
//             user prompt（buildStatementReviewPrompt の戻り値）の組み立て関数は byte-identical。
//   v6 → v7 : DET-2 で detectNgWords() の判定結果を user prompt に【既知のNG指摘候補】
//             section として注入。AI が同じ phrase を再 discovery することを避け、改善提案や
//             深い構造分析に注力できるようにする。NG 検出は essay / activityData / university /
//             faculty から deterministic に派生するため、hash 入力構造（HashStatementReviewInput
//             の signature）は不変（同入力 → 同 NG → 同 prompt body の関係が cache identity を
//             保つ）。response shape / JSON contract / scoring rule（5 軸 8〜20）も不変。
//             SYSTEM_PROMPT 側に STATEMENT_REVIEW_NG_ISSUES_QUALIFIER を追加し、section の
//             解釈ルール（再判定を抑える / 重複指摘を避ける / 採点には反映しない）を AI に伝える。
//             bump により旧 v6 cache は一律 miss になる（intentional 1 回損失）が、cache hit 経路の
//             仕様は何も変えていない。
//   v7 → v8 : DET-4 で analyzeStructure() の判定結果を user prompt に【既存構造分析】
//             section として注入（DET-3 で essay-review に入れた構造注入を statement-review に
//             横展開）。AI が同じ 6 要素（trigger / problem / action / learning / future /
//             universityConnection）を再 discovery することを避け、改善提案 / partialExamples /
//             actions に token を割けるようにする。構造分析は essay のみから deterministic に
//             派生するため、hash 入力構造（HashStatementReviewInput の signature）は不変
//             （同 essay → 同 structure → 同 prompt body の関係が cache identity を保つ）。
//             response shape / JSON contract / scoring rule（5 軸 8〜20）も不変。SYSTEM_PROMPT
//             側に STATEMENT_REVIEW_STRUCTURE_ANALYSIS_QUALIFIER を追加して section の
//             解釈ルール（再判定を抑える / 採点には反映しない）を AI に伝える。DET-2 の NG
//             section と独立 / 共存（順序: structure → ng → 【本文】、大局 → 細部 → 本体）。
//             bump により旧 v7 cache は一律 miss になる（intentional 1 回損失）が、cache hit 経路の
//             仕様は何も変えていない。
export const STATEMENT_REVIEW_PROMPT_VERSION = 8;
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
