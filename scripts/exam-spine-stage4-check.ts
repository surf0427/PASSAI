// Exam Spine — Stage 4 Canonical Exam Context の contract check。
//
// 検証軸（Stage 4 §20）:
//   purpose gate が read の手前で効く / unknown purpose は default deny /
//   single I/O boundary / request scope / mixed origin / provenance completeness /
//   status semantics / revision determinism / fingerprint determinism / veto semantics /
//   essay body の非混入 / mutation impossibility / AI 呼び出しゼロ / service_role 非依存
//
// 実 Supabase / 実 AI を一切使わない（fake executor のみ）。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── 外部通信の trap（読み込み前に仕掛ける）──────────────────────────
let fetchCallCount = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage4] 外部通信が発生しました: ${String(args[0])}`);
}) as typeof realFetch;

import { buildCanonicalExamContext } from '@/lib/examSpine/context/assemble.server';
import type { BuildCanonicalExamContextInput } from '@/lib/examSpine/context/assemble.server';
import { EXAM_CONTEXT_SOURCE_STATES, EXAM_CONTEXT_VERSION } from '@/lib/examSpine/context/types';
import type { CanonicalExamContext } from '@/lib/examSpine/context/types';
import { computeContextRevision, computeContextFingerprint } from '@/lib/examSpine/context/identity';
import { EXAM_CONTEXT_PURPOSES } from '@/lib/examSpine/types';
import { EXAM_SOURCE_KINDS, EXAM_SOURCE_TABLES } from '@/lib/examSpine/sourceData/types';
import type { ExamSourceKind } from '@/lib/examSpine/sourceData/types';
import { sourcesForPurpose } from '@/lib/examSpine/purpose';
import type { ExamRequestAuthorization } from '@/lib/examSpine/read/requestSnapshot.server';
import type { ExamContextInput } from '@/lib/examSpine/orchestrator/input';

import {
  createRecordingExecutor,
  fullDb,
  emptyDb,
  USER_A,
  type FakeDb,
} from './fixtures/examSpineStage3';

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, `expected ${e}, got ${a}`);
}

const authorizeA = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A });

function bridgeInput(): ExamContextInput {
  return {
    basicInfo: {
      name: '受験 太郎',
      grade: '高校2年',
      track: '文系',
      preferences: [{ university: 'ブリッジ大学', faculty: '', department: '' }],
      examTypes: [],
    } as ExamContextInput['basicInfo'],
  };
}

async function build(
  overrides: Partial<BuildCanonicalExamContextInput> & { db?: FakeDb } = {},
): Promise<{
  result: Awaited<ReturnType<typeof buildCanonicalExamContext>>;
  rec: ReturnType<typeof createRecordingExecutor>;
}> {
  const db = overrides.db ?? fullDb();
  const rec = createRecordingExecutor(db);
  const result = await buildCanonicalExamContext({
    request: overrides.request ?? new Request('https://example.test/stage4'),
    purpose: overrides.purpose ?? 'tutor',
    authorize: overrides.authorize ?? authorizeA,
    bridge: overrides.bridge ?? bridgeInput(),
    deviceClaims: overrides.deviceClaims,
    executor: rec.executor,
    projectionNow: overrides.projectionNow ?? '2026-01-01T00:00:00.000Z',
  });
  return { result, rec };
}

function ctxOf(r: Awaited<ReturnType<typeof buildCanonicalExamContext>>): CanonicalExamContext {
  if (!r.ok) throw new Error(`expected ok context, got veto: ${r.veto.reasons.join(',')}`);
  return r.context;
}

// ── 1. purpose gate が read の手前で効く ──────────────────────────────
async function t1PurposeGateBeforeReads(): Promise<void> {
  console.log('\n1. Purpose gate は read の手前');

  // essay_chat は basic_info のみ許可。
  const { result, rec } = await build({ purpose: 'essay_chat' });
  const ctx = ctxOf(result);
  const tables = rec.trace.map((t) => t.table);

  eq('T1 essay_chat の許可 source は basic_info のみ', [...ctx.allowedSources], ['basic_info']);
  eq('T1 executor へ到達した query は 1 本', tables, ['basic_info_logs']);
  check('T1 許可外 table への query が 0 本',
    !tables.includes('essay_workspaces') && !tables.includes('presentation_results'),
    tables.join(', '));
  eq('T1 diagnostics の query count が実測と一致', ctx.diagnostics.sourceQueryCount, tables.length);

  // 許可外 kind は「読んで捨てた」ではなく denied_by_purpose。
  const essay = ctx.sources.find((s) => s.kind === 'essay');
  eq('T1 許可外 kind の state は denied_by_purpose', essay?.state, 'denied_by_purpose');
  eq('T1 許可外 kind は block に寄与しない', essay?.contribution, 'none');
}

async function t1bUnknownPurpose(): Promise<void> {
  const rec = createRecordingExecutor(fullDb());
  const result = await buildCanonicalExamContext({
    request: new Request('https://example.test/unknown'),
    purpose: 'not_a_real_purpose',
    authorize: authorizeA,
    bridge: bridgeInput(),
    executor: rec.executor,
  });
  check('T1b 未知 purpose は veto', !result.ok);
  if (!result.ok) {
    eq('T1b veto 理由は unknown_purpose', [...result.veto.reasons], ['unknown_purpose']);
    eq('T1b 未知 purpose では purpose を返さない', result.purpose, null);
  }
  eq('T1b 未知 purpose では query が 0 本', rec.trace.length, 0);
}

async function t1cAllPurposesGated(): Promise<void> {
  // 17 purpose すべてが実 runtime で gate を通ること（registry があるだけでは不可）。
  let checked = 0;
  for (const purpose of EXAM_CONTEXT_PURPOSES) {
    const rec = createRecordingExecutor(fullDb());
    const result = await buildCanonicalExamContext({
      request: new Request(`https://example.test/${purpose}`),
      purpose,
      authorize: authorizeA,
      bridge: bridgeInput(),
      executor: rec.executor,
      projectionNow: '2026-01-01T00:00:00.000Z',
    });
    if (!result.ok) {
      check(`T1c ${purpose} が veto されない`, false, result.veto.reasons.join(','));
      continue;
    }
    const allowed = new Set(sourcesForPurpose(purpose));
    const readTables = new Set(rec.trace.map((t) => t.table));
    // 許可 kind の table 以外を読んでいないこと。
    const allowedTables = new Set(
      [...allowed].flatMap((k) => [...(EXAM_SOURCE_TABLES_FOR(k) ?? [])]),
    );
    const leaked = [...readTables].filter((t) => !allowedTables.has(t));
    if (leaked.length > 0) {
      check(`T1c ${purpose} が許可外 table を読まない`, false, leaked.join(','));
      continue;
    }
    checked += 1;
  }
  eq('T1c 17 purpose すべてが gate 済みで組み上がる', checked, EXAM_CONTEXT_PURPOSES.length);
}

