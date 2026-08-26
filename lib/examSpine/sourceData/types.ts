// PASSAI 受験版 Exam Spine — Layer 1 Source Data の型・定数（Stage 1 / 静的宣言のみ）。
//
// 純粋な型・定数のみ（I/O / env / Supabase 非依存）。後続 Stage の server reader と
// rowMappers と QA がここを共有する。**Stage 1 では誰も import しない**。
//
// Upstream architecture reference（コードはコピーしない・runtime 依存も作らない）:
//   /Users/yk/PASSAI-CAREER/lib/careerSourceData/types.ts
//
// 関連 Decision:
//   E-L1 … class 1 は localStorage を canonical のまま維持する
//   E-L2 … authority class を kind 単位で持つ（mapping の正本は EXAM_SPINE_ARCHITECTURE.md §3）
//   E-L3 / E-L4 … owner auth + RLS が identity authority。service-role を使わない
//   E-S1 / E-S8 … fail-open は「context を減らして続行」。truncated / error を権威にしない
//   E-P5 … Layer 2 に feature artifact（本文 / 録画 / turn 全文 / 氏名）を持ち込まない

// ── Source kind ───────────────────────────────────────────────────────
//
// server 側で読み得る Layer 1 Source の種別。**EXAM_SPINE_ARCHITECTURE.md §3 の表が正本**。
// Stage 1 で kind を勝手に足さない（E-L2）。
export type ExamSourceKind =
  // class 1 — device_canonical_mirrored
  | 'basic_info'
  | 'activity'
  | 'diagnosis'
  | 'self_analysis'
  | 'statement_review'
  | 'self_pr'
  | 'essay'
  | 'interview_record'
  // class 2 — server_authoritative
  | 'interview_ai'
  | 'presentation';

export const EXAM_SOURCE_KINDS = [
  'basic_info',
  'activity',
  'diagnosis',
  'self_analysis',
  'statement_review',
  'self_pr',
  'essay',
  'interview_record',
  'interview_ai',
  'presentation',
] as const satisfies readonly ExamSourceKind[];

