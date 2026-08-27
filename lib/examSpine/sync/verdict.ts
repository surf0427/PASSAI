// PASSAI 受験版 Exam Spine — Stage 4 Wave 4 / external verdict（純関数）。
//
//   validated claim（E-S33 / sync/claim/** の出力）
//     ×
//   server mirror observation（Wave 2 adapters）
//     ×
//   read status（Stage 3）
//        ↓
//   E-S2 の **4 値** verdict
//
// ★★ 外部 verdict は 4 値だけ ★★
//   E-S2（LOCKED）が列挙するのは `unreadable` / `unclaimed` / `mismatch` / `verified` である。
//   Wave 1 の内部 status は第 5 値 `incomparable` を持つが、**外部へは出さない**。
//   `incomparable → verified` は禁止。畳み先は下記 `foldInternalStatus` に 1 箇所だけ置き、
//   「構造的に発生しない」ことを無言の cast ではなく **観測可能な flag + QA** で固定する。
//
// ★ 優先順位（E-S2）★
//   unreadable > unclaimed > mismatch > verified
//   「読めていない」を最優先で表面化し、検証不能を verified に落とさない。
//
// ★ 採用側は決めない ★
//   verdict は「その source を **使ってよいか**」だけを述べる。
//   どちらを採るか / 直すか / 混ぜるかは Authority Contract の仕事であり本 file の外。
//
// 非依存: I/O / clock / random / logging / network / DB / AI。

import type { ExamSourceKind, ExamSourceReadStatus } from '../sourceData/types';
import type { ExamFingerprint } from './fingerprint';
import { isExamFingerprint } from './fingerprint';
import { ABSENT_REVISION } from './revision';
import type { ExamSyncStatus } from './verification';
import { verifyExamSourcePair } from './verification';
import type { ExamSyncObservation } from './adapters/types';
import { deviceCanonicalCandidate, serverMirrorCandidate } from './adapters/types';
import type { ExamSyncSupportedKind } from './adapters/registry';
import { EXAM_SYNC_SUPPORTED_KINDS } from './adapters/registry';

// ── 入力: transport から切り離した validated claim ────────────────────
//
// ★ E-H7 human ruling（OPTION 1）★
//   canonical な device claim transport は **E-S33 / `sync/claim/**` / wire `edc1`** 1 本だけ。
//   verification 層は transport 固有型に依存せず、下の最小 interface だけを受け取る。
//   これにより「transport を 1 本に保ったまま verification contract を再利用できる」。
//
// ★ この型に増やしてよい field は無い ★
//   kind + content fingerprint のみ。revision 軸を足さない（R1 未解決 / E-S2）。
//   userId / authority / table / purpose / 時刻 / 本文 / 件数 を持たない。
//   auth binding と purpose gate は **claim 側**（E-S33 の `toDeviceClaims`）で
//   既に適用済みであり、ここで再評価も再拡大もしない。
//
// ★ 形は E-S33 の `toDeviceClaims` 戻り値と構造的に一致させてある ★
//   したがって adapter コードは 0 本で、header の parse も 1 回だけ（E-S33 の parser）。

export type ExamSyncClaimEntry = {
  /** その kind の申告が **提示された**か。false / 欠落は unclaimed。 */
  readonly presented: boolean;
  /** content 由来 fingerprint（`efp1:<hex64>`）。形式不正は null に倒す。 */
  readonly fingerprint: string | null;
};

/**
 * transport 非依存の validated claim set。
 * E-S33 の `toDeviceClaims(parsed, { authenticatedUserId, allowedSources })` の
 * 戻り値がそのまま代入できる（構造的部分型）。
 */
export type ExamSyncClaimSet = Readonly<Partial<Record<ExamSourceKind, ExamSyncClaimEntry>>>;

export const EMPTY_EXAM_SYNC_CLAIM_SET: ExamSyncClaimSet = {};