function EXAM_SOURCE_TABLES_FOR(kind: ExamSourceKind): readonly string[] {
  // registry を直接引く（テスト側で table 名を再定義しない）。
  return EXAM_SOURCE_TABLES[kind];
}

// ── 2. single I/O boundary / request scope ────────────────────────────
async function t2SingleIoBoundary(): Promise<void> {
  console.log('\n2. Single I/O boundary と request scope');

  const request = new Request('https://example.test/reuse');
  const rec = createRecordingExecutor(fullDb());
  const common = {
    request,
    purpose: 'tutor' as const,
    authorize: authorizeA,
    bridge: bridgeInput(),
    executor: rec.executor,
    projectionNow: '2026-01-01T00:00:00.000Z',
  };

  const first = await buildCanonicalExamContext(common);
  const afterFirst = rec.trace.length;
  const second = await buildCanonicalExamContext(common);
  const afterSecond = rec.trace.length;

  check('T2 1 回目は成功', first.ok);
  check('T2 2 回目は成功', second.ok);
  eq('T2 同一 request の 2 回目は追加 query 0 本（snapshot 再利用）', afterSecond - afterFirst, 0);

  const c2 = ctxOf(second);
  eq('T2 2 回目は全 kind が snapshot 由来', c2.diagnostics.freshlyReadKinds.length, 0);
  check('T2 2 回目の servedFromSnapshot が非空', c2.diagnostics.servedFromSnapshotKinds.length > 0);

  // 別 request では共有しない。
  const rec2 = createRecordingExecutor(fullDb());
  await buildCanonicalExamContext({ ...common, request: new Request('https://example.test/other'), executor: rec2.executor });
  check('T2 別 request では snapshot を共有しない', rec2.trace.length > 0);

  // 同一 source を二重に読まない。
  const counts = new Map<string, number>();
  for (const t of rec.trace) counts.set(t.table, (counts.get(t.table) ?? 0) + 1);
  const dup = [...counts.entries()].filter(([, n]) => n > 1);
  eq('T2 1 request 内で同じ table を 2 度読まない', dup.map(([t]) => t), []);
}

