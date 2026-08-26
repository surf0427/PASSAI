// PASSAI 受験版 Exam Spine — Stage 4 Wave 4 / fail-closed usability decision（純関数）。
//
//   kind × external verdict × canary 状態 × runtime block 宣言
//        ↓
//   usable / veto（+ enum の理由）
//
// ★★ これは feature flag の実装ではない ★★
//   env も allowlist も canary infrastructure もここには無い。判定に必要な入力を
//   **既に評価済みの値として受け取る**だけの宣言層である。実際の canary 評価
//   （E-S11 の「purpose flag AND user allowlist」の連言）は Wave 5 以降の runtime が持つ。
//
// ★★ default deny（E-S11）★★
//   canary 状態が missing / unknown / false / malformed のいずれでも enable しない。
//   そのため入力を `unknown` 型で受け、**`=== true` の厳密一致のみ**を許可する。
//   `'true'` / `1` / `{}` / `undefined` / `null` はすべて deny に倒れる。
//   コードに default true も development 自動 ON も置かない。
//
// ★★ 採用側は決めない ★★
//   返すのは「その source を使ってよいか」だけ。どちらを採るか / 直すか / 混ぜるかは
//   Authority Contract の仕事であり、本 file は adoption を返す API を持たない。
//
// ★ context veto の **配線** はしない ★
//   fail-closed の primitive は作るが、contextBuilders / tutor / orchestrator / route から
//   呼ばない（Wave 4 の禁止 scope）。
//
// 非依存: I/O / clock / random / logging / network / DB / AI / env。

import type { ExamSourceKind } from '../sourceData/types';
import type { ExamSyncExternalVerdict, ExamSyncVerdictMap } from './verdict';
import { isExamSyncUsableVerdict } from './verdict';
import type { ExamSyncSupportedKind } from './adapters/registry';
import {
  EXAM_SYNC_RUNTIME_ENABLE_BLOCKED,
  EXAM_SYNC_SUPPORTED_KINDS,
  isExamSyncSupportedKind,
} from './adapters/registry';

export type ExamSyncUsability = 'usable' | 'veto';

/** veto の理由（closed enum / E-S12・E-S13）。 */
export type ExamSyncEnableVetoReason =
  /** Source-Sync の対象外 kind（class 2 = E-S3、または未対応 kind）。 */
  | 'kind_not_syncable'
  /** registry が runtime 有効化を禁止している（現状 essay / R5）。 */
  | 'runtime_blocked'
  /** canary が許可していない（E-S11 default deny）。 */
  | 'canary_denied'
  /** verdict が verified ではない（E-S2）。 */
  | 'not_verified';

export type ExamSyncEnableDecision = {
  readonly usability: ExamSyncUsability;
  readonly reason: ExamSyncEnableVetoReason | null;
};

const VETO = (reason: ExamSyncEnableVetoReason): ExamSyncEnableDecision => ({
  usability: 'veto',
  reason,
});

const USABLE: ExamSyncEnableDecision = { usability: 'usable', reason: null };

/** registry の runtime 禁止宣言（宣言であって gate ではない）。 */
export function isExamSyncRuntimeBlocked(kind: ExamSourceKind): boolean {
  return typeof EXAM_SYNC_RUNTIME_ENABLE_BLOCKED[kind] === 'string';
}

/**
 * 1 kind の使用可否（純関数・fail-closed）。
 *
 * 判定順（先に来るものが強い。理由の説明力が高い順でもある）:
 *   1. kind が Source-Sync 対象か        … 構造的・恒久的（E-S3）
 *   2. registry が runtime を禁止しているか … 恒久的だが解除され得る（essay / R5）
 *   3. canary が許可しているか            … 運用状態（E-S11 default deny）
 *   4. verdict が verified か             … request ごとの検証結果（E-S2）
 *
 * ★ どの段でも「たぶん大丈夫」で通さない。判定に必要な情報が無ければ veto。
 */
export function examSyncUsability(input: {
  readonly kind: ExamSourceKind;
  readonly verdict: ExamSyncExternalVerdict;
  /** E-S11 の連言を評価済みの値。**`true` 以外はすべて deny**（型は unknown のまま受ける）。 */
  readonly canaryAllowed: unknown;
}): ExamSyncEnableDecision {
  if (!isExamSyncSupportedKind(input.kind)) return VETO('kind_not_syncable');
  if (isExamSyncRuntimeBlocked(input.kind)) return VETO('runtime_blocked');
  if (input.canaryAllowed !== true) return VETO('canary_denied');
  if (!isExamSyncUsableVerdict(input.verdict)) return VETO('not_verified');
  return USABLE;
}

/**
 * kind 群のうち実際に使える kind だけを返す（宣言順）。
 * ★ 減らす方向にしか働かない（要求されていない kind を足さない）。
 */
export function examSyncUsableKinds(input: {
  readonly verdicts: ExamSyncVerdictMap;
  readonly kinds: readonly ExamSyncSupportedKind[];
  readonly canaryAllowed: unknown;
}): readonly ExamSyncSupportedKind[] {
  const requested = new Set<string>(input.kinds);
  return EXAM_SYNC_SUPPORTED_KINDS.filter(
    (kind) =>
      requested.has(kind) &&
      examSyncUsability({
        kind,
        verdict: input.verdicts[kind],
        canaryAllowed: input.canaryAllowed,
      }).usability === 'usable',
  );
}

/**
 * 観測用サマリ（E-S12 / E-S13: enum と数だけ）。
 * ★ kind 名 / fingerprint / 本文 / 生の signal 文字列を返さない。
 */
export type ExamSyncEnableSummary = {
  readonly requested: number;
  readonly usable: number;
  readonly reason: ExamSyncEnableVetoReason | null;
};

export function summarizeExamSyncEnable(input: {
  readonly verdicts: ExamSyncVerdictMap;
  readonly kinds: readonly ExamSyncSupportedKind[];
  readonly canaryAllowed: unknown;
}): ExamSyncEnableSummary {
  // 理由の優先順位は判定順と同じ（構造的なものを先に見せる）。
  const order: readonly ExamSyncEnableVetoReason[] = [
    'kind_not_syncable',
    'runtime_blocked',
    'canary_denied',
    'not_verified',
  ];
  const seen = new Set<ExamSyncEnableVetoReason>();
  let usable = 0;
  for (const kind of input.kinds) {
    const decision = examSyncUsability({
      kind,
      verdict: input.verdicts[kind],
      canaryAllowed: input.canaryAllowed,
    });
    if (decision.usability === 'usable') usable += 1;
    else if (decision.reason !== null) seen.add(decision.reason);
  }
  const reason = order.find((r) => seen.has(r)) ?? null;
  return { requested: input.kinds.length, usable, reason };
}
