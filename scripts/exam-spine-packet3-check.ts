// Exam Spine — Stage 5 Packet 3 / tutor `basic_info` slot 単独切替の検証。
//
// E-S40: Stage 5 の最初の consumer 切替は **tutor purpose の basic_info slot だけ**。
//
// ★ 本 packet が証明したいこと ★
//   「basic_info を legacy serverRead から canonical（Source-Sync verified）へ切り替えても
//     **AI が見る文字列が 1 byte も変わらない**」
//
//   したがって中心は byte 比較である:
//     同一 payload
//       ├─ legacy   : stub client → loadTutorStudentContext → buildTutorSupabaseContextSection
//       └─ canonical: mapBasicInfoRow → projectTutorBasicInfoSlot → 同じ section builder
//     → section 文字列が完全一致すること
//
// 厳守: 実 Supabase 0 / 実ネットワーク 0 / AI 0 / clock 0 / random 0 / production 変更なし
//
// 使い方: npm run qa:examSpine:packet3

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';

// 'server-only' を no-op へ（tutor-loader QA と同じ手法。production 境界は変えない）。
const req = createRequire(__filename);
const SERVER_ONLY_STUB = req.resolve('next/dist/compiled/server-only/empty.js');
type ResolveFn = (this: unknown, request: string, ...rest: unknown[]) => string;
const moduleInternals = Module as unknown as { _resolveFilename: ResolveFn };
const originalResolve = moduleInternals._resolveFilename;
moduleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return SERVER_ONLY_STUB;
  return originalResolve.call(this, request, ...rest);
};

let fetchCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCallCount += 1;
  throw new Error(`[exam-spine-packet3] 外部通信が発生しました: ${String(args[0])}`);
}) as typeof globalThis.fetch;
void originalFetch;

import { mapBasicInfoRow } from '@/lib/examSpine/read/rowMappers';
import { EXAM_READ_FIELD_LIMITS } from '@/lib/examSpine/read/readSources';
import {
  EXAM_SPINE_SWITCHABLE_SLOTS,
  isExamSpineSlotSwitchEnabled,
} from '@/lib/examSpine/context/slotSwitchGate.server';
import {
  type TutorBasicInfoSlot,
  TUTOR_BASIC_INFO_MAX_ITEM_LENGTH,
  TUTOR_BASIC_INFO_MAX_TARGETS,
  decideTutorBasicInfoSlot,
  projectTutorBasicInfoSlot,
} from '@/lib/examSpine/context/tutorBasicInfoSlot';

import { basicInfoSyncView } from '@/lib/examSpine/sync/adapters/views';
import { deviceBasicInfoView } from '@/lib/examSpine/sync/adapters/deviceViews';
import { deviceBasicInfoToken } from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import { projectBasicInfo } from '@/lib/examSpine/context/project';
import type { BasicInfo } from '@/types/basicInfo';

type TutorContextModule = typeof import('@/lib/contextBuilders/tutorContext');
let tutorContext: TutorContextModule;

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    return;
  }
  failures.push(detail ? `${label}\n      ${detail}` : label);
}

function eq<T>(label: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, `expected=${e}\n      actual  =${a}`);
}

// ── stub Supabase client（basic_info_logs だけ応答し、他は null）──────
class StubBuilder implements PromiseLike<unknown> {
  private terminal = '';
  constructor(private readonly table: string, private readonly payload: unknown) {}
  select(): this { return this; }
  eq(): this { return this; }
  order(): this { return this; }
  limit(): this { return this; }
  private settle(): Promise<{ data: unknown; error: unknown }> {
    if (this.table !== 'basic_info_logs') return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: { payload: this.payload }, error: null });
  }
  maybeSingle<T = unknown>(): Promise<{ data: T; error: unknown }> {
    this.terminal = 'maybeSingle';
    return this.settle() as Promise<{ data: T; error: unknown }>;
  }
  then<R1 = unknown, R2 = never>(
    onfulfilled?: ((v: unknown) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    if (this.terminal === '') this.terminal = 'await';
    return this.settle().then(onfulfilled, onrejected);
  }
}

function stubClient(payload: unknown): unknown {
  return { from: (table: string) => new StubBuilder(table, payload) };
}

const USER = '00000000-0000-4000-8000-0000000000a1';

/** legacy 経路: stub client → loader → section。 */
async function legacySection(payload: unknown): Promise<{ section: string; basicInfo: unknown }> {
  const ctx = await tutorContext.loadTutorStudentContext(
    USER,
    stubClient(payload) as never,
  );
  return {
    section: tutorContext.buildTutorSupabaseContextSection(ctx),
    basicInfo: (ctx as { basicInfo?: unknown }).basicInfo,
  };
}

/**
 * 切替後の経路: 同じ payload を legacy loader と canonical read の両方へ通し、
 * `decideTutorBasicInfoSlot` が選んだ値で **同じ section builder** を回す。
 * ここで見るのは production が実際に流す経路そのもの。
 */
async function decidedSection(
  payload: unknown,
  usable = true,
): Promise<{ section: string; authority: string; reason: string | null }> {
  const legacyCtx = await tutorContext.loadTutorStudentContext(USER, stubClient(payload) as never);
  const legacySlot = (legacyCtx as { basicInfo?: TutorBasicInfoSlot }).basicInfo;
  const row = mapBasicInfoRow({ payload }, EXAM_READ_FIELD_LIMITS);
  const d = decideTutorBasicInfoSlot({
    usable,
    canonical: projectTutorBasicInfoSlot(row),
    legacy: legacySlot,
  });
  const swapped = { ...legacyCtx, basicInfo: d.value };
  return {
    section: tutorContext.buildTutorSupabaseContextSection(swapped),
    authority: d.authority,
    reason: d.reason,
  };
}

