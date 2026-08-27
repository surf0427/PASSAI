// PASSAI 受験版 Exam Spine — Stage 5.11 / tutor の `diagnosis` slot 単独切替（純関数）。
//
// E-S60: Stage 5 の 3 番目の consumer 切替は **tutor purpose の diagnosis slot だけ**。
//   同じ request の他 slot（self_analysis / statement_review / …）は legacy のまま。
//   `basic_info`（E-S56）/ `activity`（E-S58）は既に切替済みで、その authority に触れない。
//   schema_version の eligibility 規則は E-S59 が正本。
//
// ★ 本 module が変えるのは「どこから来た値か」だけであり、「AI が見る文字列」ではない ★
//   legacy の `buildTutorSupabaseContextSection` が出す diagnosis 由来 1 行は
//   `・保存情報からは、{typeHint}。` であり、材料は `TutorStudentContext['diagnosis']`
//   という narrow shape（`typeHint` 1 文）だけである。したがって切替は
//   「その 1 文を legacy serverRead から作るか、Source-Sync で verified な canonical row
//   から作るか」の差でしかない。section builder も行装飾も cap も 1 つも変えない。
//
// ★ 言い換え表の正本は 1 箇所（E-S44）★
//   legacy（`tutorContext.ts:projectDiagnosis`）も canonical（assembler / 本 module）も
//   `lib/examDiagnosis/tutorHints.ts` の `resolveDiagnosisTypeHint()` を通す。
//   したがって「同じ resultType なら同じ hint」が **構成上** 保証される。
//   activity と同じく、両者の間に別の正規化層は挟まっていない。
//
// ★ `summary` を作らない ★
//   `TutorStudentContext['diagnosis']` は `summary?: string` も宣言しているが、
//   legacy はこれを **一度も書かず**、section renderer も読まない（repo 全走査で 0 件）。
//   canonical 側で埋めると legacy に無い行が prompt に出る（E-P7 違反）。
//
// ★ `would_reduce_context` を持たない（activity からのコピーをしない）★
//   activity の slot は「カテゴリ数 / 総件数」という **量**を持つため「減った」が定義できる。
//   diagnosis の slot は hint 1 文しか持たず、量の概念が無い。
//   「canonical に hint が無い」は `canonical_absent`、「別の hint」は
//   `divergent_projection` で尽きる。意味の無い理由 enum を増やさない（E-S60）。
//
// 非依存: I/O / env / clock / random / Supabase / AI。

import type { ExamDiagnosisServerRow } from '../read/rowMappers';
import { resolveDiagnosisTypeHint } from '@/lib/examDiagnosis/tutorHints';
import { isComparableSchemaVersion } from '../sync/adapters/registry';

/**
 * legacy `projectDiagnosis` と同じ 120 字 cap。
 *
 * ★ 値の出どころ ★
 *   legacy  `lib/contextBuilders/tutorContext.ts` の `MAX_SUMMARY_LENGTH = 120`（module private）
 *   block   `lib/examSpine/blocks/build.ts` の `DIAGNOSIS_TYPE_HINT_MAX_CHARS = 120`
 *   いずれも export されていないため、`EXAM_DEVICE_SCHEMA_VERSIONS` と同じく
 *   「値を宣言し、QA が実ソースを読んで一致を検査する」方式で drift を塞ぐ。
 *
 * ★ legacy の `truncate(v, max)` と `slice(0, max)` は同値 ★
 *   `truncate` は `value.length > max ? value.slice(0, max) : value`（rowMappers.ts）で、
 *   省略記号を足さない。したがって cap 適用後の byte は完全に一致する。
 *   現行 hint はすべて 120 字未満なので実質 no-op だが、parity のために残す。
 */
export const TUTOR_DIAGNOSIS_HINT_MAX_CHARS = 120;

/** legacy `projectDiagnosis` と同じ narrow shape（`TutorStudentContext['diagnosis']`）。 */
export type TutorDiagnosisSlot = {
  readonly typeHint: string;
};

/**
 * canonical の server row → tutor の narrow shape。
 *
 * legacy `projectDiagnosis`（lib/contextBuilders/tutorContext.ts）と同じ規則:
 *   `payload.resultType` を `resolveDiagnosisTypeHint` へ通す
 *     → number(legacy 1-4)  → `LEGACY_DIAGNOSIS_TYPE_HINTS`
 *     → string(ExamType 9種) → `EXAM_DIAGNOSIS_TYPE_HINTS`
 *     → どちらでもなければ null（＝ diagnosis 行を 1 行も出さない）
 *   得られた hint に 120 字 cap を掛ける
 *
 * ★ payload の他 field を読まない ★
 *   `resultTitle` / `resultDescription` / `answers` / `createdAt` は戻り値に現れない。
 *   row は `schemaVersion` も持つが、それは Source-Sync の fingerprint 材料であって
 *   prompt の材料ではない（E-S59）。
 */
