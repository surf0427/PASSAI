// PASSAI 受験版 Exam Spine — Stage 5 Packet 3 / tutor の `basic_info` slot 単独切替（純関数）。
//
// E-S40: Stage 5 の最初の consumer 切替は **tutor purpose の basic_info slot だけ**。
//   同じ request の他 slot（self_analysis / activity / diagnosis / …）は legacy のまま。
//
// ★ 本 module が変えるのは「どこから来た値か」だけであり、「AI が見る文字列」ではない ★
//   legacy の `buildTutorSupabaseContextSection` が出す basic_info 由来 3 行は、
//   `TutorStudentContext['basicInfo']` という **narrow shape** から組み立てられる。
//   したがって切替は「その narrow shape を legacy serverRead から作るか、
//   Source-Sync で verified な canonical row から作るか」の差でしかない。
//   section builder も行装飾も cap も 1 つも変えない。
//
// ★ legacy の cap をそのまま適用する ★
//   legacy tutor は 40 字 / 3 件で切る。canonical read layer は 200 字 / 10 件で切る
//   （EXAM_READ_FIELD_LIMITS）。canonical の方が緩いので、legacy の cap を後段で
//   かけ直せば同じ文字列になる（40 ≤ 200 / 3 ≤ 10 のため二段切りは 1 段切りと等価）。
//   ここで legacy の cap を再宣言せず、tutorContext から import して 1 箇所に保つ。
//
// ★ fail-open（E-P7 / E-S1）★
//   verified でない / canonical 値が無い / 情報が減る、のいずれでも **legacy を維持**する。
//   「canonical を使えないから context を空にする」ことは絶対にしない。
//
// 非依存: I/O / env / clock / random / Supabase / AI。

import type { ExamBasicInfoServerRow } from '../read/rowMappers';

/**
 * ★ legacy tutor の cap を宣言で持ち、QA が実値と突き合わせる ★
 *   `lib/contextBuilders/tutorContext.ts` の `MAX_TARGETS` / `MAX_ITEM_LENGTH` は
 *   module private である。ここから値 import すると examSpine が contextBuilders へ
 *   依存する層の逆転になるため、adapter が `BASIC_INFO_SCHEMA_VERSION` に対して採ったのと
 *   同じ **宣言 + QA pin** の pattern を使う（値がずれたら Packet 3 QA が落ちる）。
 */
export const TUTOR_BASIC_INFO_MAX_TARGETS = 3;
export const TUTOR_BASIC_INFO_MAX_ITEM_LENGTH = 40;

/** legacy `projectBasicInfo` と同じ narrow shape（`TutorStudentContext['basicInfo']`）。 */
export type TutorBasicInfoSlot = {
  grade?: string;
  track?: string;
  examType?: string;
  targetSchools?: string[];
  targetFields?: string[];
};

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * canonical の server row → tutor の narrow shape。
 *
 * legacy `projectBasicInfo`（lib/contextBuilders/tutorContext.ts）と同じ規則:
 *   grade / track   … trim して 40 字で切る
 *   examType        … examTypes を 3 件まで採り「・」で連結
 *   targetSchools   … preferences の **生配列の先頭 3 slot** を見て、
 *                     その中の record の university が空でないものだけ
 *   targetFields    … 同上（faculty）
 *   どれも空なら **null**（＝ section に basic_info 行を 1 行も出さない）
 *
 * ★ 生 slot を数える（E-S57）★
 *   legacy は `preferences.slice(0, 3)` を **生配列**に対して行い、そのあとで
 *   非 record を捨てる。したがって「先頭 3 slot のうち何個が非 record に消費されたか」
 *   が採用件数に効く。正規化列（`row.preferences`）は非 record を詰めてしまうので
 *   この規則を再現できない。`row.rawPreferences` は生 index を保持しているので
 *   再現できる。ここでやっているのは **legacy の規則をそのまま書き写すこと**だけで、
 *   mapper 後の値から「不正値があったはず」と推測してはいない。
 *
 * ★ university が string でない行も見る ★
 *   legacy は `asRecord` を通った行の `university` / `faculty` を
 *   それぞれ独立に `toTrimmedString` する。`university: 123` の行でも
 *   `faculty` は採られる。`rawPreferences` は正規化列と違いその行を落とさないので、
 *   同じ結果になる。
 *
 * ★ overallGpa / subjectGrades / name は載せない ★
 *   legacy が読まない（評定・PII / E-P5・E-P8）。canonical row は持っているが使わない。
 */