// ── 3. status semantics ───────────────────────────────────────────────
async function t3Status(): Promise<void> {
  console.log('\n3. Status semantics');

  // 3-1. 0 行（読めたが空） vs read error vs purpose 不許可 を潰さない。
  const db = fullDb();
  db.tables.activity_logs = [];                                  // 読めて 0 行
  db.errors = { diagnosis_logs: { code: '42P01', message: 'x' } }; // read error
  const { result } = await build({ db, purpose: 'tutor' });
  const ctx = ctxOf(result);
  const stateOf = (k: ExamSourceKind): string | undefined => ctx.sources.find((s) => s.kind === k)?.state;

  eq('T3 0 行は empty', stateOf('activity'), 'empty');
  eq('T3 read error は unreadable', stateOf('diagnosis'), 'unreadable');
  eq('T3 purpose 不許可は denied_by_purpose', stateOf('self_pr'), 'denied_by_purpose');
  check('T3 empty と unreadable が別状態', stateOf('activity') !== stateOf('diagnosis'));
  check('T3 unreadable と denied_by_purpose が別状態', stateOf('diagnosis') !== stateOf('self_pr'));

  // readStatus は state と別軸で保持される。
  const diag = ctx.sources.find((s) => s.kind === 'diagnosis');
  eq('T3 readStatus は潰さず保持', diag?.readStatus, 'error');
  const act = ctx.sources.find((s) => s.kind === 'activity');
  eq('T3 empty の readStatus は ok（読めている）', act?.readStatus, 'ok');

  // 3-2. mixed success/failure は partial。
  eq('T3 一部失敗は partial', ctx.status, 'partial');

  // 3-3. 全 source が空 → degraded（ただし veto しない = fail-open）。
  const { result: emptyResult } = await build({ db: emptyDb(), purpose: 'tutor' });
  const emptyCtx = ctxOf(emptyResult);
  eq('T3 全 source 空は degraded', emptyCtx.status, 'degraded');
  check('T3 全 source 空でも veto しない（fail-open）', emptyCtx.veto.vetoed === false);

  // 3-4. state の語彙が閉じている。
  const unknown = ctx.sources.filter(
    (s) => !(EXAM_CONTEXT_SOURCE_STATES as readonly string[]).includes(s.state),
  );
  eq('T3 state はすべて宣言済みの語彙', unknown.map((s) => s.state), []);

  // 3-5. 10 kind 全部について必ず 1 件返る。
  eq('T3 sources は 10 kind すべてを持つ', ctx.sources.length, EXAM_SOURCE_KINDS.length);
}

