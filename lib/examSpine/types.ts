// Exam Spine — core source contracts（Phase 1）。
//
// 位置づけ:
//   受験版 Exam Spine の「語彙」だけを固定する層。**runtime 挙動を持たない**。
//   Phase 1 時点では production コードからの consumer はゼロで、
//   Phase 2 以降の read / project / select 層がここに依存する。
//
// 厳守（本ファイルの不変条件）:
//   - 純型 + 純データのみ。副作用を持つものを一切 import しない。
//   - fetch / Supabase client / localStorage / Date.now / Math.random / AI SDK を import しない。
//   - isomorphic（client からも server からも import 可能）。'server-only' を付けない。
//   - 巨大な万能 context 型（ExamSpineContext 相当）をここに作らない。
//     feature が受け取る contract は Phase 4 以降の selector の戻り値型で表現する。
//
// 関連:
//   docs/principles/exam_spine/EXAM_SPINE_ARCHITECTURE.md §3（Source Authority Classes）
//   docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md   E-L2 / E-L3 / E-L4 / E-S1

// ── 1. Source kind ────────────────────────────────────────────────
//
// Spine が読み取り対象とする source の単位。**table 名ではなく概念名**で持つ。
// 1 kind が複数 table にまたがることがある（例: presentation は results / attempts /
// sessions を横断して 1 つの「最新プレゼン結果」を成す）。
//
// ここに載っていない kind は Spine の対象外。特に:
//   - `*_mirrors` 4 table … user_id 列も owner SELECT policy も持たない匿名 sink。
//     所有者を特定できないため Spine は恒久的に読まない。
//   - profiles / usage_records / subscriptions … 課金・quota は Spine の外（E-S10）。
//   - statementDraft / analyzeState … durable table が存在しない client 一時状態。

export type ExamSourceKind =
  | 'basic_info'
  | 'activity'
  | 'diagnosis'
  | 'self_analysis'
  | 'statement_review'
  | 'essay'
  | 'self_pr'
  | 'interview_record'
  | 'interview_ai'
  | 'presentation';

export const EXAM_SOURCE_KINDS: readonly ExamSourceKind[] = [
  'basic_info',
  'activity',
  'diagnosis',
  'self_analysis',
  'statement_review',
  'essay',
  'self_pr',
  'interview_record',
  'interview_ai',
  'presentation',
] as const;

// ── 2. Authority class ────────────────────────────────────────────
//
// 「その kind の原本がどこにあるか」の分類。Phase 4 以降の Source-Sync 検証で
// 扱いを変えるために kind 単位で持つ（E-L2）。
//
//   device_canonical_mirrored
//     canonical は端末の localStorage。auth-scoped table は cross-device 復元用の
//     durable source。server が読んだ内容が「その request を出した端末の canonical」と
//     一致する保証は無い。
//
//   server_authoritative
//     server route が著者であり、client 側の copy は表示用 cache にすぎない。
//     「client canonical」という概念が存在しないため、Source-Sync 検証を
//     適用してはいけない（E-S3）。

export type ExamSourceAuthorityClass =
  | 'device_canonical_mirrored'
  | 'server_authoritative';

export const EXAM_SOURCE_AUTHORITY: Readonly<
  Record<ExamSourceKind, ExamSourceAuthorityClass>
> = {
  basic_info: 'device_canonical_mirrored',
  activity: 'device_canonical_mirrored',
  diagnosis: 'device_canonical_mirrored',
  self_analysis: 'device_canonical_mirrored',
  statement_review: 'device_canonical_mirrored',
  essay: 'device_canonical_mirrored',
  self_pr: 'device_canonical_mirrored',
  interview_record: 'device_canonical_mirrored',
  // server route が作成・更新する。client は結果表示のみ。
  interview_ai: 'server_authoritative',
  presentation: 'server_authoritative',
} as const;

// ── 3. Layer 1 durable table（参照用）──────────────────────────────
//
// kind → 主となる durable table。**Spine の read はここに列挙された table に限る。**
// 補助的に横断する table（presentation_attempts / presentation_sessions /
// interview_ai_results）は主 table の owner RLS 配下で辿るため、代表 table のみ載せる。
//
// ⚠️ この表は「Spine が触ってよい範囲」の宣言であって、schema の正本ではない。
//    schema の正本は supabase/schema.sql。

export const EXAM_SOURCE_PRIMARY_TABLE: Readonly<
  Record<ExamSourceKind, string>
> = {
  basic_info: 'basic_info_logs',
  activity: 'activity_logs',
  diagnosis: 'diagnosis_logs',
  self_analysis: 'self_analysis_logs',
  statement_review: 'statement_review_history',
  essay: 'essay_workspaces',
  self_pr: 'self_prs',
  interview_record: 'interview_practice_records',
  interview_ai: 'interview_ai_sessions',
  presentation: 'presentation_results',
} as const;

// ── 4. SourceState ────────────────────────────────────────────────
//
// fail-open semantics（E-S1）の型表現。**「無い」と「取れなかった」を型で区別する。**
//
//   ready       … 読み取れて、中身がある
//   absent      … 正常。まだ作られていない（新規ユーザー / 未入力）
//   unavailable … 取得に失敗した（table 不存在 / RLS 拒否 / 通信エラー / 例外）
//
// 重要な運用規約:
//   - absent と unavailable は **型では区別するが、prompt 上は同じ扱い**にする。
//     AI に「取得に失敗しました」を伝えない（幻覚の誘発と内部状態の漏洩を避ける）。
//   - 観測ログには enum として区別を残してよい（E-S12 / E-S13。PII・本文は出さない）。
//   - unavailable を理由に Spine 全体を失敗させてはいけない。他 kind は通常どおり返す。

export type SourceState<T> =
  | { status: 'ready'; value: T }
  | { status: 'absent' }
  | { status: 'unavailable' };

/** ready state を作る。value が無いときは absent を使うこと。 */
export function sourceReady<T>(value: T): SourceState<T> {
  return { status: 'ready', value };
}

/** 正常な未作成状態。 */
export const SOURCE_ABSENT: SourceState<never> = { status: 'absent' };

/** 取得失敗。呼び出し側は absent と同等に「情報なし」として扱う。 */
export const SOURCE_UNAVAILABLE: SourceState<never> = { status: 'unavailable' };

/** ready かどうかの type guard。 */
export function isSourceReady<T>(
  state: SourceState<T>,
): state is { status: 'ready'; value: T } {
  return state.status === 'ready';
}

/**
 * ready なら value、そうでなければ null。
 * absent / unavailable を同一視してよい呼び出し側（= prompt 組み立て側）向け。
 */
export function sourceValueOrNull<T>(state: SourceState<T>): T | null {
  return state.status === 'ready' ? state.value : null;
}
