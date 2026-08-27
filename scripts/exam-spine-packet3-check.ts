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

  // 構造差が観測可能な reason として残る（隠れて一致しているのではない）。
  check('★ 構造差は divergent_projection として観測される',
    (reasons.divergent_projection ?? 0) > 0, JSON.stringify(reasons));

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
