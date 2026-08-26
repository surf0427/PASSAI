// PASSAI 受験版 Exam Spine — device revision claim の transport contract（型・定数のみ）。
//
// E-S2 が要求する「client が算出した revision token を header で申告し、server が
// mirror から再算出した値と照合する」経路の **transport 部分**を固定する。
//
// ★ claim は verification input であって policy input ではない ★
//   claim にできるのは「server 側データを **使わない** 方向へ倒す」ことだけである。
//   claim は次のいずれも **できない**（型と parser で構造的に閉じる）:
//     - user identity を主張する（owner scoping は server auth のみ / E-L3）
//     - purpose の source gate を広げる（E-S28）
//     - authority / table を指定する（E-S15）
//     - 自分自身を verified と宣言する（判定は server の照合結果だけ）
//     - RLS を迂回する
//
// ★ token は content 由来の fingerprint である ★
//   E-S2 の "revision token" は、adapter registry が宣言するとおり **content 由来 token**
//   を指す（`sync/adapters/registry.ts`: 「往復する revision token が存在しないため
//   生成しない（E-S2 は content 由来 token を signal とする）」）。
//   E-S2 が却下した *content hash を送る* は「本文が network を通る」ことへの拒否であり、
//   本文を送らない fingerprint はこれに当たらない。本文は 1 byte も header に載らない。
//
// 純粋な型・定数のみ。I/O / env / Supabase / Date / Math.random 非依存。isomorphic。

import type { ExamSourceKind } from '../../sourceData/types';

/**
 * header 名。**1 個だけ**を canonical とする。
 *
 * 命名は既存の慣行（小文字 kebab / `x-` prefix）に合わせる。
 * ★ 値には fingerprint しか入らない。cookie / token / PII を相乗りさせない。
 */
export const EXAM_DEVICE_CLAIM_HEADER = 'x-exam-spine-device-claim';

/** wire format の版。parser は未知の版を **黙って無視**する（fail-safe）。 */
export const EXAM_DEVICE_CLAIM_VERSION = 'edc1';

/**
 * header 値の上限（bytes）。
 *
 * 一般的な server / proxy の 1 header あたりの制限（8KB 前後）に対して十分小さく取る。
 * 上限を超えた claim は **切り詰めず破棄**する（切り詰めると別 fingerprint になり、
 * 意味の無い mismatch を生むため）。
 */
export const EXAM_DEVICE_CLAIM_MAX_BYTES = 2048;

/** 1 header に載せてよい kind 数の上限。class 1 は 8 kind しかないので余裕を持たせる。 */
export const EXAM_DEVICE_CLAIM_MAX_ENTRIES = 12;

/**
 * fingerprint の書式。`sync/fingerprint.ts` の `efp1:<hex64>` に一致すること。
 * parser はこの正規表現でしか受け付けない（任意文字列を通さない）。
 */
export const EXAM_DEVICE_CLAIM_TOKEN_PATTERN = /^efp1:[0-9a-f]{64}$/;

/**
 * 1 kind ぶんの申告。
 *
 * ★ ここに増やしてよい field は「照合に必要なもの」だけ ★
 *   userId / table / authority / purpose / 本文 / 件数 / 時刻 は入れない。
 *   時刻を入れると「client timestamp だけで verified 判定する」経路の誘惑ができる（E-S2 違反）。
 */
export type ExamDeviceClaimEntry = {
  readonly kind: ExamSourceKind;
  /** content 由来 token（`efp1:<hex64>`）。 */
  readonly token: string;
};

/** header 全体の wire 表現。 */
export type ExamDeviceClaimEnvelope = {
  readonly v: typeof EXAM_DEVICE_CLAIM_VERSION;
  readonly c: readonly ExamDeviceClaimEntry[];
};

/** parse 結果。**never throw**。 */
export type ExamDeviceClaimParse = {
  /** kind → token。検証を通ったものだけ。 */
  readonly claims: Readonly<Partial<Record<ExamSourceKind, string>>>;
  /**
   * 破棄した理由。観測用（enum のみ / PII なし / E-S12・E-S13）。
   * ★ header 本文をそのまま載せない。
   */
  readonly rejected: readonly ExamDeviceClaimRejection[];
};

export type ExamDeviceClaimRejectionReason =
  /** header 自体が無い。「申告しない」は正常な状態（→ unclaimed）。 */
  | 'absent'
  /** JSON として読めない。 */
  | 'malformed'
  /** 知らない wire version。 */
  | 'unknown_version'
  /** header が上限を超えている。 */
  | 'oversize'
  /** entry 数が上限を超えている。 */
  | 'too_many_entries'
  /** `ExamSourceKind` に無い kind。 */
  | 'unknown_kind'
  /** 同じ kind が 2 回現れた。 */
  | 'duplicate_kind'
  /** token が `efp1:<hex64>` の形をしていない。 */
  | 'invalid_token'
  /** class 2 など Source-Sync 非対象の kind（E-S3）。 */
  | 'not_syncable';

export type ExamDeviceClaimRejection = {
  /** 判定できた場合のみ。判定前に落ちたものは null。 */
  readonly kind: ExamSourceKind | null;
  readonly reason: ExamDeviceClaimRejectionReason;
};

export const EMPTY_DEVICE_CLAIM_PARSE: ExamDeviceClaimParse = {
  claims: {},
  rejected: [],
};