// ── 4. provenance / mixed origin ──────────────────────────────────────
//
// ★ device 申告が無ければ class 1 は available にならない（E-S2）★
//   Source-Sync は「申告と server 可視状態が一致しない限り使わない」負の安全ゲートなので、
//   claim が無い kind は unclaimed → unverified となり server 値は採用されない。
//   これは Stage 4 の正しい挙動であり、Stage 5 で client header を配線して初めて
//   server 経路が実効化する。本 test は「一致する申告があれば server が採用される」
//   ことと「無ければ bridge が維持される（E-P7）」の両方を確認する。
async function t4Provenance(): Promise<void> {
  console.log('\n4. Provenance / mixed origin');

  const PURPOSE = 'statement_review' as const;

  // ── 4-1. 申告なし: すべて bridge のまま（E-P7: context を減らさない）──
  const noClaim = ctxOf((await build({ purpose: PURPOSE })).result);
  const basicNoClaim = noClaim.sources.find((s) => s.kind === 'basic_info');
  eq('T4 申告が無い class 1 は unverified', basicNoClaim?.state, 'unverified');
  eq('T4 申告が無ければ origin は bridge', basicNoClaim?.origin, 'bridge');
  eq('T4 unverified でも sync verdict は保持される', basicNoClaim?.syncStatus, 'unclaimed');
  check('T4 unverified でも server 側 fingerprint は観測できる',
    typeof basicNoClaim?.fingerprint === 'string');

  const bridgeBlock = noClaim.blocks.find((b) => b.sourceKind === 'basic_info');
  check('T4 server を採用しなくても bridge の値で block が出る',
    (bridgeBlock?.content ?? '').includes('ブリッジ大学'),
    (bridgeBlock?.content ?? '').slice(0, 80));
  eq('T4 bridge 由来 block の origin は bridge', bridgeBlock?.origin, 'bridge');

  // ── 4-2. 一致する申告あり: server が採用される ────────────────────
  //   client が同じ正規化 view から算出した fingerprint を提示した状況を再現する。
  const claims = {
    basic_info: { presented: true, fingerprint: basicNoClaim?.fingerprint ?? null },
  };
  const withClaim = ctxOf((await build({ purpose: PURPOSE, deviceClaims: claims })).result);
  const basic = withClaim.sources.find((s) => s.kind === 'basic_info');

  eq('T4 一致する申告があれば verified', basic?.syncStatus, 'verified');
  eq('T4 verified なら state は available', basic?.state, 'available');
  eq('T4 verified なら origin は server', basic?.origin, 'server');
  eq('T4 basic_info の bridgeFields に name が明示される（E-P8）',
    [...(basic?.bridgeFields ?? [])], ['name']);

  const serverBlock = withClaim.blocks.find((b) => b.sourceKind === 'basic_info');
  eq('T4 server 採用時の block origin は server', serverBlock?.origin, 'server');
  check('T4 server 採用時は server の値が block に出る',
    !(serverBlock?.content ?? '').includes('ブリッジ大学'),
    (serverBlock?.content ?? '').slice(0, 80));
  check('T4 氏名は bridge から維持される（server に無い）',
    (serverBlock?.content ?? '').includes('受験 太郎'),
    (serverBlock?.content ?? '').slice(0, 80));

  // ── 4-3. mixed origin: 1 context に複数 origin が同居する ──────────
  const origins = new Set(withClaim.sources.map((s) => s.origin));
  check('T4 context 全体が単一 origin ではない', origins.size >= 2, [...origins].join(', '));
  const blockOrigins = new Set(withClaim.blocks.map((b) => b.origin));
  check('T4 block level でも origin が分かれる', blockOrigins.size >= 2, [...blockOrigins].join(', '));

  // 申告しなかった kind は補完されない（E-S26: 暗黙的 Mixed-Origin を作らない）。
  const activity = withClaim.sources.find((s) => s.kind === 'activity');
  eq('T4 申告の無い kind を server へ補完しない', activity?.origin, 'bridge');

  // ── 4-4. provenance の完全性 ──────────────────────────────────────
  const missing = withClaim.sources.filter((s) => s.tables.length === 0 || !s.authority);
  eq('T4 全 source が authority と table を持つ', missing.map((s) => s.kind), []);
  const badAuthority = withClaim.sources.filter(
    (s) => s.authority !== 'device_canonical_mirrored' && s.authority !== 'server_authoritative');
  eq('T4 authority は 2 値のいずれか', badAuthority.map((s) => s.kind), []);

  // ── 4-5. block id → source kind を固定しない ──────────────────────
  //   previous_output_summary は purpose によって由来 kind が違う。
  const ivw = ctxOf((await build({ purpose: 'interview_feedback' })).result);
  check('T4 statement_review は statement_review kind を許可',
    new Set(withClaim.allowedSources).has('statement_review'));
  check('T4 interview_feedback は interview_record kind も許可',
    new Set(ivw.allowedSources).has('interview_record'));
  check('T4 同じ block id が purpose 間で別 kind の gate 下にある',
    new Set(withClaim.allowedSources).has('statement_review') &&
      new Set(ivw.allowedSources).has('interview_record'));
}