/** 外部由来の文字列を kind として受ける前の narrowing（純関数）。 */
export function isExamSourceKind(value: unknown): value is ExamSourceKind {
  return (
    typeof value === 'string' &&
    (EXAM_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

// ── Source authority class（E-L2）─────────────────────────────────────
//
// class 1 — device_canonical_mirrored:
//   canonical は端末の localStorage。Supabase は best-effort mirror。server が読んだ内容が
//   「その request を出した端末の canonical」と一致する保証が無いため、後続 Stage で
//   Source-Sync による **負の安全ゲート**（使わない方向へ倒す検証）が要る（E-S2）。
//
// class 2 — server_authoritative:
//   **server route が著者**であり、client 側の copy は表示用 cache にすぎない。
//   「client canonical」という概念が無いので Source-Sync を適用してはいけない（E-S3）。
//   適用すると「client の cache が古い＝server の正しいデータを使えない」という
//   逆向きの誤りになる。
//
// ★ class 2 でも canary gate（purpose opt-in AND canary user）は同じように必要。
//   免除されるのは Source-Sync verification だけで、authorization は免除されない。
//
// ★ Stage 1 では authority を使った runtime 判断を **しない**。宣言のみ。
export type ExamSourceAuthorityClass =
  | 'device_canonical_mirrored'
  | 'server_authoritative';

export const EXAM_SOURCE_AUTHORITY: Readonly<
  Record<ExamSourceKind, ExamSourceAuthorityClass>
> = {
  // class 1: localStorage canonical → *_logs / *_history / *_workspaces へ mirror。
  basic_info: 'device_canonical_mirrored',
  activity: 'device_canonical_mirrored',
  diagnosis: 'device_canonical_mirrored',
  self_analysis: 'device_canonical_mirrored',
  statement_review: 'device_canonical_mirrored',
  self_pr: 'device_canonical_mirrored',
  essay: 'device_canonical_mirrored',
  interview_record: 'device_canonical_mirrored',
  // class 2: server route が作成・更新し、client は結果表示のみ。
  //   interview_ai  … app/api/interview-ai/{session,turn,complete}/route.ts が著者
  //   presentation  … app/api/presentation/{evaluate,qa,complete}/route.ts が著者
  //                   （子表 attempts / results / qa_turns は schema.sql §60 系の方針で
  //                     authenticated からの書込 policy を持たず server route 専用）
  interview_ai: 'server_authoritative',
  presentation: 'server_authoritative',
};

// ── Layer 1 durable source table（supabase/schema.sql と一致させる）────
//
// 1 kind が複数 table にまたがるものがあるため、CAREER の 1:1 map ではなく配列で持つ。
// Stage 1 では read しない（table 名の宣言のみ）。
//
// ★ registry に無い table を reader から黙って読んではいけない。
//   この表は「その kind の read path に現れてよい table の全集合」であり、
//   Stage 3 の QA が SELECT 先をここと突き合わせる。
//
// ★ `presentation_practice_records`（schema.sql §66）は **意図的に含めない**。
//   対人プレゼン記録（友達 / 先生 / 親）の localStorage mirror であり、
//   AI 不使用・課金なし・録画なしで、現行の受験版 AI route はどこからも読んでいない。
//   分類は `dormant_no_author`:
//     - server route が著者ではない（= class 2 ではない）
//     - Spine の read path に入っていない（= 現時点でどの purpose の context にも寄与しない）
//   したがって `ExamSourceKind` にも authority binary にも追加せず、Stage 3 reader は
//   SELECT しない。既存 authority token（`device_canonical_mirrored` /
//   `server_authoritative`）は rename しない。将来使うことになったら、その時点で
//   kind 追加として別途 decision を起こす。
export const EXAM_SOURCE_TABLES: Readonly<
  Record<ExamSourceKind, readonly string[]>
> = {
  basic_info: ['basic_info_logs'],
  activity: ['activity_logs'],
  diagnosis: ['diagnosis_logs'],
  self_analysis: ['self_analysis_logs'],
  statement_review: ['statement_review_history'],
  self_pr: ['self_prs'],
  essay: ['essay_workspaces'],
  interview_record: ['interview_practice_records'],
  interview_ai: ['interview_ai_sessions', 'interview_ai_results'],
  // presentation enrichment が実際に presentation_sessions を読むため 3 table。
  // 1:N registry の completeness 修正であり、新しい kind の追加ではない（Human Decision B9）。
  presentation: ['presentation_results', 'presentation_attempts', 'presentation_sessions'],
};

// ── Read status（E-S1 / E-S8）─────────────────────────────────────────
//
//   ok        : 読めた（0 行でも ok。空 = 「Source が空」という確定情報）。
//   truncated : 上限まで読めたが全件ではない可能性がある。freshness の権威にしない。
//   error     : table missing / network / RLS 拒否等。freshness の権威にしない。
//   skipped   : その request で要求されなかった。
//
// fail-open の定義は「context を減らして AI を続行する」であり、
// 「verified できない古いデータを代わりに使う」ではない（EXAM_SPINE_ARCHITECTURE.md §5）。
export type ExamSourceReadStatus = 'ok' | 'truncated' | 'error' | 'skipped';

// ── Source bundle ─────────────────────────────────────────────────────
//
// 後続 Stage の loader が埋める container contract。
//
// ★ 値を `unknown` にしているのは意図的である（Stage 1 は rowMapper 責務を持たない）。
//   既存 domain 型をここで宣言すると、Stage 3 の rowMappers が決めるべき「行 → domain」の
//   写像を先取りしてしまい、しかも現時点で **実態と食い違う**。実例:
//     basic_info_logs.payload は lib/supabase/basicInfoLogs.ts が `name` を strip して書くため、
//     `types/basicInfo.ts` の `BasicInfo`（name 必須）とは一致しない。
//   したがって Stage 1 は「どの slot が何件入るか」だけを宣言し、要素型は Stage 3 で確定させる。
//   単数 / 配列の別と、対応する kind・table はここでコメントとして固定する。
export type ExamSourceBundle = {
  /** kind `basic_info` / basic_info_logs（単数・最新 1 件） */
  basicInfo: unknown | null;
  /** kind `activity` / activity_logs（単数・最新 1 件） */
  activity: unknown | null;
  /** kind `diagnosis` / diagnosis_logs（単数・最新 1 件） */
  diagnosis: unknown | null;
  /** kind `self_analysis` / self_analysis_logs（履歴） */
  selfAnalysisLogs: readonly unknown[] | null;
  /** kind `statement_review` / statement_review_history（履歴） */
  statementReviews: readonly unknown[] | null;
  /** kind `self_pr` / self_prs（複数） */
  selfPrs: readonly unknown[] | null;
  /** kind `essay` / essay_workspaces（複数・LRU） */
  essayWorkspaces: readonly unknown[] | null;
  /** kind `interview_record` / interview_practice_records（履歴） */
  interviewRecords: readonly unknown[] | null;
  /** kind `interview_ai` / interview_ai_sessions + interview_ai_results（履歴・server 著作） */
  interviewAi: readonly unknown[] | null;
  /** kind `presentation` / presentation_results + presentation_attempts（履歴・server 著作） */
  presentation: readonly unknown[] | null;
};

/**
 * 読めなかった / 要求しなかったときの既定。
 * `null` は「この request では埋まっていない」を意味し、空配列（= Source が空）とは区別する。
 */
export const EMPTY_EXAM_SOURCE_BUNDLE: ExamSourceBundle = {
  basicInfo: null,
  activity: null,
  diagnosis: null,
  selfAnalysisLogs: null,
  statementReviews: null,
  selfPrs: null,
  essayWorkspaces: null,
  interviewRecords: null,
  interviewAi: null,
  presentation: null,
};