/**
 * claim set から 1 kind の fingerprint を取り出す（純関数 / fail-closed）。
 * 未提示 / 形式不正はすべて `null`（= unclaimed）に倒し、verified を作らない。
 */
export function claimedFingerprint(
  claims: ExamSyncClaimSet,
  kind: ExamSyncSupportedKind,
): ExamFingerprint | null {
  const entry = claims[kind];
  if (entry === undefined || entry.presented !== true) return null;
  return isExamFingerprint(entry.fingerprint) ? entry.fingerprint : null;
}

// ── 外部 verdict ──────────────────────────────────────────────────────

export type ExamSyncExternalVerdict = 'unreadable' | 'unclaimed' | 'mismatch' | 'verified';

/** 優先順位の高い順。observability の counter key 空間もこれで有界になる（E-S12）。 */
export const EXAM_SYNC_EXTERNAL_VERDICTS = [
  'unreadable',
  'unclaimed',
  'mismatch',
  'verified',
] as const satisfies readonly ExamSyncExternalVerdict[];

/** verified 以外はすべて使わない（E-S2）。判定を 1 箇所に閉じる。 */
export function isExamSyncUsableVerdict(verdict: ExamSyncExternalVerdict): boolean {
  return verdict === 'verified';
}

export type ExamSyncVerdictResult = {
  readonly verdict: ExamSyncExternalVerdict;
  /** Wave 1 の内部 5 値。debug / QA 用であり **wire へ出さない**。 */
  readonly internalStatus: ExamSyncStatus;
  /**
   * ★ 構造的に発生しないはずの内部状態を観測したか ★
   *   `incomparable` は adapter 経路では起き得ない（present candidate の fingerprint が
   *   常に非 null）。それでも将来 contract が変わったときに **黙って畳まれない**よう、
   *   観測できる形で残す。QA が全探索でこれが常に false であることを固定する。
   */
  readonly unexpectedInternalStatus: boolean;
};

/**
 * 内部 5 値 → 外部 4 値。
 *
 * `incomparable` は「比較材料が足りない」であり、verified でも「一致していない証拠」でもない。
 * E-S2 の 4 値の中で最も fail-closed なのは `unreadable`（＝ 信頼して読めていない）なので
 * そこへ畳む。**verified へは絶対に畳まない。**
 */
export function foldExamSyncInternalStatus(status: ExamSyncStatus): {
  readonly verdict: ExamSyncExternalVerdict;
  readonly unexpected: boolean;
} {
  switch (status) {
    case 'unreadable':
      return { verdict: 'unreadable', unexpected: false };
    case 'unclaimed':
      return { verdict: 'unclaimed', unexpected: false };
    case 'mismatch':
      return { verdict: 'mismatch', unexpected: false };
    case 'verified':
      return { verdict: 'verified', unexpected: false };
    case 'incomparable':
      return { verdict: 'unreadable', unexpected: true };
    default: {
      // exhaustive guard。新しい内部 status が増えたら型検査で気付く。
      const exhaustive: never = status;
      void exhaustive;
      return { verdict: 'unreadable', unexpected: true };
    }
  }
}

// ── 1 kind の verdict ─────────────────────────────────────────────────

export type ExamSyncVerdictInput = {
  readonly kind: ExamSyncSupportedKind;
  /** Stage 3 の read status。`ok` 以外はすべて unreadable（E-S2 / E-S8）。 */
  readonly status: ExamSourceReadStatus;
  /**
   * server 側の観測。`null` は「read は ok だが observation が無い（= 空）」。
   *
   * ★ Wave 5 loader の規約 ★
   *   wire は「明示的に空」を表現できない（device は fingerprint を送るか、送らないかの 2 択）。
   *   したがって list kind については **0 件でも observation を作る**こと
   *   （空 list の view にも fingerprint がある）。作らないと device の空 claim と
   *   食い違って mismatch になる。snapshot kind は行が無ければ observation も無く、
   *   device 側も claim を出さない（→ unclaimed）。どちらも fail-closed 側で一致する。
   */
  readonly mirror: ExamSyncObservation | null;
  /** validated claim set から取り出した fingerprint。未申告は `null`。 */
  readonly claim: ExamFingerprint | null;
};