// ── 5. revision determinism ───────────────────────────────────────────
async function t5Revision(): Promise<void> {
  console.log('\n5. Revision determinism');

  const a = ctxOf((await build({ purpose: 'tutor' })).result);
  const b = ctxOf((await build({ purpose: 'tutor' })).result);
  eq('T5 同一入力 → 同一 revision', a.revision, b.revision);

  // 実行時刻・Request identity で変わらない。
  const later = ctxOf(
    (await build({ purpose: 'tutor', request: new Request('https://example.test/another') })).result,
  );
  eq('T5 Request identity が変わっても revision は同じ', a.revision, later.revision);

  // purpose が変わっても入力状態が同じなら revision は変わらない（fingerprint とは別役割）。
  const tutorSources = new Set(a.allowedSources);
  check('T5 tutor は複数 kind を読む', tutorSources.size > 1);

  // sources の宣言順に依存しない。
  const shuffled = [...a.sources].reverse();
  eq('T5 sources の順序を変えても revision は同じ',
    computeContextRevision(shuffled), computeContextRevision(a.sources));

  // canonical data が変われば revision も変わる。
  const db = fullDb();
  db.tables.basic_info_logs = [
    { ...(db.tables.basic_info_logs[0] as Record<string, unknown>),
      payload: { grade: '高校3年', track: '理系', preferences: [], examTypes: [] } },
  ];
  const changed = ctxOf((await build({ db, purpose: 'tutor' })).result);
  check('T5 source の内容が変われば revision も変わる', changed.revision !== a.revision);

  // 空 DB とは当然変わる。
  const empty = ctxOf((await build({ db: emptyDb(), purpose: 'tutor' })).result);
  check('T5 全 source 空とは別 revision', empty.revision !== a.revision);
  check('T5 revision は efp1 形式', a.revision.startsWith('efp1:'), a.revision.slice(0, 12));
}

// ── 6. fingerprint determinism / privacy ──────────────────────────────
async function t6Fingerprint(): Promise<void> {
  console.log('\n6. Fingerprint determinism');

  const a = ctxOf((await build({ purpose: 'tutor' })).result);
  const b = ctxOf((await build({ purpose: 'tutor' })).result);
  eq('T6 同一入力 → 同一 fingerprint', a.fingerprint, b.fingerprint);
  check('T6 fingerprint は revision と別値', a.fingerprint !== a.revision);

  // purpose が違えば fingerprint は変わる（出力が違うため）。
  const other = ctxOf((await build({ purpose: 'matching' })).result);
  check('T6 purpose が変われば fingerprint も変わる', other.fingerprint !== a.fingerprint);

  // allowedSources の宣言順に依存しない。
  const f1 = computeContextFingerprint({
    purpose: a.purpose, revision: a.revision,
    allowedSources: [...a.allowedSources], blocks: a.blocks, sources: a.sources,
  });
  const f2 = computeContextFingerprint({
    purpose: a.purpose, revision: a.revision,
    allowedSources: [...a.allowedSources].reverse(), blocks: a.blocks, sources: a.sources,
  });
  eq('T6 allowedSources の順序に依存しない', f1.fingerprint, f2.fingerprint);

  // sources の順序に依存しない。
  const f3 = computeContextFingerprint({
    purpose: a.purpose, revision: a.revision,
    allowedSources: a.allowedSources, blocks: a.blocks, sources: [...a.sources].reverse(),
  });
  eq('T6 sources の順序に依存しない', f1.fingerprint, f3.fingerprint);

  // block の順序は意味を持つので依存する（prompt が変わるため）。
  if (a.blocks.length >= 2) {
    const f4 = computeContextFingerprint({
      purpose: a.purpose, revision: a.revision,
      allowedSources: a.allowedSources, blocks: [...a.blocks].reverse(), sources: a.sources,
    });
    check('T6 block の順序が変われば fingerprint も変わる', f4.fingerprint !== f1.fingerprint);
  }

  check('T6 fingerprint は efp1 形式', a.fingerprint.startsWith('efp1:'), a.fingerprint.slice(0, 12));
  check('T6 hash 入力サイズが記録される', a.diagnostics.fingerprintInputBytes > 0);
  check('T6 hash 入力が無制限に膨らんでいない（< 256KB）',
    a.diagnostics.fingerprintInputBytes < 262_144, String(a.diagnostics.fingerprintInputBytes));

  // subject fingerprint は userId を復元できない。
  check('T6 subject fingerprint に userId が現れない', !a.subject.subjectFingerprint.includes(USER_A));
}

