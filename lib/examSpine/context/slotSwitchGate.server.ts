// PASSAI 受験版 Exam Spine — Stage 5 Packet 3 / consumer slot 切替の activation gate（E-S11 / E-S40）。
//
// ★ default deny ★
//   env 未設定 / 空 / 不正値はすべて「誰にも有効にしない」に倒す。
//   default true も development 自動 ON も入れない。
//
// ★ slot flag AND user allowlist の連言（E-S11）★
//   shadowGate.server.ts と同じ構造。purpose ではなく **slot** 単位で列挙させる。
//
// ★ 認識する slot は 1 つだけ ★
//   E-S40 が開けたのは `tutor.basic_info` のみ。他の token は env に書かれても無視する。
//   「次の slot へ勝手に進まない」（Packet 3 Rule 10）を env ではなくコードで担保するため、
//   ここは allowlist 方式にする。slot を増やすのは次 packet の明示的な仕事。
//
// server-only の env（`NEXT_PUBLIC_` を付けない）。値は毎回読む（cache しない）。

/** 切替可能な consumer slot。E-S40 が開けたもののみ。 */
export const EXAM_SPINE_SWITCHABLE_SLOTS = ['tutor.basic_info'] as const;
export type ExamSpineSwitchableSlot = (typeof EXAM_SPINE_SWITCHABLE_SLOTS)[number];

function isSwitchableSlot(value: string): value is ExamSpineSwitchableSlot {
  return (EXAM_SPINE_SWITCHABLE_SLOTS as readonly string[]).includes(value);
}

/** `EXAM_SPINE_SLOT_SWITCH_SLOTS` — カンマ区切りの slot。未設定なら誰にも ON にならない。 */
function enabledSlots(): ReadonlySet<ExamSpineSwitchableSlot> {
  const raw = process.env.EXAM_SPINE_SLOT_SWITCH_SLOTS;
  if (typeof raw !== 'string') return new Set();
  const out = new Set<ExamSpineSwitchableSlot>();
  for (const token of raw.split(',')) {
    const value = token.trim();
    if (isSwitchableSlot(value)) out.add(value);
  }
  return out;
}

/** `EXAM_SPINE_SLOT_SWITCH_USER_IDS` — カンマ区切りの userId。**空なら誰も許可しない**。 */
function allowlist(): ReadonlySet<string> {
  const raw = process.env.EXAM_SPINE_SLOT_SWITCH_USER_IDS;
  if (typeof raw !== 'string') return new Set();
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * その slot / user について consumer 切替を有効にしてよいか。
 *
 * ★ これは「canonical を使ってよいか」であって「canonical が正しいか」ではない ★
 *   正しさ（Source-Sync verified / veto）は assembler 側の gate が別途見ており、
 *   AI-visible 同値性は `decideTutorBasicInfoSlot` が最終的に検査する。
 *   本 gate はそれらより手前の、人間が握る ON/OFF でしかない。
 */
export function isExamSpineSlotSwitchEnabled(slot: ExamSpineSwitchableSlot, userId: string): boolean {
  if (!userId) return false;
  if (!enabledSlots().has(slot)) return false;
  return allowlist().has(userId);
}

/** 観測用の mode 名。PII を含まない enum のみ（E-S12 / E-S13）。 */
export type ExamSpineSlotSwitchMode = 'off' | 'switched';

export function examSpineSlotSwitchMode(enabled: boolean): ExamSpineSlotSwitchMode {
  return enabled ? 'switched' : 'off';
}
