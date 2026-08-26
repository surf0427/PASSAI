// PASSAI 受験版 Exam Spine — Stage 4 Wave 2 / adapter contract（型と語彙のみ）。
//
// Wave 2 の位置づけ:
//   real source data → **kind-specific adapter** → normalized observation → Wave 1 primitives
//
// ★★ この層が決めないこと ★★
//   - どちらを採用するか（Canon §31 / §32。E-S2 は「verified 以外は使わない」だけを決める）
//   - authority がどちらにあるか（E-L2 / E-S2 / E-S3 が既に決めている。ここは読むだけ）
//   - context veto policy（kind ごとの固定は Canon §41 / Stage 4 の別 unit）
//   - runtime wiring / header / route 接続（E-S2 の wire 形式は Wave 3 以降）
//
// ★ mixed-origin を型で防ぐ（Canon §17 / DoD §68）★
//   1 つの observation は **1 つの kind × 1 つの source identity** しか表せない。
//   observation を candidate へ変換する関数は expected source identity を要求し、
//   server 由来の観測を device claim として渡すと throw する。

import type { ExamSourceKind, ExamSourceAuthorityClass, ExamSourceReadStatus } from '../../sourceData/types';
import type { ExamFingerprint } from '../fingerprint';
import type { ExamRevisionValue } from '../revision';
import { ABSENT_REVISION } from '../revision';
import type { ExamSyncCandidate } from '../verification';
import { EMPTY_CANDIDATE, UNCLAIMED_CANDIDATE, UNREADABLE_CANDIDATE, presentCandidate } from '../verification';

// ── source identity ───────────────────────────────────────────────────

/**
 * 「その観測が **どの representation** を見たものか」。
 * canonical / mirror という **役割**（authority が決める）とは別軸で、
 * ここは物理的な出所だけを言う。
 */
export type ExamSyncSourceIdentity = 'device_canonical' | 'server_mirror';

export const EXAM_SYNC_SOURCE_IDENTITIES = [
  'device_canonical',
  'server_mirror',
] as const satisfies readonly ExamSyncSourceIdentity[];

// ── contract 語彙 ─────────────────────────────────────────────────────

/** Source-Sync 検証がその kind に対して成立するか。 */
export type ExamSyncCapability =
  /** contract が確定し、adapter が実装されている。 */
  | 'possible'
  /** contract が未確定（Register / Canon 側の blocker 待ち）。adapter を実装しない。 */
  | 'blocked'
  /** そもそも適用してはいけない（E-S3: class 2 には Source-Sync を適用しない）。 */
  | 'not_applicable';

/** kind 単位の list をどう比較するか。 */
export type ExamSyncOrderSemantics =
  /** 順序が往復し、順序自体が情報。generic layer のまま（sort しない）。 */
  | 'sequence'
  /** 順序が往復しないことを証明済み。deterministic sort で正規化する。 */
  | 'multiset'
  /** 単数 snapshot（kind 単位の list が存在しない）。 */
  | 'single';

/** content fingerprint から field を外す理由。文字列自由記述にしない（分類を固定する）。 */
export type ExamSyncExclusionReason =
  /** DB 生成値で device 側に存在しない（uuid PK など）。 */
  | 'db_generated_not_on_device'
  /** DB trigger が now() で上書きするため device 値と一致しない。 */
  | 'trigger_overwritten'
  /** writer が条件付きでしか送らず、欠落時は DB DEFAULT が入る。 */
  | 'conditional_write'
  /** 既に含まれている field から純粋に導出されるだけで、独立した情報を持たない。 */
  | 'derived_from_included_field'
  /** reader が SELECT しない（E-P5 / 最小権限）。両側とも見ないので比較対象にならない。 */
  | 'not_selected_by_reader'
  /** 型レベルの目印であって source の内容ではない。 */
  | 'type_marker_not_content';

export type ExamSyncExcludedField = {
  readonly field: string;
  readonly reason: ExamSyncExclusionReason;
  /** file:line 相当の実コード根拠。空文字を許さない（QA が検査する）。 */
  readonly evidence: string;
};

/** revision（Canon §16）の kind 別契約。 */
export type ExamSyncRevisionContract =
  | {
      readonly form: 'absent';
      /** なぜ revision を作らないか。「無いものを生成しない」根拠。 */
      readonly reason: string;
    }
  | {
      readonly form: 'declared';
      readonly field: string;
      readonly timezone: ExamSyncTimezoneSemantics;
      readonly evidence: string;
    };

export type ExamSyncTimezoneSemantics =
  /** 常に UTC offset を伴う（timestamptz column / toISOString）。 */
  | 'offset_bearing'
  /** offset が付かない可能性がある。UTC と仮定してはいけない。 */
  | 'zone_unknown'
  | 'not_applicable';

/**
 * Source Adapter Matrix の 1 行。**宣言（データ）**であり、実装ではない。
 * QA がこの宣言と実 adapter の挙動の一致を検査する。
 */
export type ExamSyncAdapterContract = {
  readonly kind: ExamSourceKind;
  readonly authority: ExamSourceAuthorityClass;
  readonly capability: ExamSyncCapability;
  /** Canon / Register 上の canonical source。 */
  readonly canonicalSource: string;
  /** 物理的な mirror / server source。 */
  readonly physicalSource: string;
  /** 実際の read path（file 名）。 */
  readonly readPath: string;
  /** content fingerprint に入れる field（sync view の key 集合と一致すること）。 */
  readonly contentFields: readonly string[];
  /** 明示的に外す field と理由。 */
  readonly excludedFields: readonly ExamSyncExcludedField[];
  readonly order: ExamSyncOrderSemantics;
  readonly revision: ExamSyncRevisionContract;
  /** capability が possible でない理由（Register の blocker ID など）。 */
  readonly blocker: string | null;
};