// ── 7. veto semantics ─────────────────────────────────────────────────
async function t7Veto(): Promise<void> {
  console.log('\n7. Veto semantics');

  const ok = ctxOf((await build({ purpose: 'tutor' })).result);
  eq('T7 正常な context は veto されない', ok.veto.vetoed, false);

  // 未認証は veto。
  const rec = createRecordingExecutor(fullDb());
  const unauth = await buildCanonicalExamContext({
    request: new Request('https://example.test/unauth'),
    purpose: 'tutor',
    authorize: async () => ({ ok: false, reason: 'unauthenticated' }),
    bridge: bridgeInput(),
    executor: rec.executor,
  });
  check('T7 未認証は veto', !unauth.ok);
  if (!unauth.ok) eq('T7 veto 理由は unauthenticated', [...unauth.veto.reasons], ['unauthenticated']);
  eq('T7 未認証では query が 0 本', rec.trace.length, 0);

  // 未認可も veto。
  const rec2 = createRecordingExecutor(fullDb());
  const unauthz = await buildCanonicalExamContext({
    request: new Request('https://example.test/unauthz'),
    purpose: 'tutor',
    authorize: async () => ({ ok: false, reason: 'unauthorized' }),
    bridge: bridgeInput(),
    executor: rec2.executor,
  });
  check('T7 未認可は veto', !unauthz.ok);
  if (!unauthz.ok) eq('T7 veto 理由は unauthorized', [...unauthz.veto.reasons], ['unauthorized']);

  // ★ fail-open: 部分的な失敗では veto しない。
  const db = fullDb();
  db.errors = {
    self_analysis_logs: { code: '42P01', message: 'x' },
    activity_logs: { code: '42P01', message: 'x' },
  };
  const partial = await build({ db, purpose: 'tutor' });
  check('T7 一部 source の read 失敗では veto しない', partial.result.ok);
  if (partial.result.ok) {
    eq('T7 一部失敗は partial status', partial.result.context.status, 'partial');
  }

  // ★ 空でも veto しない。
  const empty = await build({ db: emptyDb(), purpose: 'tutor' });
  check('T7 全 source 空でも veto しない', empty.result.ok);

  // executor も client も無ければ Layer 1 へ到達できない。
  const noIo = await buildCanonicalExamContext({
    request: new Request('https://example.test/noio'),
    purpose: 'tutor',
    authorize: authorizeA,
    bridge: bridgeInput(),
  });
  check('T7 I/O 手段が無い場合は veto', !noIo.ok);
}

// ── 8. essay boundary ─────────────────────────────────────────────────
async function t8EssayBoundary(): Promise<void> {
  console.log('\n8. Essay boundary');

  // essay を許可する purpose で組み、本文が 1 文字も混入しないことを確認する。
  const { result } = await build({ purpose: 'interview_ai' });
  const ctx = ctxOf(result);
  check('T8 interview_ai は essay を許可する', new Set(ctx.allowedSources).has('essay'));

  const serialized = JSON.stringify(ctx);
  const forbidden = ['essayBodySnapshot', '小論文本文', '添削時点の複製', '最新添削時点の複製'];
  for (const needle of forbidden) {
    check(`T8 canonical context に "${needle}" が現れない`, !serialized.includes(needle));
  }

  const blockText = ctx.blocks.map((b) => b.content).join('\n');
  for (const needle of forbidden) {
    check(`T8 blocks に "${needle}" が現れない`, !blockText.includes(needle));
  }

  // revision / fingerprint の材料にも出ない。
  const revisionMaterial = JSON.stringify(ctx.sources);
  for (const needle of forbidden) {
    check(`T8 revision 材料（sources）に "${needle}" が現れない`, !revisionMaterial.includes(needle));
  }
  const diagnostics = JSON.stringify(ctx.diagnostics) + JSON.stringify(ctx.omissions);
  for (const needle of forbidden) {
    check(`T8 diagnostics に "${needle}" が現れない`, !diagnostics.includes(needle));
  }

  // sources は metadata のみ（値を持たない）。
  const sourceKeys = new Set(ctx.sources.flatMap((s) => Object.keys(s)));
  const valueBearing = [...sourceKeys].filter((k) =>
    ['payload', 'rows', 'value', 'row', 'workspace', 'reviews', 'content'].includes(k));
  eq('T8 sources は生値を持たない', valueBearing, []);
}

