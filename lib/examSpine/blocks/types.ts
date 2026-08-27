// PASSAI 受験版 Exam Spine — Layer 2 Context Block contract（Stage 2 / 純粋な型・定数のみ）。
//
// Stage 1 は「どの Source があるか（Layer 1）」と「どの purpose がどの区分を載せるか
// （Layer 3 の粗い方針）」までを宣言した。Stage 2 はその間にある **Layer 2 = Context Block**
// を導入する。block とは「現行 prompt の中で 1 つの semantic section として現れる単位」であり、
// 現行 builder の出力文字列と 1:1 で対応する。
//
// ★ Stage 2 の最重要ルール（EXAM_SPINE_STATE.md / Stage 2 制約）★
//   - production runtime を一切変更しない。本 layer を import する runtime code は 0 本。
//   - 現行 builder の出力 byte を 1 文字も変えない。block は「どう呼ぶか」を決めるだけで、
//     「どう書くか」は現行の共有 formatter に委ねる（同じ section を 2 度実装しない）。
//   - budget を enforce しない（truncate / drop を Stage 2 では行わない。budget.ts §Stage 1 参照）。
//
// 純粋な型・定数のみ（I/O / env / Supabase / AI / Date / Math.random 非依存）。
//
// 関連 Decision: E-P5（feature artifact を Layer 2 に持ち込まない）/ E-P4（氏名の prompt 除外は
//               Stage 2 では実施しない）/ E-S9（origin 3 値）。

import type { ExamContextOrigin } from '../types';
import type { ExamSourceKind } from '../sourceData/types';

// ── Provenance（§ExamDataProvenance）─────────────────────────────────
//
// Stage 1 で意図的に保留していた「その情報を **誰が書いたか**」の軸。
// ExamContextOrigin（どこから取ったか）とは直交する別軸であり、混同してはいけない。
//
// ★ SourceKind 単位では付けられない。例えば kind `essay`（essay_workspaces）は
//   「本人が書いた小論文本文」と「AI が返した添削結果」を同じ table に同居させている。
//   `essay = ai_derived` のような kind 単位ラベルは誤りになるため、provenance は
//   **block 単位**に持つ（Stage 2 の設計要件）。
//
//   user_authored   … 受験生本人が書いた文章、またはそれを情報を足さずに変形したもの
//                     （件数集計 / 抽出 / truncate）。新しい主張を加えない。
//   ai_derived      … LLM が生成した内容（StudentProfile / 添削結果 / 面接フィードバック）。
//   system_metadata … システム側が保持する参照データ（大学 DB / 受験方式ガイダンス /
//                     出題バリエーション指示のような足場）。
//   mixed           … 上記 2 つ以上が **1 つの legacy section に融合しており**、
//                     byte-equivalence を壊さずには分割できないもの。
//                     ★ 安易に使わない。分割できるなら block を分ける。
//                     現在 mixed なのは 4 block だけで、いずれも理由を registry に明記する。
export type ExamDataProvenance =
  | 'user_authored'
  | 'ai_derived'
  | 'system_metadata'
  | 'mixed';

export const EXAM_DATA_PROVENANCES = [
  'user_authored',
  'ai_derived',
  'system_metadata',
  'mixed',
] as const satisfies readonly ExamDataProvenance[];

// ── Derivation ────────────────────────────────────────────────────────
//
// provenance（誰の情報か）とは別に「その block の文字列が **どう作られたか**」を持つ。
//
// これが無いと 2 つの実在するケースを区別できず、mixed が濫用される:
//   1. StudentProfile は AI 生成（ai_derived）だが、
//      buildInterviewStudentProfileContext による整形は決定論。
//   2. ThemeFrequency / UnusedExperience は AI を一切使わない決定論統計だが、
//      材料に AI 由来（StudentProfile）が混じることがある。
//
//   verbatim      … 入力文字列をそのまま載せる（heading 付与のみ）。
//   deterministic … 純関数で整形・集計・truncate した（同入力 → 同出力）。
//   generative    … LLM 出力そのもの。Stage 2 時点で該当 block は無い
//                   （AI 出力は必ず一度 domain 型に落ちてから block になるため）。
export type ExamContentDerivation = 'verbatim' | 'deterministic' | 'generative';

// ── Presence（§Empty / Missing semantics）────────────────────────────
//
// 「出力されなかった」を 1 つの bool に潰すと、現行挙動の再現可否を検証できない。
// Stage 2 では build 時点で 3 値を区別する（purpose による除外は selection 側の情報なので
// ここには持たない ― ExamContextAssembly.excluded が持つ）。
//
//   present … content が非空。legacy も section を出す。
//   empty   … source は与えられたが中身が空（空文字 / 空配列 / 件数不足）。
//             legacy が section を出さない、または placeholder を出すケース。
//   missing … source 自体が渡されていない（null / undefined）。
//
// ★ empty と missing を分けるのは Stage 3 の reader が「読めて 0 件」と「読んでいない」を
//   区別する必要があるため（E-S1 / fail-open の定義）。Stage 2 の render は両者を同じに
//   扱う（legacy がそうだから）が、情報は落とさない。
export type ExamBlockPresence = 'present' | 'empty' | 'missing';