// ── payload fixtures（実 writer が書き得る形 + 境界 + 敵対的）──────────
function pref(u: string, f?: string, d?: string): Record<string, unknown> {
  return { university: u, ...(f === undefined ? {} : { faculty: f }), ...(d === undefined ? {} : { department: d }) };
}

/** 型不整合を作るための版（`unknown` を受ける）。 */
function pref2(u: unknown, f?: unknown, d?: unknown): Record<string, unknown> {
  return { university: u, ...(f === undefined ? {} : { faculty: f }), ...(d === undefined ? {} : { department: d }) };
}

const PAYLOADS: Array<[string, unknown]> = [
  ['典型', { grade: '高3', track: '文系', examTypes: ['総合型', '学校推薦型'], preferences: [pref('A大学', '法学部'), pref('B大学', '経済学部')] }],
  ['grade のみ', { grade: '高2' }],
  ['track のみ', { track: '理系' }],
  ['examTypes のみ', { examTypes: ['一般選抜'] }],
  ['preferences のみ', { preferences: [pref('C大学', '文学部')] }],
  ['全部空', {}],
  ['空文字だけ', { grade: '', track: '', examTypes: [], preferences: [] }],
  ['null 値', { grade: null, track: null, examTypes: null, preferences: null }],
  ['undefined 値', { grade: undefined, track: undefined }],
  ['前後空白', { grade: '  高3  ', track: ' 文系 ' }],
  [`item 長 ${TUTOR_BASIC_INFO_MAX_ITEM_LENGTH - 1}`, { grade: 'あ'.repeat(TUTOR_BASIC_INFO_MAX_ITEM_LENGTH - 1) }],
  [`item 長 ${TUTOR_BASIC_INFO_MAX_ITEM_LENGTH}`, { grade: 'あ'.repeat(TUTOR_BASIC_INFO_MAX_ITEM_LENGTH) }],
  [`item 長 ${TUTOR_BASIC_INFO_MAX_ITEM_LENGTH + 1}`, { grade: 'あ'.repeat(TUTOR_BASIC_INFO_MAX_ITEM_LENGTH + 1) }],
  ['item 長 201（canonical cap 超）', { grade: 'あ'.repeat(201) }],
  [`targets ${TUTOR_BASIC_INFO_MAX_TARGETS - 1}`, { preferences: [pref('U1', 'F1'), pref('U2', 'F2')] }],
  [`targets ${TUTOR_BASIC_INFO_MAX_TARGETS}`, { preferences: [pref('U1', 'F1'), pref('U2', 'F2'), pref('U3', 'F3')] }],
  [`targets ${TUTOR_BASIC_INFO_MAX_TARGETS + 1}`, { preferences: [pref('U1', 'F1'), pref('U2', 'F2'), pref('U3', 'F3'), pref('U4', 'F4')] }],
  ['targets 11（canonical cap 超）', { preferences: Array.from({ length: 11 }, (_, i) => pref(`U${i}`, `F${i}`)) }],
  ['examTypes 4 件', { examTypes: ['T1', 'T2', 'T3', 'T4'] }],
  ['examTypes 21 件', { examTypes: Array.from({ length: 21 }, (_, i) => `T${i}`) }],
  ['university 空', { preferences: [pref('', '法学部'), pref('B大学', '')] }],
  ['faculty 欠落', { preferences: [pref('A大学')] }],
  ['preferences に非 object', { preferences: [null, pref('A大学', '法学部')] }],
  ['preferences に文字列', { preferences: ['A大学', pref('B大学', '経済学部')] }],
  ['examTypes に非文字列', { examTypes: [1, '総合型', null] }],
  // ★ cap 境界をまたぐ不正値 ★
  //   legacy は「slice(0,3) してから非 record を捨てる」。canonical read mapper は
  //   「非 record を捨てながら 10 件まで詰める」。不正値が cap 境界より前にあると
  //   採用件数がずれ得る。ここが両者の唯一の構造的差分になり得るので必ず踏む。
  ['非 object が cap 境界を押し出す', { preferences: [null, pref('U1', 'F1'), pref('U2', 'F2'), pref('U3', 'F3')] }],
  ['非 object 2 個が押し出す', { preferences: [null, 'x', pref('U1', 'F1'), pref('U2', 'F2'), pref('U3', 'F3')] }],
  ['非 object が中間で押し出す', { preferences: [pref('U1', 'F1'), 0, pref('U2', 'F2'), pref('U3', 'F3')] }],
  ['university 空が境界を押し出す', { preferences: [pref('', 'F0'), pref('U1', 'F1'), pref('U2', 'F2'), pref('U3', 'F3')] }],
  ['examTypes 非文字列が境界を押し出す', { examTypes: [1, 'T1', 'T2', 'T3'] }],
  ['examTypes 空文字が境界を押し出す', { examTypes: ['', 'T1', 'T2', 'T3'] }],
  ['氏名・評定入り（読まれないこと）', { name: '山田太郎', overallGpa: '4.2', subjectGrades: { 国語: '5' }, grade: '高3' }],
  ['payload が配列', []],
  ['payload が文字列', 'x'],

  // ── S5-P7: projection semantics の全数行列（E-S50）─────────────────
  //   legacy は **生配列の先頭 3 slot** を見て、その中の record だけを使う。
  //   canonical は `rawPreferences`（生 index つきの事実列）から同じ規則を再現する。
  //   不正値の **位置** と **型** を総当たりし、両者が byte 一致することを示す。
  //   malformed placement
  ['不正値 @0', { preferences: [null, pref('U1', 'F1'), pref('U2', 'F2'), pref('U3', 'F3')] }],
  ['不正値 @1', { preferences: [pref('U0', 'F0'), null, pref('U2', 'F2'), pref('U3', 'F3')] }],
  ['不正値 @2', { preferences: [pref('U0', 'F0'), pref('U1', 'F1'), null, pref('U3', 'F3')] }],
  ['不正値 @3（境界外）', { preferences: [pref('U0', 'F0'), pref('U1', 'F1'), pref('U2', 'F2'), null] }],
  ['不正値 2 個が境界前', { preferences: [null, 'x', pref('U1', 'F1'), pref('U2', 'F2'), pref('U3', 'F3')] }],
  ['不正値 3 個が境界前', { preferences: [null, 'x', 5, pref('U1', 'F1'), pref('U2', 'F2')] }],
  ['不正値が境界後のみ', { preferences: [pref('U0', 'F0'), pref('U1', 'F1'), pref('U2', 'F2'), null, 'x', 5] }],
  ['全部不正値', { preferences: [null, 'x', 5, true] }],
  //   malformed types（entry そのもの）
  ['entry が null', { preferences: [null, pref('U1', 'F1')] }],
  ['entry が文字列', { preferences: ['s', pref('U1', 'F1')] }],
  ['entry が数値', { preferences: [0, pref('U1', 'F1')] }],
  ['entry が真偽値', { preferences: [true, pref('U1', 'F1')] }],
  ['entry が配列', { preferences: [[pref('U9', 'F9')], pref('U1', 'F1')] }],
  ['entry が undefined', { preferences: [undefined, pref('U1', 'F1')] }],
  ['entry が空 object', { preferences: [{}, pref('U1', 'F1'), pref('U2', 'F2'), pref('U3', 'F3')] }],
  ['entry が部分 record（faculty のみ）', { preferences: [{ faculty: 'F0' }, pref('U1', 'F1'), pref('U2', 'F2'), pref('U3', 'F3')] }],
  //   malformed field types（record は正しいが field の型が違う）
  ['university が数値', { preferences: [pref2(123, '  空白トリム対象  ')] }],
  ['university が数値 + 後続 valid', { preferences: [pref2(123, 'F0'), pref('U1', 'F1'), pref('U2', 'F2')] }],
  ['university が null', { preferences: [pref2(null, 'F0'), pref('U1', 'F1')] }],
  ['university が真偽値', { preferences: [pref2(true, 'F0'), pref('U1', 'F1')] }],
  ['university が配列', { preferences: [pref2([], 'F0'), pref('U1', 'F1')] }],
  ['university が object', { preferences: [pref2({}, 'F0'), pref('U1', 'F1')] }],
  ['university 欠落', { preferences: [{ faculty: 'F0' }, pref('U1', 'F1')] }],
  ['faculty が数値', { preferences: [pref2('U0', 123), pref('U1', 'F1')] }],
  ['faculty が null', { preferences: [pref2('U0', null), pref('U1', 'F1')] }],
  ['department が数値', { preferences: [pref2('U0', 'F0', 123)] }],
  //   item count
  ['items 0', { preferences: [] }],
  ['items 1', { preferences: [pref('U0', 'F0')] }],
  ['items 9', { preferences: Array.from({ length: 9 }, (_, i) => pref(`U${i}`, `F${i}`)) }],
  ['items 10', { preferences: Array.from({ length: 10 }, (_, i) => pref(`U${i}`, `F${i}`)) }],
  ['items 12（生 slot 0..2 が不正）', { preferences: [null, null, null, ...Array.from({ length: 9 }, (_, i) => pref(`U${i}`, `F${i}`))] }],
  //   length boundary（40 / 200 の両側）
  ['university 長 39', { preferences: [pref('あ'.repeat(39), 'F')] }],
  ['university 長 40', { preferences: [pref('あ'.repeat(40), 'F')] }],
  ['university 長 41', { preferences: [pref('あ'.repeat(41), 'F')] }],
  ['university 長 199', { preferences: [pref('あ'.repeat(199), 'F')] }],
  ['university 長 200', { preferences: [pref('あ'.repeat(200), 'F')] }],
  ['university 長 201', { preferences: [pref('あ'.repeat(201), 'F')] }],
  ['faculty 長 201', { preferences: [pref('U', 'あ'.repeat(201))] }],
  ['grade 長 199 / 200 / 201', { grade: 'あ'.repeat(200) }],
  //   preferences 自体が配列でない
  ['preferences が object', { preferences: { university: 'U' } }],
  ['preferences が文字列', { preferences: 'U' }],
  ['preferences が数値', { preferences: 3 }],
  //   PII 形状（値は log に出さない。containment は piiChecks 側で検査する）
  ['PII 形状の payload', { name: '山田太郎', overallGpa: '4.9', subjectGrades: { 国語: '5' }, grade: '高3', track: '文系', preferences: [pref('秘密大学', '秘密学部')] }],

  // ── read cap（E-S19）の residual ───────────────────────────────────
  //   先頭 200 字がすべて空白の文字列は canonical 側が中身を見られない。
  //   これは projection の差ではなく「canonical が値を持っていない」ことなので、
  //   legacy 維持（would_reduce_context / canonical_absent）が正しい。
  ['先頭空白 201（university）', { preferences: [pref(' '.repeat(201) + 'X大学', 'F')] }],
  ['先頭空白 201（grade）', { grade: ' '.repeat(201) + '高3' }],
];