export function examSyncVerdict(input: ExamSyncVerdictInput): ExamSyncVerdictResult {
  const claimObservation: ExamSyncObservation | null = isExamFingerprint(input.claim)
    ? {
        kind: input.kind,
        source: 'device_canonical',
        fingerprint: input.claim,
        // ★ revision axis を導入しない（R1 未解決）。claim は content fingerprint のみ。
        revision: ABSENT_REVISION,
      }
    : null;

  const internal = verifyExamSourcePair({
    canonical: deviceCanonicalCandidate({
      claimPresented: claimObservation !== null,
      observation: claimObservation,
    }),
    mirror: serverMirrorCandidate({ status: input.status, observation: input.mirror }),
  });

  const folded = foldExamSyncInternalStatus(internal.status);
  return {
    verdict: folded.verdict,
    internalStatus: internal.status,
    unexpectedInternalStatus: folded.unexpected,
  };
}

// ── kind 群の verdict ────────────────────────────────────────────────

export type ExamSyncVerdictMap = Readonly<Record<ExamSyncSupportedKind, ExamSyncExternalVerdict>>;

export type ExamSyncMirrorState = {
  readonly status: ExamSourceReadStatus;
  readonly observation: ExamSyncObservation | null;
};

/**
 * validated claim set × mirror 群 → kind ごとの外部 verdict。
 * 要求されなかった kind も `skipped` として `unreadable` に倒れる（E-S2 / E-S8）。
 */
export function examSyncVerdicts(input: {
  readonly claims: ExamSyncClaimSet;
  readonly mirrors: Readonly<Partial<Record<ExamSyncSupportedKind, ExamSyncMirrorState>>>;
}): { readonly verdicts: ExamSyncVerdictMap; readonly unexpectedInternalStatus: boolean } {
  const verdicts = {} as Record<ExamSyncSupportedKind, ExamSyncExternalVerdict>;
  let unexpected = false;
  for (const kind of EXAM_SYNC_SUPPORTED_KINDS) {
    const mirror = input.mirrors[kind] ?? { status: 'skipped' as const, observation: null };
    const result = examSyncVerdict({
      kind,
      status: mirror.status,
      mirror: mirror.observation,
      claim: claimedFingerprint(input.claims, kind),
    });
    verdicts[kind] = result.verdict;
    if (result.unexpectedInternalStatus) unexpected = true;
  }
  return { verdicts, unexpectedInternalStatus: unexpected };
}

// ── observability（E-S12 / E-S13: enum のみ）─────────────────────────

export type ExamSyncVetoReason = Exclude<ExamSyncExternalVerdict, 'verified'>;

/**
 * 「なぜ使えなかったか」を 1 つの enum へ畳む。
 * 優先順位は E-S2 と同じ（unreadable > unclaimed > mismatch）。
 * ★ 値は closed enum のみ。kind 名・fingerprint・本文・生の header 文字列を返さない。
 */
export function summarizeExamSyncVeto(
  verdicts: ExamSyncVerdictMap,
  kinds: readonly ExamSyncSupportedKind[],
): ExamSyncVetoReason | null {
  let seen: ExamSyncVetoReason | null = null;
  for (const kind of kinds) {
    const v = verdicts[kind];
    if (v === 'verified') continue;
    if (v === 'unreadable') return 'unreadable';
    if (v === 'unclaimed') seen = 'unclaimed';
    else if (seen === null) seen = 'mismatch';
  }
  return seen;
}

/** 指定 kind がすべて verified か（1 つでも欠ければ false）。 */
export function allExamSyncVerified(
  verdicts: ExamSyncVerdictMap,
  kinds: readonly ExamSyncSupportedKind[],
): boolean {
  return kinds.length > 0 && kinds.every((k) => isExamSyncUsableVerdict(verdicts[k]));
}
