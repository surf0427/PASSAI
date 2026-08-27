// Exam Spine — Stage 5 Packet S5-P10 / tutor `activity` slot 単独切替の検証。
//
// E-S57: Stage 5 の 2 番目の consumer 切替は **tutor purpose の activity slot だけ**。
//
// ★ 本 packet が証明したいこと ★
//   「activity を legacy serverRead から canonical（Source-Sync verified）へ切り替えても
//     **AI が見る文字列が 1 byte も変わらない**」
//
//   したがって中心は byte 比較である:
//     同一 payload
//       ├─ legacy   : stub client → loadTutorStudentContext → buildTutorSupabaseContextSection
//       └─ canonical: mapActivityRow → projectTutorActivitySlot → 同じ section builder
//     → section 文字列が完全一致すること
//
// 厳守: 実 Supabase 0 / 実ネットワーク 0 / AI 0 / clock 0 / random 0 / production 変更なし
//
// ★ PII を出さない ★
//   payload に PII 形状を含めるが、失敗時も **値そのものを print しない**。
//   出すのは label / enum / 件数 / boolean だけ。
//
// 使い方: npm run qa:examSpine:packet4

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';

// 'server-only' を no-op へ（packet3 QA と同じ手法。production 境界は変えない）。
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
  throw new Error(`[exam-spine-packet4] 外部通信が発生しました: ${String(args[0])}`);
}) as typeof globalThis.fetch;
void originalFetch;

import { mapActivityRow } from '@/lib/examSpine/read/rowMappers';
import {
  EXAM_SPINE_SWITCHABLE_SLOTS,
  isExamSpineSlotSwitchEnabled,
} from '@/lib/examSpine/context/slotSwitchGate.server';
import {
  type TutorActivitySlot,
  decideTutorActivitySlot,
  projectTutorActivitySlot,
} from '@/lib/examSpine/context/tutorActivitySlot';
import { ACTIVITY_CATEGORY_LABELS } from '@/lib/activityCategories';

type TutorContextModule = typeof import('@/lib/contextBuilders/tutorContext');
let tutorContext: TutorContextModule;