// ── observation ───────────────────────────────────────────────────────

/**
 * 1 representation を 1 回観測した結果。
 *
 * ★ view 本体（＝本文）を持たない ★
 *   observation を持ち回ると自己PR / 志望理由書 / 面接記録の本文がそのまま流れる。
 *   比較に必要なのは fingerprint と revision だけなので、内容は保持しない（E-S13 / Canon §55）。
 */
export type ExamSyncObservation = {
  readonly kind: ExamSourceKind;
  readonly source: ExamSyncSourceIdentity;
  readonly fingerprint: ExamFingerprint;
  readonly revision: ExamRevisionValue;
};

export class ExamSyncOriginError extends Error {
  readonly expected: ExamSyncSourceIdentity;
  readonly actual: ExamSyncSourceIdentity;
  readonly kind: ExamSourceKind;

  constructor(kind: ExamSourceKind, expected: ExamSyncSourceIdentity, actual: ExamSyncSourceIdentity) {
    super(`[examSpine/sync] mixed origin: kind=${kind} expected=${expected} actual=${actual}`);
    this.name = 'ExamSyncOriginError';
    this.kind = kind;
    this.expected = expected;
    this.actual = actual;
  }
}

function assertOrigin(
  observation: ExamSyncObservation,
  expected: ExamSyncSourceIdentity,
): void {
  if (observation.source !== expected) {
    throw new ExamSyncOriginError(observation.kind, expected, observation.source);
  }
}

// ── Wave 1 primitives への接続 ────────────────────────────────────────
//
// ★ ここでも採用側を返さない ★
//   返すのは Wave 1 の `ExamSyncCandidate` だけであり、「どちらを使うか」は含まれない。

/**
 * server mirror の read 結果 → candidate。
 *
 * E-S2 の verdict 優先順位（`unreadable` > `unclaimed` > `mismatch` > `verified`）と
 * E-S8（`truncated` / `error` を freshness の権威にしない）に従い、
 * **status が `ok` 以外はすべて unreadable** とする。
 *   truncated : cap まで読めただけで全件ではない → 「読めた」と言ってはいけない
 *   error     : RLS / network / schema
 *   skipped   : その request で読んでいない（読めた証拠が無い）
 *
 * ★ Wave 2.5 追記 1 — purpose gate（E-S28）と `skipped` ★
 *   E-S28 の default deny により、purpose が許可していない kind は query を 1 本も発行せず
 *   `status='skipped'` のままになる。ここではそれも `unreadable` へ倒す（fail-closed）。
 *   ただし **denied kind に対して verdict を求めること自体が設計上の誤り**である。
 *   loader は `gateExamSourceKinds` が通した kind についてだけ verification を組むこと。
 *   「gate で落ちた kind が veto 理由として観測される」状態を作らない。
 *
 * ★ Wave 2.5 追記 2 — `ok` + 0 行の限界（E-H1 / Canon §40）★
 *   `authenticated` の SELECT policy が本番に無い場合、PostgREST は 403 ではなく
 *   **200 + 0 行**を返す。Stage 3 reader はこれを `status='ok'` / `rows=[]` として扱うため、
 *   本 adapter も `EMPTY_CANDIDATE` を作る。つまり **UNREADABLE が EMPTY に見える**経路が
 *   残っており、これは runtime では検出できない（E-H1 §なぜ runtime で検出できないか）。
 *   安全側の性質は保たれる:
 *     device に中身あり × mirror が空 → mismatch（presence）→ veto
 *     device も空       × mirror も空 → verified / both_empty（内容としては正しい）
 *   すなわち **verified を誤って出すことは無く**、影響は「その kind が使えないままになる」
 *   ことに留まる。policy の実在確認は E-H1 / R6（BLOCKED_BY_ENV）が閉じる。
 */
export function serverMirrorCandidate(input: {
  readonly status: ExamSourceReadStatus;
  /** read が ok で、かつデータが存在したときだけ observation を渡す。空なら null。 */
  readonly observation: ExamSyncObservation | null;
}): ExamSyncCandidate {
  if (input.status !== 'ok') return UNREADABLE_CANDIDATE;
  if (input.observation === null) return EMPTY_CANDIDATE;
  assertOrigin(input.observation, 'server_mirror');
  return presentCandidate({
    fingerprint: input.observation.fingerprint,
    revision: input.observation.revision,
  });
}

/**
 * device canonical の申告 → candidate。
 *
 * `claimPresented === false` は「client がその kind の revision を提示していない」＝
 * E-S2 の `unclaimed`。「device にデータが無い」（empty）と区別する。
 */
export function deviceCanonicalCandidate(input: {
  readonly claimPresented: boolean;
  readonly observation: ExamSyncObservation | null;
}): ExamSyncCandidate {
  if (!input.claimPresented) return UNCLAIMED_CANDIDATE;
  if (input.observation === null) return EMPTY_CANDIDATE;
  assertOrigin(input.observation, 'device_canonical');
  return presentCandidate({
    fingerprint: input.observation.fingerprint,
    revision: input.observation.revision,
  });
}

/** revision を宣言していない kind の既定値（「無いものを生成しない」）。 */
export const NO_SYNC_REVISION: ExamRevisionValue = ABSENT_REVISION;
