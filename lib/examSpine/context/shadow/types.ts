// PASSAI 受験版 Exam Spine — Stage 5.1 shadow comparison の contract（型のみ）。
//
// 目的: consumer を切り替える **前に**、
//   「legacy と canonical で何が同じで / 何が足りず / 何が余分で / 何が意味的に違うか」
// を機械的に確定する。
//
// ★ 差分ゼロを目的にしない ★
//   Canonical Spine は legacy の 100% 複製ではない。本文・不要履歴・legacy 専用の
//   便宜 metadata は **意図的に載せない**（E-P5 / Canon §55）。
//   それらを `MISSING_CANONICAL` と数えると「移行すると情報が減る」という誤った結論になる。
//   目的は byte 一致ではなく **意味的な migration readiness** である。
//
// ★ raw user content を持たない ★
//   entry が持つのは field id / diff kind / hash / 長さ / origin / status / reason だけ。
//   `legacyValue: "志望理由書本文…"` のような field は**型として存在しない**（E-S13 / §13）。
//
// 純粋な型のみ。I/O / env / Date / Math.random 非依存。

import type { ExamSourceKind } from '../../sourceData/types';
import type { ExamContextOrigin, ExamContextPurpose } from '../../types';
import type { ExamFingerprint } from '../../sync/fingerprint';
import type { ExamSyncStatus } from '../../sync/verification';
import type { ExamContextSourceState } from '../types';

/** contract の版。比較の意味論を変えたら上げる。 */
export const EXAM_SHADOW_COMPARISON_VERSION = 'esc1';

// ── Diff kind ─────────────────────────────────────────────────────────
//
// ★ 増やしすぎない ★
//   「なぜ移行できないか」を説明するのに必要な最小集合にとどめる。
export type ExamShadowDiffKind =
  /** legacy と canonical が意味的に一致し、canonical が server 由来で使える。 */
  | 'MATCH'
  /** legacy にあるが canonical に無い（意図的除外ではない）。移行で情報が減る＝E-P7 違反候補。 */
  | 'MISSING_CANONICAL'
  /** canonical にあるが legacy に無い。移行で情報が増える。 */
  | 'EXTRA_CANONICAL'
  /** 双方にあるが意味的に違う。移行で prompt の内容が変わる。 */
  | 'VALUE_MISMATCH'
  /**
   * 値は一致するが canonical の origin が `server` ではない（bridge に落ちている）。
   * ★ これを MATCH に潰さない ★
   *   「一致した」のではなく「canonical が legacy と同じ bridge 値を使っただけ」であり、
   *   移行しても server 経路の実効化にはならない。Source-Sync が verified でないことが原因。
   */
  | 'ORIGIN_MISMATCH'
  /**
   * legacy に値があるが、canonical source が available でない
   * （unverified / unreadable / denied_by_purpose / unsupported）。
   * 値の比較自体が成立しないので VALUE_MISMATCH と区別する。
   */
  | 'STATUS_MISMATCH'
  /** canonical が意図的に持たない（本文・PII・legacy 専用 metadata）。欠落ではない。 */
  | 'INTENTIONALLY_OMITTED'
  /** 比較する canonical block / kind がまだ定義されていない（Stage 2 coverage 外）。 */
  | 'UNCOMPARABLE';

export const EXAM_SHADOW_DIFF_KINDS = [
  'MATCH',
  'MISSING_CANONICAL',
  'EXTRA_CANONICAL',
  'VALUE_MISMATCH',
  'ORIGIN_MISMATCH',
  'STATUS_MISMATCH',
  'INTENTIONALLY_OMITTED',
  'UNCOMPARABLE',
] as const satisfies readonly ExamShadowDiffKind[];