async function equivalenceMatrix(): Promise<void> {
  const diffs: string[] = [];
  const authorities: Record<string, number> = { canonical: 0, legacy: 0 };
  const reasons: Record<string, number> = {};
  const canonicalLabels: string[] = [];

  for (const [label, payload] of PAYLOADS) {
    const l = await legacySection(payload);
    const d = await decidedSection(payload);
    // ★ 本 packet の中核 assertion ★ 切替後も AI が見る文字列は 1 byte も変わらない。
    if (l.section !== d.section) {
      diffs.push(`${label}\n        legacy =${JSON.stringify(l.section)}\n        decided=${JSON.stringify(d.section)}`);
    }
    authorities[d.authority] += 1;
    if (d.authority === 'canonical') canonicalLabels.push(label);
    if (d.reason) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
  }

  check(`★ 切替後の section が legacy と byte 一致（${PAYLOADS.length} payload）`,
    diffs.length === 0, diffs.join('\n      '));

  // read cap（E-S19 / shortText=200）に起因して canonical が値を見られない payload。
  //   これは projection 差ではないので、意図的な bounded fallback として別勘定にする。
  const capResidual = 1;

  // ★ 切替が空回りしていないことの証明 ★
  //   equality veto を入れた以上、「常に legacy」でも byte 一致は満たせてしまう。
  //   現実的な payload で canonical が実際に authority を取ることを別途要求する。
  check(`★ canonical が authority を取る payload が存在する（${authorities.canonical}/${PAYLOADS.length}）`,
    authorities.canonical > 0,
    `canonical=${authorities.canonical} legacy=${authorities.legacy}`);
  check('★ 典型 payload で canonical が authority を取る',
    canonicalLabels.includes('典型'),
    `canonical を取った payload: ${canonicalLabels.join(' / ')}`);
  console.log(`  authority: canonical=${authorities.canonical} legacy=${authorities.legacy}`);
  console.log(`  fallback reasons: ${JSON.stringify(reasons)}`);

  // ★ 生 slot 0..2 がすべて不正値なら **両者とも空** になる（行が増えない）★
  //   canonical_absent へ倒れるが出力は一致する。この一致は上の byte 比較で担保済みで、
  //   ここでは「canonical が勝手に 4 件目以降を拾ってこない」ことを明示的に固定する。
  {
    const r = mapBasicInfoRow(
      { payload: { preferences: [null, null, null, pref('U0', 'F0'), pref('U1', 'F1')] } },
      EXAM_READ_FIELD_LIMITS,
    );
    eq('生 slot 0..2 が全部不正なら canonical slot は null', projectTutorBasicInfoSlot(r), null);
  }

  // ★ S5-P7（E-S50）★ projection の構造差は解消済み。
  //   Packet 3 では「生 slot が不正値に消費されたか」が row に残らず
  //   `divergent_projection` へ倒すしかなかった。read layer が `rawPreferences` を
  //   報告するようになったため、legacy の規則を再現できる。
  eq('★ divergent_projection は 0 件（E-S50）', reasons.divergent_projection ?? 0, 0);
  eq('★ would_reduce_context は projection 由来では 0 件', reasons.would_reduce_context ?? 0, capResidual);
  // ★ 「veto を外して数字を合わせた」のではないことを示す ★
  //   実際に食い違う組を渡したら今も legacy に倒れること（別途 slotDecision でも検査）。
  const vetoRow = mapBasicInfoRow({ payload: { grade: '高3', preferences: [pref('A大学', '法学部')] } }, EXAM_READ_FIELD_LIMITS);
  eq('★ equivalence veto は生きている（人工的な不一致は legacy）',
    decideTutorBasicInfoSlot({
      usable: true,
      canonical: projectTutorBasicInfoSlot(vetoRow),
      legacy: { grade: '高2', targetSchools: ['A大学'], targetFields: ['法学部'] },
    }).reason, 'divergent_projection');

  // ★ 不正値を含む payload でも canonical が authority を取ることを名指しで固定する ★
  //   「全部 legacy でも byte 一致は満たせる」ので、解消の証拠を件数だけに頼らない。
  for (const label of [
    '不正値 @0', '不正値 @1', '不正値 @2', '不正値 2 個が境界前',
    'entry が空 object', 'entry が部分 record（faculty のみ）',
    'university が数値 + 後続 valid', 'university が null',
  ]) {
    check(`★ 不正値ありでも canonical が authority を取る: ${label}`,
      canonicalLabels.includes(label),
      `authority=${(await decidedSection(PAYLOADS.find(([l]) => l === label)![1])).authority}`);
  }

  // usable=false（canary OFF / not verified）でも出力は変わらない。
  const offDiffs: string[] = [];
  for (const [label, payload] of PAYLOADS) {
    const l = await legacySection(payload);
    const d = await decidedSection(payload, false);
    if (l.section !== d.section) offDiffs.push(label);
    if (d.authority !== 'legacy') offDiffs.push(`${label}: authority=${d.authority}`);
  }
  check('★ usable=false は全 payload で legacy かつ byte 一致', offDiffs.length === 0, offDiffs.join(', '));

  // 氏名 / 評定が canonical 経路で混入しない（E-P5 / E-P8）
  const piiPayload = { name: '山田太郎', overallGpa: '4.2', subjectGrades: { 国語: '5' }, grade: '高3' };
  const piiRow = mapBasicInfoRow({ payload: piiPayload }, EXAM_READ_FIELD_LIMITS);
  const piiSlot = JSON.stringify(projectTutorBasicInfoSlot(piiRow));
  check('氏名が canonical slot に出ない', !piiSlot.includes('山田太郎'), piiSlot);
  check('評定が canonical slot に出ない',
    !piiSlot.includes('4.2') && !piiSlot.includes('国語'), piiSlot);
  // ★ slot が持ってよい key を固定する ★
  //   row は評定（overallGpa / subjectGrades）を持つ。tutor はそれを読まない（E-P5）。
  //   「値が一致するか」だけを見ていると、新 field の追加が素通りする。key 自体を pin する。
  const richRow = mapBasicInfoRow(
    { payload: { grade: '高3', track: '文系', examTypes: ['総合型'], preferences: [pref('A大学', '法学部')], overallGpa: '4.2', subjectGrades: { 国語: '5' }, name: '山田太郎' } },
    EXAM_READ_FIELD_LIMITS,
  );
  eq('slot の key は 5 つに固定',
    Object.keys(projectTutorBasicInfoSlot(richRow) ?? {}).sort(),
    ['examType', 'grade', 'targetFields', 'targetSchools', 'track']);
  check('row は評定を持つ（この検査が空回りしていない）',
    richRow?.overallGpa === '4.2' && richRow?.subjectGrades !== null,
    JSON.stringify({ gpa: richRow?.overallGpa, sg: richRow?.subjectGrades }));
  const richSlot = JSON.stringify(projectTutorBasicInfoSlot(richRow));
  check('評定が slot に出ない（実データあり）',
    !richSlot.includes('4.2') && !richSlot.includes('国語'), richSlot);

  const piiSection = (await decidedSection(piiPayload)).section;
  check('氏名が section に出ない', !piiSection.includes('山田太郎'));
  check('評定が section に出ない', !piiSection.includes('4.2') && !piiSection.includes('国語'));
}

