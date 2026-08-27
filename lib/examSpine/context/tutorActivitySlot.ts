// PASSAI 受験版 Exam Spine — Stage 5 Packet S5-P10 / tutor の `activity` slot 単独切替（純関数）。
//
// E-S57: Stage 5 の 2 番目の consumer 切替は **tutor purpose の activity slot だけ**。
//   同じ request の他 slot（self_analysis / diagnosis / statement_review / …）は legacy のまま。
//   `basic_info`（E-S55）は既に切替済みで、その authority には触れない。
//
// ★ 本 module が変えるのは「どこから来た値か」だけであり、「AI が見る文字列」ではない ★
//   legacy の `buildTutorSupabaseContextSection` が出す activity 由来 1 行は、
//   `TutorStudentContext['activity']` という **narrow shape**（totalCount + categoryCounts）
//   から組み立てられる。したがって切替は「その narrow shape を legacy serverRead から
//   作るか、Source-Sync で verified な canonical row から作るか」の差でしかない。
//   section builder も行装飾も cap も 1 つも変えない。
//
// ★ 集計の正本は 1 箇所（E-S45）★
//   legacy（`tutorContext.ts:projectActivity`）も canonical（assembler / 本 module）も
//   `lib/activityCategories.ts` の `summarizeActivityCategories()` を通す。
//   したがって「同じ payload なら同じ集計」が **構成上** 保証される。
//   basic_info と違い、両者の間に別の正規化層が挟まっていない。
//
// ★ `ExamActivityServerRow.categoryCounts` を使ってはいけない ★
//   あれは「payload 内で配列だった **生 key** → 長さ」であり、
//     - 未知カテゴリを含む
//     - 長さ 0 のカテゴリも含む
//     - 表示ラベルではなく key のまま
//   という **別の表現**である。legacy が prompt に出しているのは
//   `ACTIVITY_CATEGORY_LABELS` の宣言順・ラベル・0 件除外の集計なので、
//   ここで取り違えると未知カテゴリや 0 件が prompt に出る。
//   本 module は `row.payload` から `summarizeActivityCategories` を通す（QA が固定する）。
//
// ★ fail-open（E-P7 / E-S1）★
//   verified でない / canonical 値が無い / 情報が減る、のいずれでも **legacy を維持**する。
//   「canonical を使えないから context を空にする」ことは絶対にしない。
//
// 非依存: I/O / env / clock / random / Supabase / AI。

import type { ExamActivityServerRow } from '../read/rowMappers';
import { summarizeActivityCategories } from '@/lib/activityCategories';

/** legacy `projectActivity` と同じ narrow shape（`TutorStudentContext['activity']`）。 */
export type TutorActivitySlot = {
  readonly totalCount: number;
  readonly categoryCounts: Readonly<Record<string, number>>;
};

/**
 * canonical の server row → tutor の narrow shape。
 *
 * legacy `projectActivity`（lib/contextBuilders/tutorContext.ts）と同じ規則:
 *   payload を `summarizeActivityCategories` へ通す
 *     → `ACTIVITY_CATEGORY_LABELS` の **宣言順**で走査
 *     → `Array.isArray(v) && v.length > 0` のカテゴリだけ採る（0 件は出さない）
 *     → 未知の key は集計しない
 *     → 要素の中身は **一切見ない**（長さだけ）。narrative は戻り値に現れない
 *   合計 0 件なら **null**（＝ section に活動行を 1 行も出さない）
 *
 * ★ payload 以外を読まない ★
 *   row は `categoryCounts` / `schemaVersion` も持つが tutor は使わない。
 *   `schemaVersion` は Source-Sync の fingerprint 材料であって prompt の材料ではない。
 */
export function projectTutorActivitySlot(
  row: ExamActivityServerRow | null,
): TutorActivitySlot | null {
  const summary = summarizeActivityCategories(row?.payload ?? null);
  if (!summary) return null;
  return { totalCount: summary.totalCount, categoryCounts: summary.categoryCounts };
}

// ── slot 切替の判定 ───────────────────────────────────────────────────

/** どちらの authority が activity slot を供給したか（観測用 enum / PII なし）。 */
export type TutorActivitySlotAuthority = 'canonical' | 'legacy';