const ROOT = process.cwd();

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}\n      ${detail}` : name);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}
function eq<T>(name: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, a === e ? undefined : `expected=${e}\n      actual  =${a}`);
}

// ── Supabase stub（packet3 と同じ最小 builder。実 client は使わない）──
class StubBuilder {
  constructor(
    private readonly table: string,
    private readonly payload: unknown,
  ) {}
  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  async maybeSingle(): Promise<{ data: unknown; error: null }> {
    if (this.table !== 'activity_logs') return { data: null, error: null };
    return { data: { payload: this.payload }, error: null };
  }
  then(resolve: (v: { data: unknown; error: null }) => unknown): unknown {
    return resolve({ data: [], error: null });
  }
}

function stubClient(payload: unknown): unknown {
  return { from: (table: string) => new StubBuilder(table, payload) };
}

const USER = '00000000-0000-4000-8000-0000000000a2';

/** legacy 経路: stub client → loader → section。 */
async function legacySection(payload: unknown): Promise<{ section: string; activity: unknown }> {
  const ctx = await tutorContext.loadTutorStudentContext(USER, stubClient(payload) as never);
  return {
    section: tutorContext.buildTutorSupabaseContextSection(ctx),
    activity: (ctx as { activity?: unknown }).activity,
  };
}

/**
 * 切替後の経路: 同じ payload を legacy loader と canonical read の両方へ通し、
 * `decideTutorActivitySlot` が選んだ値で **同じ section builder** を回す。
 * ここで見るのは production が実際に流す経路そのもの。
 */
async function decidedSection(
  payload: unknown,
  usable = true,
): Promise<{ section: string; authority: string; reason: string | null }> {
  const legacyCtx = await tutorContext.loadTutorStudentContext(USER, stubClient(payload) as never);
  const legacySlot = (legacyCtx as { activity?: TutorActivitySlot }).activity;
  const row = mapActivityRow({ payload, schema_version: '1' });
  const d = decideTutorActivitySlot({
    usable,
    canonical: projectTutorActivitySlot(row),
    legacy: legacySlot,
  });
  const swapped = { ...legacyCtx, activity: d.value };
  return {
    section: tutorContext.buildTutorSupabaseContextSection(swapped),
    authority: d.authority,
    reason: d.reason,
  };
}

// ── payload fixtures ─────────────────────────────────────────────────
const CATS = Object.keys(ACTIVITY_CATEGORY_LABELS);
/** n 件の活動配列。要素の中身は集計に一切影響しない（長さだけが効く）。 */
const A = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ title: `t${i}` }));

const PAYLOADS: Array<[string, unknown]> = [
  // ── count 境界 ──（cap は無い。カテゴリ数 10 が構造上の上限）
  ['count 0', {}],
  ['count 1', { clubActivities: A(1) }],
  ['count 2', { clubActivities: A(2) }],
  ['count 3', { clubActivities: A(3) }],
  ['カテゴリ 9（cap-1 相当）', Object.fromEntries(CATS.slice(0, 9).map((k, i) => [k, A(i + 1)]))],
  ['カテゴリ 10（全カテゴリ）', Object.fromEntries(CATS.map((k, i) => [k, A(i + 1)]))],
  ['カテゴリ 11（未知を 1 つ足す）', {
    ...Object.fromEntries(CATS.map((k, i) => [k, A(i + 1)])),
    unknownCategory: A(4),
  }],
  ['大量（200 件）', { clubActivities: A(200) }],
  ['大量（全カテゴリ 200 件ずつ）', Object.fromEntries(CATS.map((k) => [k, A(200)]))],

  // ── ordering ──（宣言順が出力順。payload の key 順ではない）
  ['payload key が宣言順', { clubActivities: A(1), volunteerActivities: A(2) }],
  ['payload key が宣言と逆順', { volunteerActivities: A(2), clubActivities: A(1) }],
  ['payload key がシャッフル', { otherActivities: A(1), researchActivities: A(2), clubActivities: A(3) }],
  ['先頭カテゴリだけ欠落', Object.fromEntries(CATS.slice(1).map((k) => [k, A(1)]))],
  ['末尾カテゴリだけ', { otherActivities: A(1) }],

  // ── shape: 未知 / 既知の混在 ──
  ['未知カテゴリのみ', { unknownCategory: A(3) }],
  ['既知 + 未知', { clubActivities: A(1), unknownCategory: A(5) }],
  ['未知が先頭', { zzzUnknown: A(9), clubActivities: A(1) }],
  ['ラベル名と同名の key', { 部活動: A(9), clubActivities: A(1) }],

  // ── shape: 空 / 非配列 ──
  ['空配列のみ', { clubActivities: [] }],
  ['空配列 + 実データ', { clubActivities: [], volunteerActivities: A(2) }],
  ['全カテゴリ空配列', Object.fromEntries(CATS.map((k) => [k, []]))],
  ['非配列 string', { clubActivities: 'not-an-array' }],
  ['非配列 number', { clubActivities: 3 }],
  ['非配列 object', { clubActivities: { a: 1 } }],
  ['非配列 null', { clubActivities: null }],
  ['非配列 boolean', { clubActivities: true }],
  ['非配列が先頭 + 実データ', { clubActivities: 'x', volunteerActivities: A(2) }],

  // ── shape: 要素の型（長さしか見ないので出力に影響しないことを固定する）──
  ['要素が null', { clubActivities: [null, null] }],
  ['要素が primitive', { clubActivities: [1, 'x', true] }],
  ['要素が配列', { clubActivities: [[1], [2]] }],
  ['要素が空 object', { clubActivities: [{}, {}] }],
  ['要素が部分 record', { clubActivities: [{ title: '' }, {}] }],
  ['要素が空文字', { clubActivities: ['', '  '] }],
  ['要素が超長文字列', { clubActivities: ['あ'.repeat(5000)] }],
  ['要素が重複', { clubActivities: [{ title: 'same' }, { title: 'same' }] }],
  ['要素の createdAt が同値', { clubActivities: [{ createdAt: 'T' }, { createdAt: 'T' }] }],
  ['要素の createdAt が逆順', { clubActivities: [{ createdAt: 'T2' }, { createdAt: 'T1' }] }],

  // ── payload 自体の型 ──
  ['payload が null', null],
  ['payload が配列', [1, 2, 3]],
  ['payload が文字列', 'x'],
  ['payload が数値', 5],
  ['payload が boolean', true],
  ['payload が空 object', {}],

  // ── PII 形状（値は出力しない。containment は別途検査）──
  ['PII 形状の payload', {
    clubActivities: [{ title: '秘密部', description: '個人が特定される記述', achievement: '秘密の成果' }],
    volunteerActivities: [{ title: '秘密ボランティア' }],
  }],
];

async function equivalenceMatrix(): Promise<void> {
  console.log('\n1. AI-visible byte equivalence');
  const diffLabels: string[] = [];
  const authorities: Record<string, number> = { canonical: 0, legacy: 0 };
  const reasons: Record<string, number> = {};
  const canonicalLabels: string[] = [];

  for (const [label, payload] of PAYLOADS) {
    const l = await legacySection(payload);
    const d = await decidedSection(payload);
    // ★ 本 packet の中核 assertion ★ 切替後も AI が見る文字列は 1 byte も変わらない。
    //   ⚠️ 不一致でも section 本文は print しない（PII 形状を含むため label だけ出す）。
    if (l.section !== d.section) diffLabels.push(label);
    authorities[d.authority] += 1;
    if (d.authority === 'canonical') canonicalLabels.push(label);
    if (d.reason) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
  }

  check(`★ 切替後の section が legacy と byte 一致（${PAYLOADS.length} payload）`,
    diffLabels.length === 0, diffLabels.join(', '));
  eq('★ divergent_projection は 0 件', reasons.divergent_projection ?? 0, 0);
  eq('★ would_reduce_context は 0 件', reasons.would_reduce_context ?? 0, 0);

  // ★ 切替が空回りしていないことの証明 ★
  //   equality veto を入れた以上、「常に legacy」でも byte 一致は満たせてしまう。
  check(`★ canonical が authority を取る payload が存在する（${authorities.canonical}/${PAYLOADS.length}）`,
    authorities.canonical > 0, `canonical=${authorities.canonical} legacy=${authorities.legacy}`);
  for (const label of [
    'count 1', 'カテゴリ 10（全カテゴリ）', 'payload key が宣言と逆順',
    '既知 + 未知', '空配列 + 実データ', '非配列が先頭 + 実データ', '大量（200 件）',
  ]) {
    check(`★ canonical が authority を取る: ${label}`, canonicalLabels.includes(label));
  }
  console.log(`  authority: canonical=${authorities.canonical} legacy=${authorities.legacy}`);
  console.log(`  fallback reasons: ${JSON.stringify(reasons)}`);

  // ★ veto は生きている（人工的な不一致は legacy に倒れる）★
  const row = mapActivityRow({ payload: { clubActivities: A(2) }, schema_version: '1' });
  eq('★ equivalence veto は生きている（件数違い）',
    decideTutorActivitySlot({
      usable: true,
      canonical: projectTutorActivitySlot(row),
      legacy: { totalCount: 3, categoryCounts: { 部活動: 3 } },
    }).reason, 'would_reduce_context');
  eq('★ equivalence veto は生きている（ラベル違い）',
    decideTutorActivitySlot({
      usable: true,
      canonical: projectTutorActivitySlot(row),
      legacy: { totalCount: 2, categoryCounts: { ボランティア: 2 } },
    }).reason, 'divergent_projection');
  // ★ 順序違いも AI-visible の変化として veto する ★
  const twoRow = mapActivityRow({
    payload: { clubActivities: A(1), volunteerActivities: A(2) },
    schema_version: '1',
  });
  eq('★ categoryCounts の順序違いを veto する',
    decideTutorActivitySlot({
      usable: true,
      canonical: projectTutorActivitySlot(twoRow),
      legacy: { totalCount: 3, categoryCounts: { ボランティア: 2, 部活動: 1 } },
    }).reason, 'divergent_projection');

  // usable=false（canary OFF / not verified）でも出力は変わらない。
  const offDiffs: string[] = [];
  for (const [label, payload] of PAYLOADS) {
    const l = await legacySection(payload);
    const d = await decidedSection(payload, false);
    if (l.section !== d.section) offDiffs.push(label);
    if (d.authority !== 'legacy') offDiffs.push(`${label}: authority=${d.authority}`);
  }
  check('★ usable=false は全 payload で legacy かつ byte 一致', offDiffs.length === 0, offDiffs.join(', '));
}

// ── AI-visible golden pin（共有 oracle の盲点を塞ぐ）────────────────────
//
// ★ なぜ byte 比較だけでは足りないか（負例で実測した）★
//   legacy も canonical も `summarizeActivityCategories` という **同じ関数**を通る。
//   そのため、その共有関数自体を変異させると **両側が同じように壊れ**、
//   legacy vs canonical の byte 比較は素通りする（実測: `arr.length > 0` を
//   `>= 0` にする変異が 44 payload すべてで一致したまま通過した）。
//
//   共有 oracle は「切替で壊れていないこと」は示せるが「AI-visible が
//   そもそも変わっていないこと」は示せない。したがって section 行そのものを
//   **外部の固定値**として凍結する。ここが落ちたら AI が見る文字列が変わっている。
//
//   ⚠️ 期待値をコードから再生成して更新しないこと。更新は「prompt 文言を
//     意図的に変える」という別の決定であり、その decision 無しには動かさない。
const ACTIVITY_LINE_GOLDEN: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
  ['1 カテゴリ', { clubActivities: A(2) },
    '・活動整理には、部活動2件 が保存されています（計2件）。'],
  ['payload が宣言と逆順（出力は宣言順）', { volunteerActivities: A(2), clubActivities: A(1) },
    '・活動整理には、部活動1件・ボランティア2件 が保存されています（計3件）。'],
  ['0 件カテゴリと未知カテゴリは出ない', { clubActivities: [], volunteerActivities: A(2), unknownCategory: A(5) },
    '・活動整理には、ボランティア2件 が保存されています（計2件）。'],
  ['非配列は 1 件にならず落ちる', { clubActivities: 'not-an-array', volunteerActivities: A(2) },
    '・活動整理には、ボランティア2件 が保存されています（計2件）。'],
  ['非配列だけなら行が出ない', { clubActivities: 'x', researchActivities: 3 }, ''],
  ['全 10 カテゴリ（宣言順・ラベル・区切り・計）', Object.fromEntries(CATS.map((k, i) => [k, A(i + 1)])),
    '・活動整理には、部活動1件・ボランティア2件・留学3件・探究4件・アルバイト5件・資格6件・'
    + 'コンテスト7件・読書8件・趣味9件・その他10件 が保存されています（計55件）。'],
];

async function goldenLines(): Promise<void> {
  console.log('\n2. AI-visible golden pin（section 行そのものを凍結）');
  for (const [label, payload, expected] of ACTIVITY_LINE_GOLDEN) {
    // legacy 経路の section から activity 行だけを取り出して比較する。
    const legacy = (await legacySection(payload)).section
      .split('\n')
      .find((l) => l.startsWith('・活動整理には、')) ?? '';
    eq(`golden(legacy): ${label}`, legacy, expected);
    // 切替後の経路も同じ行を出す。
    const decided = (await decidedSection(payload)).section
      .split('\n')
      .find((l) => l.startsWith('・活動整理には、')) ?? '';
    eq(`golden(switched): ${label}`, decided, expected);
  }
  // 0 件なら行そのものが存在しない（代替文言を作らない）。
  const empty = (await decidedSection({})).section;
  check('golden: 0 件では活動行が存在しない', !empty.includes('活動整理には'));
  check('golden: 0 件で代替文言を作らない', !empty.includes('活動'), empty.slice(0, 80));
}

// ── 集計 authority の固定（E-S45 / 正本 1 箇所）──────────────────────
/**
 * コメントを落として **実コード**だけにする。
 * ★ これが無いと「やってはいけないこと」を説明した注釈自体に検査が反応し、
 *   実装が正しくても落ちる（実測）。逆に、注釈を消しただけで通る検査にもしない
 *   （下の負例で実コードの変異が検出されることを確認している）。
 */
function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

function summaryAuthority(): void {
  console.log('\n2. 集計 authority（正本 1 箇所）');
  const slotSrc = stripComments(
    readFileSync(join(ROOT, 'lib/examSpine/context/tutorActivitySlot.ts'), 'utf8'),
  );
  const legacySrc = stripComments(
    readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8'),
  );

  // ★ 両者が同じ関数を通る ★ 片方だけ差し替えると prompt が黙って変わる。
  check('canonical slot は summarizeActivityCategories を通す',
    /summarizeActivityCategories\s*\(/.test(slotSrc));
  check('legacy projection も summarizeActivityCategories を通す',
    /summarizeActivityCategories\s*\(/.test(legacySrc));
  check('canonical slot が独自のカテゴリ表を持たない',
    !slotSrc.includes('clubActivities') && !slotSrc.includes('部活動'));
  check('canonical slot が独自の件数集計ループを持たない',
    !/\.length\s*>\s*0/.test(slotSrc) && !/Array\.isArray/.test(slotSrc));

  // ★ row.categoryCounts を使っていない ★
  //   あれは生 key / 0 件込み / 未知込みの **別表現**。取り違えると prompt が変わる。
  //   ★ row 由来の別表現を読んでいないこと ★ slot 型自身の `categoryCounts` とは区別する。
  check('canonical slot は row.categoryCounts を読まない',
    !/\brow\s*\??\.\s*categoryCounts/.test(slotSrc),
    'row.categoryCounts を読むと未知カテゴリと 0 件が prompt に出る');
  check('canonical slot が読む row の field は payload だけ',
    [...slotSrc.matchAll(/\brow\s*\??\.\s*(\w+)/g)].every((m) => m[1] === 'payload'),
    [...new Set([...slotSrc.matchAll(/\brow\s*\??\.\s*(\w+)/g)].map((m) => m[1]))].join(','));
  // この検査が空回りしていないこと（row は実際に別表現を持っている）。
  const mixed = mapActivityRow({ payload: { clubActivities: [], unknownCategory: A(2) } });
  eq('row.categoryCounts は生 key / 0 件込みの別表現である（空回り検査でない）',
    mixed?.categoryCounts, { clubActivities: 0, unknownCategory: 2 });
  eq('slot はその payload では null（0 件なので行を出さない）',
    projectTutorActivitySlot(mixed), null);

  // cap ownership: mapper に activity の cap は無い（E-S19 は read cap を read layer が持つが
  // activity snapshot は truncate 対象を持たない）。mapper が limits を受け取らないことを固定する。
  const mapperSrc = stripComments(readFileSync(join(ROOT, 'lib/examSpine/read/rowMappers.ts'), 'utf8'));
  const mapFn = /export function mapActivityRow\(([\s\S]*?)\n\}/.exec(mapperSrc);
  check('mapActivityRow の本体が読める', mapFn !== null);
  if (mapFn) {
    check('mapActivityRow は limits を受け取らない（cap を持たない）',
      !mapFn[1].includes('limits'), mapFn[1].slice(0, 120));
    check('mapActivityRow は payload を truncate しない',
      !mapFn[1].includes('truncate') && !mapFn[1].includes('slice'));
  }
}

// ── narrative / PII の封じ込め ────────────────────────────────────────
async function containment(): Promise<void> {
  console.log('\n3. narrative / PII containment');
  const SECRET_TITLE = '秘密部';
  const SECRET_DESC = '個人が特定される記述';
  const payload = {
    clubActivities: [{ title: SECRET_TITLE, description: SECRET_DESC, achievement: '秘密の成果' }],
  };
  const row = mapActivityRow({ payload, schema_version: '1' });
  const slot = projectTutorActivitySlot(row);
  const slotJson = JSON.stringify(slot);
  check('slot に活動名が出ない', !slotJson.includes(SECRET_TITLE));
  check('slot に説明文が出ない', !slotJson.includes(SECRET_DESC));
  eq('slot の key は 2 つに固定', Object.keys(slot ?? {}).sort(), ['categoryCounts', 'totalCount']);
  eq('slot の categoryCounts はラベル → 件数のみ', slot?.categoryCounts, { 部活動: 1 });
  // ★ この検査が空回りしていないこと ★ row は実際に narrative を持っている。
  check('row は narrative を持つ（空回り検査でない）',
    JSON.stringify(row?.payload).includes(SECRET_TITLE));

  const section = (await decidedSection(payload)).section;
  check('section に活動名が出ない', !section.includes(SECRET_TITLE));
  check('section に説明文が出ない', !section.includes(SECRET_DESC));
  check('section に schema_version が出ない', !section.includes('schema_version'));
}

// ── slot 決定（fail-open / E-P7）──────────────────────────────────────
function slotDecision(): void {
  console.log('\n4. slot decision（fail-open / E-P7）');
  const row = mapActivityRow({ payload: { clubActivities: A(2) }, schema_version: '1' });
  const legacy: TutorActivitySlot = { totalCount: 2, categoryCounts: { 部活動: 2 } };

  eq('usable=false は legacy 維持',
    decideTutorActivitySlot({ usable: false, canonical: projectTutorActivitySlot(row), legacy }).authority, 'legacy');
  eq('usable=false の理由',
    decideTutorActivitySlot({ usable: false, canonical: projectTutorActivitySlot(row), legacy }).reason, 'not_usable');
  eq('canonical 不在は legacy 維持',
    decideTutorActivitySlot({ usable: true, canonical: null, legacy }).authority, 'legacy');
  eq('canonical 不在の理由',
    decideTutorActivitySlot({ usable: true, canonical: null, legacy }).reason, 'canonical_absent');
  eq('usable=true かつ一致なら canonical',
    decideTutorActivitySlot({ usable: true, canonical: projectTutorActivitySlot(row), legacy }).authority, 'canonical');

  // E-P7: canonical に無い情報が legacy にあるなら legacy を維持する
  const richer: TutorActivitySlot = { totalCount: 5, categoryCounts: { 部活動: 2, ボランティア: 3 } };
  const d = decideTutorActivitySlot({ usable: true, canonical: projectTutorActivitySlot(row), legacy: richer });
  eq('E-P7: 情報が減るなら legacy 維持', d.authority, 'legacy');
  eq('E-P7: 理由', d.reason, 'would_reduce_context');

  // legacy 不在で canonical を採ると **行が増える**（AI-visible の変化）→ 採らない
  eq('legacy 不在は legacy 維持（行を増やさない）',
    decideTutorActivitySlot({ usable: true, canonical: projectTutorActivitySlot(row), legacy: undefined }).authority, 'legacy');
  eq('legacy 不在の理由',
    decideTutorActivitySlot({ usable: true, canonical: projectTutorActivitySlot(row), legacy: undefined }).reason, 'divergent_projection');
  eq('両方不在は legacy',
    decideTutorActivitySlot({ usable: true, canonical: null, legacy: undefined }).authority, 'legacy');
  eq('決定の field は 3 つだけ',
    Object.keys(decideTutorActivitySlot({ usable: true, canonical: projectTutorActivitySlot(row), legacy })).sort(),
    ['authority', 'reason', 'value']);
}

// ── gate（E-S11 default deny / slot 独立）──────────────────────────────
function gateChecks(): void {
  console.log('\n5. gate（default deny / slot 独立）');
  const saveSlots = process.env.EXAM_SPINE_SLOT_SWITCH_SLOTS;
  const saveUsers = process.env.EXAM_SPINE_SLOT_SWITCH_USER_IDS;
  const set = (slots?: string, users?: string): void => {
    if (slots === undefined) delete process.env.EXAM_SPINE_SLOT_SWITCH_SLOTS;
    else process.env.EXAM_SPINE_SLOT_SWITCH_SLOTS = slots;
    if (users === undefined) delete process.env.EXAM_SPINE_SLOT_SWITCH_USER_IDS;
    else process.env.EXAM_SPINE_SLOT_SWITCH_USER_IDS = users;
  };
  const on = (): boolean => isExamSpineSlotSwitchEnabled('tutor.activity', USER);

  set(undefined, undefined);
  check('gate: env 未設定は deny', !on());
  set('tutor.activity', undefined);
  check('gate: slot だけでは deny（allowlist 必須）', !on());
  set(undefined, USER);
  check('gate: allowlist だけでは deny（slot 必須）', !on());
  set('', '');
  check('gate: 空文字は deny', !on());
  set('tutor.activity', 'other-user');
  check('gate: 別 user は deny', !on());
  set('tutor.basic_info', USER);
  check('gate: basic_info を許可しても activity は deny（slot 独立）', !on());
  set('tutor.self_analysis', USER);
  check('gate: 未承認 slot は deny', !on());
  set('tutor.activity', USER);
  check('gate: slot + allowlist の連言で許可', on());
  check('gate: userId 空は deny', !isExamSpineSlotSwitchEnabled('tutor.activity', ''));
  // 両方 ON でも互いに独立
  set('tutor.basic_info,tutor.activity', USER);
  check('gate: 2 slot 同時 ON も可', on() && isExamSpineSlotSwitchEnabled('tutor.basic_info', USER));
  set(saveSlots, saveUsers);

  eq('切替可能 slot は承認済みの 2 つだけ',
    [...EXAM_SPINE_SWITCHABLE_SLOTS], ['tutor.basic_info', 'tutor.activity']);
}

// ── static（切替範囲 / legacy 保全 / read 本数）────────────────────────
function staticChecks(): void {
  console.log('\n6. static（切替範囲 / legacy 保全 / read 本数）');
  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  const asm = readFileSync(join(ROOT, 'lib/examSpine/context/assemble.server.ts'), 'utf8');
  const routeCode = route.split('\n').filter((l) => !/^\s*import /.test(l)).join('\n');

  // ★ route が activity slot を実際に配線している ★
  //   S5-P10 で追加: route の wiring を丸ごと戻しても本 suite が緑のままだった（実測）。
  //   equivalence harness は module を直接呼ぶので、route の配線漏れを検出できない。
  check('route が decideTutorActivitySlot を呼んでいる',
    /decideTutorActivitySlot\s*\(/.test(routeCode));
  check('route が activity slot の gate を評価している',
    /isExamSpineSlotSwitchEnabled\('tutor\.activity',/.test(routeCode));
  check('activity slot の usable は gate AND canonical.ok',
    /decideTutorActivitySlot\(\{[\s\S]{0,200}?usable: activitySlotSwitchEnabled && canonical\?\.ok === true/.test(routeCode));
  check('activity slot の canonical 入力は assembly の tutorActivitySlot',
    /canonical: canonical\?\.ok === true \? canonical\.tutorActivitySlot : null/.test(routeCode));
  check('activity slot の legacy 入力は contextResult.context.activity',
    /legacy: contextResult\.context\.activity/.test(routeCode));
  check('採用時のみ context の activity を差し替える',
    /activitySlotDecision\.authority === 'canonical'[\s\S]{0,120}?activity: activitySlotDecision\.value/.test(routeCode));

  // legacy serverRead を消していない（呼ばれていることを見る）
  check('legacy loader が route から呼ばれている',
    /loadTutorStudentContextCached\s*\(/.test(routeCode));
  check('legacy activity projection が実在する',
    readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8')
      .includes('function projectActivity('));

  // canonical slot は usable('activity') の内側でしか作らない
  const guard = /if \(usable\('activity'\)\) \{([\s\S]*?)\n  \}/.exec(asm);
  check('assembler の activity block が読める', guard !== null);
  if (guard) {
    check('activity slot 生成は usable gate の内側', guard[1].includes('projectTutorActivitySlot'));
  }
  eq('activity slot 生成は 1 箇所だけ',
    (asm.match(/projectTutorActivitySlot\(/g) ?? []).length, 1);

  // ★ 追加 query を出していない ★ slot は既存 snapshotRow を使い回す
  eq('assembler の activity block が snapshotRow を追加で呼んでいない',
    (guard ? guard[1].match(/snapshotRow</g) ?? [] : []).length, 1);

  // essay_chat など tutor 以外の purpose へ activity を漏らしていない
  const purpose = readFileSync(join(ROOT, 'lib/examSpine/purpose.ts'), 'utf8');
  const essayChat = /essay_chat:\s*\{([\s\S]*?)\n  \},/.exec(purpose);
  check('essay_chat の registry entry が読める', essayChat !== null);
  if (essayChat) {
    const sources = /sources:\s*\[([\s\S]*?)\]/.exec(essayChat[1]);
    check('essay_chat の sources が読める', sources !== null);
    if (sources) {
      check('essay_chat は activity を許可していない', !sources[1].includes("'activity'"), sources[1].trim());
    }
  }
  // ── shadow observation が prompt 経路へ漏れていない（Phase 11）──
  //
  // ★ S5-P10 で追加 ★ 負例（`shadowOverall === 'MATCH'` で spineContext を分岐させる）が
  //   どの suite でも検出されなかったため塞いだ。既存の禁止識別子リストは
  //   comparison / shadowResolvedInput / context.blocks を見ていたが、
  //   **比較結果の enum 自体**（shadowOverall / shadowMismatchCount）は入っていなかった。
  //
  //   不変条件は「shadow は観測であって出力に影響しない」。したがってこの 2 変数は
  //   宣言 / shadow block 内での代入 / telemetry への受け渡し 以外に現れてはいけない。
  const SHADOW_OBSERVATIONS = ['shadowOverall', 'shadowMismatchCount'] as const;
  const flushAt = routeCode.indexOf('lat.flush({');
  check('telemetry flush の位置を特定できる', flushAt !== -1);
  for (const name of SHADOW_OBSERVATIONS) {
    const uses = [...routeCode.matchAll(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g'))];
    check(`${name} が route に現れる（空回り検査でない）`, uses.length > 0);
    const illegal = uses.filter((m) => {
      const at = m.index ?? 0;
      const lineStart = routeCode.lastIndexOf('\n', at) + 1;
      const line = routeCode.slice(lineStart, routeCode.indexOf('\n', at));
      if (new RegExp(`^\\s*let ${name}`).test(line)) return false; // 宣言
      if (new RegExp(`^\\s*${name} = `).test(line)) return false; // shadow block 内の代入
      if (at > flushAt && flushAt !== -1) return false; // telemetry
      return true;
    });
    eq(`${name} は宣言 / shadow 内代入 / telemetry 以外に現れない`,
      illegal.map((m) => {
        const at = m.index ?? 0;
        return routeCode.slice(routeCode.lastIndexOf('\n', at) + 1, routeCode.indexOf('\n', at)).trim();
      }), []);
  }
  // prompt 合成の実引数に shadow 由来の識別子が無い（別名経由も塞ぐ）
  const composeArgs = /composeTutorPrompt\(\{([\s\S]*?)\n  \}\);/.exec(routeCode);
  check('composeTutorPrompt の実引数が読める', composeArgs !== null);
  if (composeArgs) {
    for (const forbidden of [...SHADOW_OBSERVATIONS, 'comparison', 'shadowResolvedInput', 'shadowBranch']) {
      check(`prompt 実引数に ${forbidden} が無い`, !composeArgs[1].includes(forbidden),
        composeArgs[1].slice(0, 120));
    }
    // spineContext は slot 決定の結果そのものを渡す（途中で別の値へ差し替えない）
    check('spineContext は slot 決定の結果をそのまま渡す',
      /\n\s*spineContext,/.test(composeArgs[1]), composeArgs[1].slice(0, 200));
  }

  // slot 切替 module が tutor 以外の purpose 名を持たない
  const slotSrc2 = stripComments(
    readFileSync(join(ROOT, 'lib/examSpine/context/tutorActivitySlot.ts'), 'utf8'),
  );
  check('activity slot module が essay_chat を参照しない', !slotSrc2.includes('essay_chat'));
}

// ── run ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('[exam-spine-packet4] Stage 5 Packet S5-P10 — tutor activity slot switch');
  tutorContext = (await import('@/lib/contextBuilders/tutorContext')) as TutorContextModule;

  await equivalenceMatrix();
  await goldenLines();
  summaryAuthority();
  await containment();
  slotDecision();
  gateChecks();
  staticChecks();

  if (fetchCallCount !== 0) {
    console.error(`[exam-spine-packet4] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[exam-spine-packet4] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-packet4] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`\n[exam-spine-packet4] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 20)) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-packet4] PASS');
}

void main();