export function projectTutorBasicInfoSlot(
  row: ExamBasicInfoServerRow | null,
): TutorBasicInfoSlot | null {
  if (!row) return null;

  const grade = truncate(trimmed(row.grade), TUTOR_BASIC_INFO_MAX_ITEM_LENGTH);
  const track = truncate(trimmed(row.track), TUTOR_BASIC_INFO_MAX_ITEM_LENGTH);
  const examType = row.examTypes
    .slice(0, TUTOR_BASIC_INFO_MAX_TARGETS)
    .map((v) => truncate(trimmed(v), TUTOR_BASIC_INFO_MAX_ITEM_LENGTH))
    .filter((v) => v !== '')
    .join('・');

  const targetSchools: string[] = [];
  const targetFields: string[] = [];
  for (const pref of row.rawPreferences) {
    // `rawPreferences` は sourceIndex 昇順なので、境界に達したら以降も全部境界外。
    if (pref.sourceIndex >= TUTOR_BASIC_INFO_MAX_TARGETS) break;
    const uni = truncate(trimmed(pref.university), TUTOR_BASIC_INFO_MAX_ITEM_LENGTH);
    const fac = truncate(trimmed(pref.faculty), TUTOR_BASIC_INFO_MAX_ITEM_LENGTH);
    if (uni !== '') targetSchools.push(uni);
    if (fac !== '') targetFields.push(fac);
  }

  const hasAny =
    grade !== '' ||
    track !== '' ||
    examType !== '' ||
    targetSchools.length > 0 ||
    targetFields.length > 0;
  if (!hasAny) return null;

  return { grade, track, examType, targetSchools, targetFields };
}

// ── slot 切替の判定 ───────────────────────────────────────────────────

/** どちらの authority が basic_info slot を供給したか（観測用 enum / PII なし）。 */
export type TutorBasicInfoSlotAuthority = 'canonical' | 'legacy';

export type TutorBasicInfoSlotDecision = {
  readonly authority: TutorBasicInfoSlotAuthority;
  /** 実際に section builder へ渡す値。 */
  readonly value: TutorBasicInfoSlot | undefined;
  /** legacy を維持した理由（canonical のときは null）。 */
  readonly reason: TutorBasicInfoSlotFallbackReason | null;
};

export type TutorBasicInfoSlotFallbackReason =
  /** canary / verdict / runtime block により canonical を使えない。 */
  | 'not_usable'
  /** canonical に basic_info の値が無い（server 0 行など）。 */
  | 'canonical_absent'
  /** canonical だけを使うと legacy より情報が減る（E-P7）。 */
  | 'would_reduce_context'
  /** canonical と legacy の projection 結果が一致しない（下記 ★ を参照）。 */
  | 'divergent_projection';

