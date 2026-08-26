// PASSAI 受験版 Exam Spine — 横断 contract（Stage 1 / 静的宣言のみ）。
//
// 本ファイルは Exam Spine の層をまたいで共有される語彙だけを持つ。
// 純粋な型・定数のみ（I/O / env / secret / Supabase read / AI 呼び出しを一切持たない）。
//
// Stage 1 の位置づけ:
//   - ここに書くのは「受験版が **現在** 何を AI へ渡しているか」の宣言であり、
//     「将来こうしたい」ではない（EXAM_SPINE_STATE.md §13 / Stage 1 制約）。
//   - production runtime からの import はまだ 0 本。接続は Stage 2 以降。
//
// Upstream architecture reference（コードはコピーしない・runtime 依存も作らない）:
//   /Users/yk/PASSAI-CAREER/lib/careerContext/purpose.ts
//   /Users/yk/PASSAI-CAREER/app/api/career/consultation/resolveContextInputs.ts
//
// 関連 Decision: E-L6（CAREER と runtime 共有を作らない）/ E-S9（bridge 2 分類）。

// ── Purpose ───────────────────────────────────────────────────────────
//
// 「どの feature が、どの context を必要とするか」を 1 箇所で宣言するための識別子。
// 値は現行の AI route と 1:1 で対応させる（推測で足さない）。対応表は purpose.ts の
// EXAM_CONTEXT_REGISTRY と lib/examSpine/README.md を正とする。
//
// ★ quota / billing の feature 語彙（lib/billing/quotas.ts の QuotaFeature 8 種）とは
//   意図的に別物である。quota は Spine の外側の前段 gate（E-S10）であり、粒度も違う。
export type ExamContextPurpose =
  // 自己分析（壁打ち）
  | 'self_analysis'
  | 'self_analysis_additional'
  | 'summarize'
  // 志望理由書
  | 'statement_prepare'
  | 'statement_review'
  // 小論文
  | 'essay_themes'
  | 'essay_review'
  | 'essay_chat'
  | 'essay_deep_questions'
  | 'essay_improve_summary'
  // 面接
  | 'interview_questions'
  | 'interview_feedback'
  | 'interview_ai'
  // プレゼン
  | 'presentation_feedback'
  // 横断
  | 'matching'
  | 'self_pr'
  | 'tutor';

export const EXAM_CONTEXT_PURPOSES = [
  'self_analysis',
  'self_analysis_additional',
  'summarize',
  'statement_prepare',
  'statement_review',
  'essay_themes',
  'essay_review',
  'essay_chat',
  'essay_deep_questions',
  'essay_improve_summary',
  'interview_questions',
  'interview_feedback',
  'interview_ai',
  'presentation_feedback',
  'matching',
  'self_pr',
  'tutor',
] as const satisfies readonly ExamContextPurpose[];

/** 外部由来の文字列を purpose として受ける前の narrowing（純関数）。 */
export function isExamContextPurpose(value: unknown): value is ExamContextPurpose {
  return (
    typeof value === 'string' &&
    (EXAM_CONTEXT_PURPOSES as readonly string[]).includes(value)
  );
}

// ── Context origin ────────────────────────────────────────────────────
//
// 「その context field を **どこから取ったか**」。情報内容の provenance
// （本人確定 / 決定論派生 / AI 派生）とは別軸であり、混同してはいけない。
//
// 値の意味（EXAM_SPINE_ARCHITECTURE.md §6 / E-S9 / E-P3）:
//   server              … server 経路（owner-scoped RLS read）から取れた。
//   bridge              … server 経路は存在するが、今回は client bridge を使った
//                          （flag OFF / non-canary / mismatch / unreadable）。= safety fallback。
//   not_server_capable  … server-readable な durable source がそもそも存在しない。
//                          = structural bridge（architecture debt）。
//                          現状の該当例: statementDraft（E-P3 で恒久据え置き）/ analyzeState。
//
// ★ この 3 値目が無いと、canary 中の高い bridge 率を見て「移行が進んでいない」と
//   誤読する。architecture §6 が要求する観測語彙をそのまま型にしている。
//
// Stage 1 ではこの型を使った runtime 判断をしない（宣言のみ）。
export type ExamContextOrigin = 'server' | 'bridge' | 'not_server_capable';