// ── 9. immutability ───────────────────────────────────────────────────
async function t9Immutable(): Promise<void> {
  console.log('\n9. Immutability');
  const ctx = ctxOf((await build({ purpose: 'tutor' })).result);

  check('T9 context は frozen', Object.isFrozen(ctx));
  check('T9 sources は frozen', Object.isFrozen(ctx.sources));
  check('T9 blocks は frozen', Object.isFrozen(ctx.blocks));
  check('T9 diagnostics は frozen', Object.isFrozen(ctx.diagnostics));
  check('T9 各 source provenance が frozen', ctx.sources.every((s) => Object.isFrozen(s)));

  let mutated = false;
  try {
    (ctx.sources as unknown as unknown[]).push({});
    mutated = true;
  } catch {
    mutated = false;
  }
  check('T9 sources へ push できない', !mutated);
  eq('T9 version が固定されている', ctx.version, EXAM_CONTEXT_VERSION);
}

// ── 10. static: mutation / service_role / AI ──────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(full)) out.push(full);
  }
  return out;
}

function t10Static(): void {
  console.log('\n10. Static boundaries');
  const files = walk(join(ROOT, 'lib/examSpine/context')).map((f) => relative(ROOT, f));
  check('T10 context layer の file が存在する', files.length > 0);

  const stripComments = (src: string): string =>
    src.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    }).join('\n');

  const offenders = { mutation: [] as string[], serviceRole: [] as string[], ai: [] as string[], from: [] as string[] };
  for (const f of files) {
    const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    if (/\.(insert|upsert|rpc)\s*\(/.test(code)) offenders.mutation.push(f);
    if (/service_role|SERVICE_ROLE|serviceRoleClient/.test(code)) offenders.serviceRole.push(f);
    if (/@anthropic-ai|openai|generateText|messages\.create/.test(code)) offenders.ai.push(f);
    const noBuiltin = code.replace(
      /\b(?:[A-Za-z0-9_$]*Array|Object|String|Map|Set|Promise)\.from(?:Entries)?\s*\(/g, 'B(');
    if (/\.from\(/.test(noBuiltin)) offenders.from.push(f);
  }
  eq('T10 context layer に insert/upsert/rpc が無い', offenders.mutation, []);
  eq('T10 context layer に service_role 参照が無い', offenders.serviceRole, []);
  eq('T10 context layer に AI SDK 参照が無い', offenders.ai, []);
  eq('T10 context layer が直接 PostgREST を叩かない', offenders.from, []);

  // production runtime から context layer を import していない（Stage 5 まで接続しない）。
  const appLib = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib'))]
    .map((f) => relative(ROOT, f))
    .filter((f) => !f.startsWith('lib/examSpine/'));
  const importers = appLib.filter((f) =>
    /examSpine\/context/.test(readFileSync(join(ROOT, f), 'utf8')));
  // ★ Stage 5.0 で shadow assembly が pilot route に入った（E-S33）。
  //   assembler を import してよいのは pilot の route だけ。
  //   client（page.tsx）は claim 層しか触らない。
  const pilotRoute = 'app/api/tutor/route.ts';
  eq('T10 context layer を import する production file は pilot route だけ',
    importers.filter((f) => f !== pilotRoute), []);
  // shadow は default deny gate の背後にあること。
  const routeSrc = readFileSync(join(ROOT, pilotRoute), 'utf8');
  check('T10 shadow assembly は gate 済み',
    !routeSrc.includes('buildCanonicalExamContext') || routeSrc.includes('isExamSpineShadowEnabled'));
}

// ── main ──────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('[exam-spine-stage4] Canonical Exam Context contract check');
  console.log(`[exam-spine-stage4] version=${EXAM_CONTEXT_VERSION} purposes=${EXAM_CONTEXT_PURPOSES.length} kinds=${EXAM_SOURCE_KINDS.length}`);

  await t1PurposeGateBeforeReads();
  await t1bUnknownPurpose();
  await t1cAllPurposesGated();
  await t2SingleIoBoundary();
  await t3Status();
  await t4Provenance();
  await t5Revision();
  await t6Fingerprint();
  await t7Veto();
  await t8EssayBoundary();
  await t9Immutable();
  t10Static();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage4] FAIL: 外部通信が ${fetchCallCount} 回発生しました`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[exam-spine-stage4] network calls = ${fetchCallCount}（実 Supabase / AI 呼び出しゼロ）`);
  console.log(`[exam-spine-stage4] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage4] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-stage4] PASS');
}

void main();