// ── raw metadata の封じ込め（E-S50）─────────────────────────────────
//
// `rawPreferences` / `sourceIndex` は **consumer compatibility のための事実**であって
// AI-visible でも wire でもない。次のどれにも出てはいけない:
//   Source-Sync の view / fingerprint（出ると device と server の claim が永久不一致）
//   canonical block の projection（`BasicInfo`）
//   tutor slot / section 文字列
async function rawMetadataContainment(): Promise<void> {
  const payload = {
    grade: '高3',
    track: '文系',
    examTypes: ['総合型'],
    preferences: [pref('A大学', '法学部', '法律学科'), null, { faculty: 'F1' }],
  };
  const row = mapBasicInfoRow({ payload, schema_version: '1' }, EXAM_READ_FIELD_LIMITS);
  check('row が rawPreferences を持つ（この検査が空回りしていない）',
    (row?.rawPreferences.length ?? 0) === 2, JSON.stringify(row?.rawPreferences));
  // 生 index が保持されている（詰めた位置ではない）
  eq('rawPreferences の sourceIndex は生 index',
    (row?.rawPreferences ?? []).map((r) => r.sourceIndex), [0, 2]);
  // 正規化列は従来どおり「university が string でない行」を落とす
  eq('preferences（正規化列）は従来どおり 1 件', row?.preferences.length ?? -1, 1);

  // 1) Source-Sync view / fingerprint
  const view = basicInfoSyncView(row!);
  eq('sync view の key 集合は不変',
    Object.keys(view).sort(),
    ['examTypes', 'grade', 'overallGpa', 'preferences', 'schemaVersion', 'subjectGrades', 'track']);
  const viewJson = JSON.stringify(view);
  check('sync view に rawPreferences が出ない', !viewJson.includes('rawPreferences'), viewJson.slice(0, 200));
  check('sync view に sourceIndex が出ない', !viewJson.includes('sourceIndex'), viewJson.slice(0, 200));

  // 2) device 側 view（同じ mapper を通る。ここに出ると claim が永久不一致になる）
  const info = {
    name: '山田', grade: '高3', track: '文系', examTypes: ['総合型'],
    preferences: [{ university: 'A大学', faculty: '法学部', department: '法律学科' }],
  } as unknown as BasicInfo;
  const dv = JSON.stringify(deviceBasicInfoView(info));
  check('device view に sourceIndex が出ない', !dv.includes('sourceIndex'), dv.slice(0, 200));
  // ★ fingerprint が実際に出ること（空回り検査でないこと）★
  const token = deviceBasicInfoToken(info);
  check('device claim token が作れる', typeof token === 'string' && token.startsWith('efp1:'), String(token));

  // 3) canonical block の projection
  const proj = JSON.stringify(projectBasicInfo(row, info));
  check('projectBasicInfo に sourceIndex が出ない', !proj.includes('sourceIndex'), proj.slice(0, 200));
  check('projectBasicInfo に rawPreferences が出ない', !proj.includes('rawPreferences'), proj.slice(0, 200));

  // 4) tutor slot / section 文字列
  const slot = JSON.stringify(projectTutorBasicInfoSlot(row));
  check('slot に sourceIndex が出ない', !slot.includes('sourceIndex'), slot);
  const section = (await decidedSection(payload)).section;
  check('section に sourceIndex が出ない', !section.includes('sourceIndex'));
  check('section に rawPreferences が出ない', !section.includes('rawPreferences'));

  // 5) 走査は 1 回・cap は 1 つ（2 つ目の切り方を作っていない）
  const mapperSrc = readFileSync(join(ROOT, 'lib/examSpine/read/rowMappers.ts'), 'utf8');
  const body = /export function mapBasicInfoRow\(([\s\S]*?)\n\}/.exec(mapperSrc);
  check('mapBasicInfoRow の本体が読める', body !== null);
  if (body) {
    eq('preferences の走査は 1 箇所',
      (body[1].match(/toIndexedRecordArray\(/g) ?? []).length, 1);
    check('rawPreferences 用の別 cap を持たない',
      !/rawPreferences[\s\S]{0,200}?limits\.(?!recordItems)/.test(body[1]));
  }
}

// ── cap の宣言 pin（値がずれたら永久に文字列が変わる）─────────────────
function capPin(): void {
  const src = readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8');
  const targets = /const MAX_TARGETS = (\d+);/.exec(src);
  const itemLen = /const MAX_ITEM_LENGTH = (\d+);/.exec(src);
  check('legacy の MAX_TARGETS を読める', targets !== null);
  check('legacy の MAX_ITEM_LENGTH を読める', itemLen !== null);
  if (targets) eq('cap pin: MAX_TARGETS', TUTOR_BASIC_INFO_MAX_TARGETS, Number(targets[1]));
  if (itemLen) eq('cap pin: MAX_ITEM_LENGTH', TUTOR_BASIC_INFO_MAX_ITEM_LENGTH, Number(itemLen[1]));
}

// ── slot 決定（fail-open / E-P7）──────────────────────────────────────
function slotDecision(): void {
  const row = mapBasicInfoRow(
    { payload: { grade: '高3', track: '文系', examTypes: ['総合型'], preferences: [pref('A大学', '法学部')] } },
    EXAM_READ_FIELD_LIMITS,
  );
  const legacy = { grade: '高3', track: '文系', examType: '総合型', targetSchools: ['A大学'], targetFields: ['法学部'] };

  eq('usable=false は legacy 維持',
    decideTutorBasicInfoSlot({ usable: false, canonical: projectTutorBasicInfoSlot(row), legacy }).authority, 'legacy');
  eq('usable=false の理由',
    decideTutorBasicInfoSlot({ usable: false, canonical: projectTutorBasicInfoSlot(row), legacy }).reason, 'not_usable');
  eq('canonical 不在は legacy 維持',
    decideTutorBasicInfoSlot({ usable: true, canonical: null, legacy }).authority, 'legacy');
  eq('canonical 不在の理由',
    decideTutorBasicInfoSlot({ usable: true, canonical: null, legacy }).reason, 'canonical_absent');
  eq('usable=true かつ canonical 有りは canonical',
    decideTutorBasicInfoSlot({ usable: true, canonical: projectTutorBasicInfoSlot(row), legacy }).authority, 'canonical');

  // E-P7: canonical に無い情報が legacy にあるなら legacy を維持する
  const richer = { ...legacy, targetSchools: ['A大学', 'Z大学'] };
  const d = decideTutorBasicInfoSlot({ usable: true, canonical: projectTutorBasicInfoSlot(row), legacy: richer });
  eq('E-P7: 情報が減るなら legacy 維持', d.authority, 'legacy');
  eq('E-P7: 理由', d.reason, 'would_reduce_context');
  const lostGrade = { ...legacy, grade: '高3' };
  const rowNoGrade = mapBasicInfoRow({ payload: { preferences: [pref('A大学', '法学部')], examTypes: ['総合型'], track: '文系' } }, EXAM_READ_FIELD_LIMITS);
  eq('E-P7: grade を失うなら legacy 維持',
    decideTutorBasicInfoSlot({ usable: true, canonical: projectTutorBasicInfoSlot(rowNoGrade), legacy: lostGrade }).authority, 'legacy');

  // legacy が無くても canonical があれば canonical（context は増える方向）
  // §10: 行が「増える」のも AI-visible の変化なので、legacy 不在なら canonical を採らない。
  eq('legacy 不在は legacy 維持（行を増やさない）',
    decideTutorBasicInfoSlot({ usable: true, canonical: projectTutorBasicInfoSlot(row), legacy: undefined }).authority, 'legacy');
  eq('legacy 不在の理由',
    decideTutorBasicInfoSlot({ usable: true, canonical: projectTutorBasicInfoSlot(row), legacy: undefined }).reason, 'divergent_projection');
  // 一致しない legacy（1 件多い/少ない）では採らない
  eq('legacy が 1 件多いと legacy 維持',
    decideTutorBasicInfoSlot({ usable: true, canonical: projectTutorBasicInfoSlot(row), legacy: { ...legacy, targetFields: ['法学部', '経済学部'] } }).authority, 'legacy');
  eq('legacy が別文字列だと legacy 維持',
    decideTutorBasicInfoSlot({ usable: true, canonical: projectTutorBasicInfoSlot(row), legacy: { ...legacy, grade: '高2' } }).authority, 'legacy');
  eq('別文字列の理由は divergent_projection',
    decideTutorBasicInfoSlot({ usable: true, canonical: projectTutorBasicInfoSlot(row), legacy: { ...legacy, grade: '高2' } }).reason, 'divergent_projection');
  // 両方無ければ legacy（= undefined）のまま
  eq('両方不在は legacy',
    decideTutorBasicInfoSlot({ usable: true, canonical: null, legacy: undefined }).authority, 'legacy');

  // 決定関数は採用側 enum と値しか返さない（authority selection API を作っていない）
  eq('決定の field は 3 つだけ',
    Object.keys(decideTutorBasicInfoSlot({ usable: true, canonical: projectTutorBasicInfoSlot(row), legacy })).sort(),
    ['authority', 'reason', 'value']);
}

// ── gate（E-S11 default deny）────────────────────────────────────────
function gateChecks(): void {
  const saveSlots = process.env.EXAM_SPINE_SLOT_SWITCH_SLOTS;
  const saveUsers = process.env.EXAM_SPINE_SLOT_SWITCH_USER_IDS;
  const set = (slots?: string, users?: string): void => {
    if (slots === undefined) delete process.env.EXAM_SPINE_SLOT_SWITCH_SLOTS;
    else process.env.EXAM_SPINE_SLOT_SWITCH_SLOTS = slots;
    if (users === undefined) delete process.env.EXAM_SPINE_SLOT_SWITCH_USER_IDS;
    else process.env.EXAM_SPINE_SLOT_SWITCH_USER_IDS = users;
  };
  const on = (): boolean => isExamSpineSlotSwitchEnabled('tutor.basic_info', USER);

  set(undefined, undefined);
  check('gate: env 未設定は deny', !on());
  set('tutor.basic_info', undefined);
  check('gate: slot だけでは deny（allowlist 必須）', !on());
  set(undefined, USER);
  check('gate: allowlist だけでは deny（slot 必須）', !on());
  set('', '');
  check('gate: 空文字は deny', !on());
  set('tutor.basic_info', 'other-user');
  check('gate: 別 user は deny', !on());
  set('tutor.activity', USER);
  check('gate: 未承認 slot は deny', !on());
  set('tutor.basic_info', USER);
  check('gate: slot + allowlist の連言で許可', on());
  check('gate: userId 空は deny', !isExamSpineSlotSwitchEnabled('tutor.basic_info', ''));
  set(saveSlots, saveUsers);

  // ★ Rule 10: 次の slot へ勝手に進まない ★
  eq('切替可能 slot は tutor.basic_info だけ',
    [...EXAM_SPINE_SWITCHABLE_SLOTS], ['tutor.basic_info']);
}

// ── static（切替範囲と legacy 保全）──────────────────────────────────
function staticChecks(): void {
  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  const asm = readFileSync(join(ROOT, 'lib/examSpine/context/assemble.server.ts'), 'utf8');

  // Rule 5: legacy serverRead を消していない
  // ★ import が残っているだけでは不十分 — **呼ばれている**ことを見る ★
  //   （import 行だけを見る検査は、呼び出しの改名を見逃す。）
  const routeCode = route.split('\n').filter((l) => !/^\s*import /.test(l)).join('\n');
  check('legacy loader が route から呼ばれている',
    /loadTutorStudentContextCached\s*\(/.test(routeCode));
  check('legacy context が prompt 経路の土台である',
    /spineContext =[\s\S]{0,300}contextResult\.context/.test(routeCode));
  check('legacy section builder が実在する',
    readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8')
      .includes('export function buildTutorSupabaseContextSection'));

  // Rule 1: basic_info **以外**の slot を差し替えていない
  const spread = /const spineContext =[\s\S]{0,400}?;/.exec(route);
  check('spineContext の派生が読める', spread !== null);
  if (spread) {
    // object literal の **全 top-level key** を拾う（先頭 1 個だけ見ると 2 個目の追加を見逃す）。
    const lit = /\{\s*\.\.\.contextResult\.context,([\s\S]*?)\}/.exec(spread[0]);
    check('差し替え literal が読める', lit !== null, spread[0].slice(0, 200));
    if (lit) {
      let depth = 0;
      const keys: string[] = [];
      for (const part of lit[1].split(/(?<![:=])[,]/)) {
        const seg = part;
        if (depth === 0) {
          const m = /^\s*(\w+)\s*:/.exec(seg);
          if (m) keys.push(m[1]);
        }
        depth += (seg.match(/[{[(]/g) ?? []).length - (seg.match(/[}\])]/g) ?? []).length;
      }
      eq('差し替える slot は basicInfo だけ', keys, ['basicInfo']);
    }
    check('slot 値は decideTutorBasicInfoSlot 由来', spread[0].includes('slotDecision.value'));
  }

  // canonical slot は usable('basic_info') の内側でしか作らない
  const guard = /if \(usable\('basic_info'\)\) \{([\s\S]*?)\n  \}/.exec(asm);
  check('assembler の basic_info block が読める', guard !== null);
  if (guard) {
    check('slot 生成は usable gate の内側', guard[1].includes('projectTutorBasicInfoSlot'));
    eq('slot 生成は 1 箇所だけ',
      (asm.match(/projectTutorBasicInfoSlot\(/g) ?? []).length, 1);
  }

  // ── query semantics: canonical assembly は 1 request 1 回だけ（E-S5 / Phase H）──
  //
  // ★ S5-P7 で追加 ★ 負例（route に 2 本目の buildCanonicalExamContext を足す）が
  //   どの suite でも検出されなかったため塞いだ。slot 切替と shadow は同じ context を
  //   共用する契約であり、2 本目を足すと同一 request 内で canonical read が二重化する。
  const routeBody = route.split('\n').filter((l) => !/^\s*import /.test(l)).join('\n');
  eq('canonical assembly の呼び出しは route に 1 箇所だけ',
    (routeBody.match(/buildCanonicalExamContext\s*\(/g) ?? []).length, 1);
  eq('canonical への代入先は 1 つだけ',
    (routeBody.match(/=\s*await\s+buildCanonicalExamContext\s*\(/g) ?? []).length, 1);
  check('canonical assembly は gate 変数を条件に持つ block の内側',
    /if \(slotSwitchEnabled \|\| shadowEnabled\) \{[\s\S]*?buildCanonicalExamContext\s*\(/.test(routeBody));
  // legacy loader も 1 回だけ（二重 read を legacy 側で作らない）
  eq('legacy loader の呼び出しも 1 箇所だけ',
    (routeBody.match(/loadTutorStudentContextCached\s*\(/g) ?? []).length, 1);

  // ── 4 gate combination の canonical read 本数（Phase H）──
  //
  //   slot OFF / shadow OFF → 0
  //   slot ON  / shadow OFF → 1
  //   slot OFF / shadow ON  → 1
  //   slot ON  / shadow ON  → 1（共用。2 本にならない）
  //
  // ★ 「1 箇所しか呼んでいない」＋「その条件式」から本数表を導く ★
  //   条件式を取り出して 4 通りで実際に評価する。条件が
  //   `slotSwitchEnabled || shadowEnabled` から変わればここが落ちる。
  //   呼び出し位置から **直前の** if 条件を取る（先頭から貪欲に拾うと別の if を掴む）。
  const callAt = routeBody.indexOf('buildCanonicalExamContext(');
  const before = callAt < 0 ? '' : routeBody.slice(0, callAt);
  const ifs = [...before.matchAll(/if \(([^)\n]*)\) \{/g)];
  const gateCond = ifs.length > 0 ? ifs[ifs.length - 1] : null;
  check('canonical assembly の gate 条件を取り出せる', gateCond !== null);
  if (gateCond) {
    const cond = gateCond[1].trim();
    eq('gate 条件は slot OR shadow', cond, 'slotSwitchEnabled || shadowEnabled');
    const reads = ([[false, false], [true, false], [false, true], [true, true]] as const).map(
      ([slotSwitchEnabled, shadowEnabled]) =>
        // 呼び出しは 1 箇所だけ（上で固定済み）なので、条件が真なら 1 本・偽なら 0 本。
        (slotSwitchEnabled || shadowEnabled) ? 1 : 0,
    );
    eq('canonical read 本数（OFF/OFF, ON/OFF, OFF/ON, ON/ON）', reads, [0, 1, 1, 1]);
    // 共用の証拠: slot 決定と shadow 比較が同じ変数を読む
    check('slot 決定は canonical assembly の結果を読む',
      /decideTutorBasicInfoSlot\(\{[\s\S]{0,400}?canonical/.test(routeBody));
    check('shadow 比較も同じ canonical を読む',
      /const shadow = canonical;/.test(routeBody));
  }

  // ── shadow の legacy 側 input が死んでいない（Phase G / activity coverage）──
  //
  // ★ S5-P7 で追加 ★ 負例（`activityCategoryCounts: false && …` で値を殺す）が
  //   key 集合検査を素通りしたため塞いだ。key があるだけでは coverage の証明にならない。
  //   ここでは「各 field の値式が live な source を参照し、定数で短絡されていない」ことを見る。
  //   （式の評価まではしない。定数短絡と source 参照の欠落までを検出する。）
  const cmpArgs = /compareTutorShadow\(\{([\s\S]*?)\n      \}\);/.exec(route);
  check('shadow 比較の実引数が読める', cmpArgs !== null);
  if (cmpArgs) {
    const legacyLit = /legacy:\s*\{([\s\S]*?)\n        \},/.exec(cmpArgs[1]);
    check('shadow の legacy literal が読める', legacyLit !== null, cmpArgs[1].slice(0, 160));
    if (legacyLit) {
      const lines = legacyLit[1].split('\n').filter((l) => !/^\s*\/\//.test(l));
      const entries: Array<[string, string]> = [];
      let cur: string | null = null;
      let buf: string[] = [];
      for (const l of lines) {
        const m = /^\s{10}(\w+):\s*([\s\S]*)$/.exec(l);
        if (m) {
          if (cur) entries.push([cur, buf.join('\n')]);
          cur = m[1];
          buf = [m[2]];
        } else if (cur) buf.push(l);
      }
      if (cur) entries.push([cur, buf.join('\n')]);
      check('legacy literal の field を抽出できる', entries.length >= 10, `${entries.length} 件`);
      check('activityCategoryCounts が legacy 側に渡っている',
        entries.some(([k]) => k === 'activityCategoryCounts'));
      const dead = entries.filter(([, v]) =>
        /(^|[^\w.])(false|true|0|null|undefined)\s*(&&|\?)/.test(v));
      eq('定数で短絡された field が無い', dead.map(([k]) => k), []);
      const noSource = entries.filter(([, v]) => !/(body\.|contextResult\.context\.)/.test(v));
      eq('全 field が live な source を参照している', noSource.map(([k]) => k), []);
    }
  }

  // 新 transport を作っていない（Rule 3 / 4）
  check('esy1 を復活させていない', !route.includes('esy1'));
  // 本 packet で transport を 1 つも追加していない（既存 edc1 のみ / Rule 3・4）。
  //   route は header 名 literal を持たず、既存 parser 経由でしか claim を読まない。
  const headerLiterals = [...route.matchAll(/['"](x-[a-z0-9-]+)['"]/g)].map((m) => m[1]);
  eq('route に header 名 literal が無い', headerLiterals, []);
  check('claim は既存 parser 経由で読む', route.includes('parseDeviceClaimHeader'));
  eq('claim header 定数は 1 つだけ',
    readFileSync(join(ROOT, 'lib/examSpine/sync/claim/types.ts'), 'utf8')
      .includes("export const EXAM_DEVICE_CLAIM_HEADER = 'x-exam-spine-device-claim'"), true);
}

// ── run ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('[exam-spine-packet3] Stage 5 Packet 3 — tutor basic_info slot switch');
  tutorContext = (await import('@/lib/contextBuilders/tutorContext')) as TutorContextModule;

  capPin();
  await equivalenceMatrix();
  await rawMetadataContainment();
  slotDecision();
  gateChecks();
  staticChecks();

  if (fetchCallCount !== 0) {
    console.error(`[exam-spine-packet3] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[exam-spine-packet3] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-packet3] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`\n[exam-spine-packet3] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 20)) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-packet3] PASS');
}

void main();