// ── Block ID ──────────────────────────────────────────────────────────
//
// 現行 prompt に実在する semantic section と 1:1。命名は「何の情報か」であって
// 「どの route が使うか」ではない（同じ section を route ごとに別 block にしない）。
//
// ★ variant を分けている箇所（例: self_analysis_statement / _interview / _matching）は
//   「同じ意味だが legacy の整形が実際に違う」ものだけ。formatter が同一なら 1 block に統一する。
export type ExamContextBlockId =
  // 基本情報
  | 'basic_profile'
  | 'subject_grades'
  | 'applicant_profile_basics'
  // 大学・受験方式
  | 'university_context'
  | 'statement_university_context'
  | 'interview_university_context'
  | 'essay_university_context'
  | 'admission_focus'
  | 'exam_type_guidance_statement'
  | 'exam_type_guidance_interview'
  // 活動
  | 'activity_text'
  | 'activity_context'
  | 'activity_context_matching'
  | 'activity_summary'
  | 'activity_category_counts'
  // 診断
  | 'diagnosis_type_hint'
  // 面接
  | 'interview_issue_line'
  // プレゼン
  | 'presentation_result_summary'
  // 自己理解
  | 'self_analysis_statement'
  | 'self_analysis_interview'
  | 'self_analysis_matching'
  | 'self_analysis_questions'
  // divergence（探索 context）
  | 'previous_output_summary'
  | 'theme_frequency'
  | 'theme_frequency_questions'
  | 'unused_experience'
  // 決定論解析
  | 'ng_issues'
  | 'structure_analysis'
  // 横断要約
  | 'tutor_student_context'
  // feature 入力（Spine source ではないが、prompt 全体の byte 再現に必要）
  | 'statement_target'
  | 'statement_summary'
  | 'statement_body'
  | 'self_pr_body'
  | 'analysis_result'
  | 'analysis_qa'
  | 'deep_answers'
  | 'free_memo'
  | 'existing_questions'
  | 'question_variation_seed';

export const EXAM_CONTEXT_BLOCK_IDS = [
  'basic_profile',
  'subject_grades',
  'applicant_profile_basics',
  'university_context',
  'statement_university_context',
  'interview_university_context',
  'essay_university_context',
  'admission_focus',
  'exam_type_guidance_statement',
  'exam_type_guidance_interview',
  'activity_text',
  'activity_context',
  'activity_context_matching',
  'activity_summary',
  'activity_category_counts',
  'diagnosis_type_hint',
  'interview_issue_line',
  'presentation_result_summary',
  'self_analysis_statement',
  'self_analysis_interview',
  'self_analysis_matching',
  'self_analysis_questions',
  'previous_output_summary',
  'theme_frequency',
  'theme_frequency_questions',
  'unused_experience',
  'ng_issues',
  'structure_analysis',
  'tutor_student_context',
  'statement_target',
  'statement_summary',
  'statement_body',
  'self_pr_body',
  'analysis_result',
  'analysis_qa',
  'deep_answers',
  'free_memo',
  'existing_questions',
  'question_variation_seed',
] as const satisfies readonly ExamContextBlockId[];

/** 外部由来の文字列を block id として受ける前の narrowing（純関数）。 */
export function isExamContextBlockId(value: unknown): value is ExamContextBlockId {
  return (
    typeof value === 'string' &&
    (EXAM_CONTEXT_BLOCK_IDS as readonly string[]).includes(value)
  );
}

// ── Block ─────────────────────────────────────────────────────────────
//
// ★ content は「heading を含む legacy section 文字列」ではない場合がある。
//   heading を legacy formatter が自分で付ける section（【生徒の基本情報】等）は content に含まれ、
//   caller が付ける section（【活動データ】等）は render contract 側の slot heading で付く。
//   どちらかを一律に決めると byte が変わるため、registry の `headingOwner` で宣言する。
export type ExamContextBlock = {
  id: ExamContextBlockId;
  /** Layer 1 の source kind。feature 入力 block は undefined（Spine source を持たない）。 */
  sourceKind?: ExamSourceKind;
  provenance: ExamDataProvenance;
  derivation: ExamContentDerivation;
  /**
   * §Context Origin。Stage 2 は source 取得をしないため、caller が申告した値を
   * そのまま透過するだけ（既定は 'bridge'）。Stage 2 でこの値を使った分岐はしない。
   */
  origin: ExamContextOrigin;
  presence: ExamBlockPresence;
  /** presence !== 'present'。Stage 2 の block contract が要求する簡易 flag。 */
  empty: boolean;
  /** legacy formatter が返した文字列そのもの（trim / normalize しない）。 */
  content: string;
  estimatedChars: number;
};

/**
 * block を組み立てる純関数。
 *
 * ★ content に対して trim / normalize / truncate を **一切しない**。
 *   Stage 2 の目的は byte-equivalence であり、ここで空白を触ると全 purpose が壊れる。
 *   `presence` の判定だけは「legacy が section を出さない条件」= 空文字と一致させる。
 */
export function createExamContextBlock(
  id: ExamContextBlockId,
  meta: {
    sourceKind?: ExamSourceKind;
    provenance: ExamDataProvenance;
    derivation: ExamContentDerivation;
  },
  content: string | null | undefined,
  origin: ExamContextOrigin,
): ExamContextBlock {
  const presence: ExamBlockPresence =
    content === null || content === undefined ? 'missing' : content === '' ? 'empty' : 'present';
  const text = content ?? '';
  return {
    id,
    ...(meta.sourceKind ? { sourceKind: meta.sourceKind } : {}),
    provenance: meta.provenance,
    derivation: meta.derivation,
    origin,
    presence,
    empty: presence !== 'present',
    content: text,
    estimatedChars: text.length,
  };
}