export type TutorActivitySlotDecision = {
  readonly authority: TutorActivitySlotAuthority;
  /** 実際に section builder へ渡す値。 */
  readonly value: TutorActivitySlot | undefined;
  /** legacy を維持した理由（canonical のときは null）。 */
  readonly reason: TutorActivitySlotFallbackReason | null;
};

export type TutorActivitySlotFallbackReason =
  /** canary / verdict / runtime block により canonical を使えない。 */
  | 'not_usable'
  /** canonical に activity の値が無い（server 0 行 / 全カテゴリ 0 件など）。 */
  | 'canonical_absent'
  /** canonical だけを使うと legacy より情報が減る（E-P7）。 */
  | 'would_reduce_context'
  /** canonical と legacy の projection 結果が一致しない。 */
  | 'divergent_projection';

/**
 * tutor の `activity` slot だけを canonical へ切り替える（純関数）。
 *
 * ★ 採用側を決めるのは Source-Sync の verdict であって本関数ではない ★
 *   `usable` は呼び出し側が `examSyncUsability`（E-S2 / E-S11 / E-S36）で評価した結果を渡す。
 *
 * ★ output-equivalence veto（E-S55 と同じ採用条件）★
 *   canonical を採用してよいのは、canonical から作った slot が legacy と
 *   **完全一致** するときだけ。一致しなければ legacy を維持する。
 *   行が増えるのも減るのも AI-visible の変化なので、同値を採用条件に据える。
 *
 *   activity では両者が同一の集計関数を通るため、設計上の構造差は無い
 *   （実測 30 payload / 0 件 divergent）。それでも veto は **恒久的な安全網**として残す:
 *   将来 `summarizeActivityCategories` の呼び出し側が片方だけ差し替えられたとき、
 *   黙って prompt が変わるのではなく legacy へ倒れて観測に残るようにするため。
 */
export function decideTutorActivitySlot(input: {
  /** Source-Sync + canary が canonical の使用を許したか。 */
  readonly usable: boolean;
  /** canonical 側が作った slot（assembler が verified 時のみ渡す）。 */
  readonly canonical: TutorActivitySlot | null;
  /** legacy serverRead が作った現行値。 */
  readonly legacy: TutorActivitySlot | undefined;
}): TutorActivitySlotDecision {
  if (!input.usable) {
    return { authority: 'legacy', value: input.legacy, reason: 'not_usable' };
  }
  const canonical = input.canonical;
  if (!canonical) {
    return { authority: 'legacy', value: input.legacy, reason: 'canonical_absent' };
  }
  if (!input.legacy || !sameSlot(input.legacy, canonical)) {
    // 情報が減る場合は E-P7 の語彙で報告し、それ以外の不一致と区別する。
    const reason: TutorActivitySlotFallbackReason =
      input.legacy && reducesContext(input.legacy, canonical)
        ? 'would_reduce_context'
        : 'divergent_projection';
    return { authority: 'legacy', value: input.legacy, reason };
  }
  return { authority: 'canonical', value: canonical, reason: null };
}

/**
 * 2 つの slot が AI-visible として完全に同一か。
 *
 * ★ key の **順序**も見る ★
 *   section 行は `Object.entries(categoryCounts)` の順にラベルを並べる。
 *   同じ内容でも順序が違えば AI が見る文字列が変わるので、集合比較では足りない。
 */
function sameSlot(a: TutorActivitySlot, b: TutorActivitySlot): boolean {
  if (a.totalCount !== b.totalCount) return false;
  const ae = Object.entries(a.categoryCounts);
  const be = Object.entries(b.categoryCounts);
  if (ae.length !== be.length) return false;
  return ae.every(([label, n], i) => be[i][0] === label && be[i][1] === n);
}

/** canonical へ切り替えると legacy より情報が減るか（E-P7）。 */
function reducesContext(legacy: TutorActivitySlot, canonical: TutorActivitySlot): boolean {
  if (Object.keys(legacy.categoryCounts).length > Object.keys(canonical.categoryCounts).length) {
    return true;
  }
  return legacy.totalCount > canonical.totalCount;
}