export function projectTutorDiagnosisSlot(
  row: ExamDiagnosisServerRow | null,
): TutorDiagnosisSlot | null {
  const hint = resolveDiagnosisTypeHint(row?.payload?.resultType);
  if (!hint) return null;
  return { typeHint: hint.slice(0, TUTOR_DIAGNOSIS_HINT_MAX_CHARS) };
}

// ── slot 切替の判定 ───────────────────────────────────────────────────

/** どちらの authority が diagnosis slot を供給したか（観測用 enum / PII なし）。 */
export type TutorDiagnosisSlotAuthority = 'canonical' | 'legacy';

export type TutorDiagnosisSlotFallbackReason =
  /** canary / verdict / runtime block により canonical を使えない。 */
  | 'not_usable'
  /** mirror row が現行 writer contract の版で書かれていない（E-S59）。 */
  | 'schema_version_ineligible'
  /** canonical に diagnosis の値が無い（server 0 行 / resultType を解決できない）。 */
  | 'canonical_absent'
  /** canonical と legacy の projection 結果が一致しない。 */
  | 'divergent_projection';

export type TutorDiagnosisSlotDecision = {
  readonly authority: TutorDiagnosisSlotAuthority;
  /** 実際に section builder へ渡す値。 */
  readonly value: { typeHint?: string; summary?: string } | undefined;
  /** legacy を維持した理由（canonical のときは null）。 */
  readonly reason: TutorDiagnosisSlotFallbackReason | null;
};

/**
 * tutor の `diagnosis` slot だけを canonical へ切り替える（純関数）。
 *
 * ★ 採用側を決めるのは Source-Sync の verdict であって本関数ではない ★
 *   `usable` は呼び出し側が `examSyncUsability`（E-S2 / E-S11 / E-S36）で評価した結果を渡す。
 *
 * ★ schema_version eligibility は **2 枚目の gate** である（E-S59）★
 *   現行の Source-Sync では `schemaVersion` が content field なので、superseded な版の row は
 *   fingerprint が一致せず `usable` の時点で既に落ちている。つまりこの分岐は
 *   **通常到達しない**。それでも置くのは、E-S44 が禁じた近道
 *   （「`schemaVersion` を sync view から外して mismatch を消す」）を取った瞬間に
 *   **黙って legacy 版の row が canonical 経路へ流れ込む**のを止めるためである。
 *   近道を取れば本 gate が発火し、QA（negative control D-N4）が落ちる。
 *
 * ★ output-equivalence veto（E-S56 / E-S58 と同じ採用条件 / E-S60）★
 *   canonical を採用してよいのは、canonical から作った slot が legacy と
 *   **完全一致** するときだけ。一致しなければ legacy を維持する。
 *   diagnosis では両者が同一の hint 表と同一の cap を通るため設計上の構造差は無いが、
 *   veto は **恒久的な安全網**として残す: 将来 `resolveDiagnosisTypeHint` の
 *   呼び出し側が片方だけ差し替えられたとき、黙って prompt が変わるのではなく
 *   legacy へ倒れて観測に残るようにするため。
 *
 * ★ fail-open（E-P7 / E-S1）★
 *   どの分岐でも legacy を維持する。「canonical を使えないから context を空にする」ことはしない。
 */
export function decideTutorDiagnosisSlot(input: {
  /** Source-Sync + canary が canonical の使用を許したか。 */
  readonly usable: boolean;
  /** canonical 側が作った slot（assembler が verified 時のみ渡す）。 */
  readonly canonical: TutorDiagnosisSlot | null;
  /** canonical が読んだ mirror row の `schema_version`（eligibility 判定用）。 */
  readonly canonicalSchemaVersion: string | null;
  /** legacy serverRead が作った現行値。 */
  readonly legacy: { typeHint?: string; summary?: string } | undefined;
}): TutorDiagnosisSlotDecision {
  if (!input.usable) {
    return { authority: 'legacy', value: input.legacy, reason: 'not_usable' };
  }
  if (!isComparableSchemaVersion('diagnosis', input.canonicalSchemaVersion)) {
    return { authority: 'legacy', value: input.legacy, reason: 'schema_version_ineligible' };
  }
  const canonical = input.canonical;
  if (!canonical) {
    return { authority: 'legacy', value: input.legacy, reason: 'canonical_absent' };
  }
  if (!sameSlot(input.legacy, canonical)) {
    return { authority: 'legacy', value: input.legacy, reason: 'divergent_projection' };
  }
  return { authority: 'canonical', value: { typeHint: canonical.typeHint }, reason: null };
}

/**
 * legacy 値と canonical slot が AI-visible として完全に同一か。
 *
 * ★ `summary` も見る ★
 *   legacy は書かないが、型上は存在する。もし将来 legacy が `summary` を持ち始めたら
 *   canonical（常に typeHint のみ）へ切り替えると **その値が消える**。
 *   同値検査に含めることで、その日は `divergent_projection` で legacy に倒れる。
 */
function sameSlot(
  legacy: { typeHint?: string; summary?: string } | undefined,
  canonical: TutorDiagnosisSlot,
): boolean {
  if (!legacy) return false;
  if (legacy.summary !== undefined) return false;
  return legacy.typeHint === canonical.typeHint;
}