/**
 * tutor の `basic_info` slot だけを canonical へ切り替える（純関数）。
 *
 * ★ 採用側を決めるのは Source-Sync の verdict であって本関数ではない ★
 *   `usable` は呼び出し側が `examSyncUsability`（E-S2 / E-S11 / E-S36）で評価した結果を渡す。
 *
 * ★ output-equivalence veto（本 packet の中核）★
 *   Packet 3 の制約は「consumer の authority を切り替えるが、**AI が見る文字列は変えない**」。
 *   したがって canonical を採用してよいのは、canonical から作った slot が
 *   legacy と **完全一致** するときだけ。一致しなければ legacy を維持する。
 *
 *   これは「一致するまで canonical を使わない」という弱い妥協ではなく、
 *   制約そのものの機械的な強制である。veto は **恒久的な安全網として残す**。
 *
 * ★ projection 差は解消済み（E-S56 → E-S57）★
 *   Packet 3 の時点では次の構造差が残っていた:
 *
 *     legacy      : preferences を **生のまま 3 件に切ってから** 非 record を捨てる
 *     canonical   : read mapper が **非 record を捨てながら 10 件へ詰める**
 *
 *   壊れた entry が 3 件境界より前にあると採用件数がずれ、ずれの原因である
 *   「どの生 slot が壊れた entry に消費されたか」は当時の row には残っていなかった。
 *   S5-P8 で read layer が `rawPreferences`（生 index つきの事実列）を報告するように
 *   なったため、`projectTutorBasicInfoSlot` が legacy の規則をそのまま再現できる。
 *   `divergent_projection` は **設計上の既知差としては 0 件**である。
 *
 * ★ それでも veto を外さない ★
 *   残る不一致要因は read cap（E-S19 / shortText=200）だけであり、これは
 *   「canonical が値を見ていない」ことを意味するので legacy 維持が正しい:
 *     先頭 200 字がすべて空白の文字列は canonical 側で空になり、legacy では
 *     trim 後の内容が残る → `would_reduce_context` / `canonical_absent`。
 *   将来 mapper や legacy を触ったときに黙って出力が変わらないための安全網でもある。
 */
export function decideTutorBasicInfoSlot(input: {
  /** Source-Sync + canary が canonical の使用を許したか。 */
  readonly usable: boolean;
  /** canonical 側が作った slot（assembler が verified 時のみ渡す）。 */
  readonly canonical: TutorBasicInfoSlot | null;
  /** legacy serverRead が作った現行値。 */
  readonly legacy: TutorBasicInfoSlot | undefined;
}): TutorBasicInfoSlotDecision {
  if (!input.usable) {
    return { authority: 'legacy', value: input.legacy, reason: 'not_usable' };
  }
  const canonical = input.canonical;
  if (!canonical) {
    return { authority: 'legacy', value: input.legacy, reason: 'canonical_absent' };
  }
  if (!input.legacy || !sameSlot(input.legacy, canonical)) {
    // 情報が減る場合は E-P7 の語彙で報告し、それ以外の不一致と区別する。
    const reason: TutorBasicInfoSlotFallbackReason =
      input.legacy && reducesContext(input.legacy, canonical)
        ? 'would_reduce_context'
        : 'divergent_projection';
    return { authority: 'legacy', value: input.legacy, reason };
  }
  return { authority: 'canonical', value: canonical, reason: null };
}

/** 2 つの slot が AI-visible として完全に同一か。 */
function sameSlot(a: TutorBasicInfoSlot, b: TutorBasicInfoSlot): boolean {
  const sameStr = (x: string | undefined, y: string | undefined): boolean => (x ?? '') === (y ?? '');
  const sameArr = (x: string[] | undefined, y: string[] | undefined): boolean => {
    const xs = x ?? [];
    const ys = y ?? [];
    return xs.length === ys.length && xs.every((v, i) => v === ys[i]);
  };
  return (
    sameStr(a.grade, b.grade) &&
    sameStr(a.track, b.track) &&
    sameStr(a.examType, b.examType) &&
    sameArr(a.targetSchools, b.targetSchools) &&
    sameArr(a.targetFields, b.targetFields)
  );
}

/** canonical へ切り替えると legacy より情報が減るか（field 単位・E-P7）。 */
function reducesContext(legacy: TutorBasicInfoSlot, canonical: TutorBasicInfoSlot): boolean {
  const lost = (l: string | undefined, c: string | undefined): boolean =>
    (l ?? '') !== '' && (c ?? '') === '';
  if (lost(legacy.grade, canonical.grade)) return true;
  if (lost(legacy.track, canonical.track)) return true;
  if (lost(legacy.examType, canonical.examType)) return true;
  if ((legacy.targetSchools?.length ?? 0) > (canonical.targetSchools?.length ?? 0)) return true;
  if ((legacy.targetFields?.length ?? 0) > (canonical.targetFields?.length ?? 0)) return true;
  return false;
}