/** `INTENTIONALLY_OMITTED` / `UNCOMPARABLE` の理由。enum のみ。 */
export type ExamShadowOmissionReason =
  /** 本文（志望理由書 / 小論文 / 面接逐語）は canonical に載せない（E-P5 / Canon §55）。 */
  | 'raw_body_excluded'
  /** 氏名は server payload に存在しない（E-P8）。bridge が保持する。 */
  | 'pii_excluded'
  /** legacy 専用の便宜 metadata（マイページ集計等）で canonical source を持たない。 */
  | 'legacy_only_metadata'
  /** その kind の Stage 2 block が未定義（coverage 外）。 */
  | 'no_canonical_block'
  /** durable source が存在しない（structural bridge / E-P3）。 */
  | 'not_server_capable';

// ── Entry ─────────────────────────────────────────────────────────────
//
// ★ 値そのものを持たない ★
export type ExamShadowDiffEntry = {
  /** 比較単位の識別子。`<kind>.<field>` 形式。 */
  readonly field: string;
  /** 対応する Layer 1 kind。kind に紐づかない legacy 専用項目は null。 */
  readonly kind: ExamSourceKind | null;
  readonly diff: ExamShadowDiffKind;
  /** legacy 側の値の fingerprint。値が無ければ null。 */
  readonly legacyFingerprint: ExamFingerprint | null;
  /** canonical 側の値の fingerprint。値が無ければ null。 */
  readonly canonicalFingerprint: ExamFingerprint | null;
  /** 正規化後の文字数（長文の規模を掴むため。内容は持たない）。 */
  readonly legacyChars: number;
  readonly canonicalChars: number;
  /** canonical source の状態。kind が無い項目は null。 */
  readonly canonicalState: ExamContextSourceState | null;
  readonly canonicalOrigin: ExamContextOrigin | null;
  readonly syncStatus: ExamSyncStatus | null;
  /** 意図的除外 / 比較不能の理由。 */
  readonly reason: ExamShadowOmissionReason | null;
};

// ── Readiness ─────────────────────────────────────────────────────────
//
// source/block 単位で出す。「Tutor 全体 READY / NOT_READY」は粗すぎて使えない。
export type ExamMigrationReadiness =
  /** canonical へ切り替えても意味が落ちない。 */
  | 'READY'
  /** 切り替えると情報が減る / 変わる。原因を解消するまで移行しない。 */
  | 'NOT_READY'
  /** 別 Stage の作業待ち（block 未実装 / Source-Sync 未通電など）。 */
  | 'DEFERRED'
  /** 恒久的に legacy が持つ（canonical に載せない設計）。 */
  | 'INTENTIONALLY_LEGACY';

export type ExamSourceReadinessEntry = {
  readonly kind: ExamSourceKind;
  readonly readiness: ExamMigrationReadiness;
  /** 判定根拠の diff kind（そのまま報告できる enum）。 */
  readonly blockingDiffs: readonly ExamShadowDiffKind[];
  readonly canonicalState: ExamContextSourceState;
  readonly canonicalOrigin: ExamContextOrigin;
};

// ── Comparison ────────────────────────────────────────────────────────

export type ExamShadowOverall =
  /** 比較できた全項目が MATCH。 */
  | 'equivalent'
  /** MATCH ＋ 意図的除外のみ。移行しても意味は落ちない。 */
  | 'compatible_with_omissions'
  /** 値・origin・status のいずれかで移行に影響する差がある。 */
  | 'not_equivalent'
  /** 比較可能な項目が無い（canonical が何も読めていない等）。 */
  | 'insufficient_evidence';

export type ExamShadowComparison = {
  readonly version: typeof EXAM_SHADOW_COMPARISON_VERSION;
  readonly purpose: ExamContextPurpose;
  readonly overall: ExamShadowOverall;
  readonly comparableCount: number;
  readonly matchCount: number;
  readonly mismatchCount: number;
  readonly intentionalOmissionCount: number;
  readonly entries: readonly ExamShadowDiffEntry[];
  readonly readiness: readonly ExamSourceReadinessEntry[];
  /** 比較に投入した正規化材料のバイト数（性能記録用）。 */
  readonly inputBytes: number;
};
