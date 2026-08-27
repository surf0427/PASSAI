// Exam Spine — Stage 5.4 self_analysis device claim wiring の check（G7）。
//
// self_analysis は基本情報 / 診断 / 活動と違い **履歴 list（cap 5）** である。
// したがって snapshot kind には無かった 2 つの罠を明示的に検証する:
//   1. cap parity   … server は上位 5 件、device は全件 → 永久 mismatch
//   2. ordering     … localStorage の挿入順 / DB 返却順に依存してはいけない
//
// 実 Supabase / 実 AI を使わない（fake executor のみ）。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let fetchCallCount = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage5.4] 外部通信: ${String(args[0])}`);
}) as typeof realFetch;

import type { SelfAnalysisLog } from '@/types/selfAnalysisLog';
import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import {
  buildTutorDeviceClaimEntries,
  deviceActivityToken,
  deviceBasicInfoToken,
  deviceSelfAnalysisToken,
} from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import {
  deviceSelfAnalysisView,
  selectDeviceSyncWindow,
} from '@/lib/examSpine/sync/adapters/deviceViews';
import { examSyncObservation } from '@/lib/examSpine/sync/adapters/views';
import { serializeDeviceClaim } from '@/lib/examSpine/sync/claim/serialize';
import { parseDeviceClaimValue, toDeviceClaims } from '@/lib/examSpine/sync/claim/parse';
import { EXAM_DEVICE_CLAIM_MAX_BYTES } from '@/lib/examSpine/sync/claim/types';
import { EXAM_READ_CAPS } from '@/lib/examSpine/read/types';
import { buildCanonicalExamContext } from '@/lib/examSpine/context/assemble.server';
import { compareTutorShadow } from '@/lib/examSpine/context/shadow/compareTutor';
import { EXAM_CONTEXT_BLOCK_REGISTRY } from '@/lib/examSpine/blocks/registry';
import { EXAM_PURPOSE_PLANS } from '@/lib/examSpine/orchestrator/plan';
import { sourcesForPurpose } from '@/lib/examSpine/purpose';
import * as Q from '@/lib/examSpine/read/queries';
import type { ExamRequestAuthorization } from '@/lib/examSpine/read/requestSnapshot.server';
import { createRecordingExecutor, USER_A, type FakeDb } from './fixtures/examSpineStage3';

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) passed += 1;
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
function eq(label: string, a: unknown, e: unknown): void {
  check(label, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
}
function stripComments(src: string): string {
  return src.split('\n').filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  }).join('\n');
}

// ── fixtures ──────────────────────────────────────────────────────────
const SECRET = 'SELF_ANALYSIS_SECRET_EPISODE_7c1a';

function log(n: number): SelfAnalysisLog {
  return {
    id: `log-${n}`,
    createdAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
    summaryInputHash: `h${n}`,
    analysis: {
      summary: `要約 ${n}`,
      strengths: [`強み ${n}`],
      weaknesses: [`課題 ${n}`],
      futureConnections: [`将来 ${n}`],
      signatureEpisodes: [{ title: SECRET }],
    },
    displayedQuestions: [`Q${n}`],
    answers: [SECRET],
    deepAnswers: [`DA${n}`],
    freeMemo: SECRET,
    summary: { summary: `sum ${n}` },
  } as unknown as SelfAnalysisLog;
}

/** device は挿入順（古い→新しい）。server は created_at DESC で上位 cap 件。 */
const DEVICE_LOGS: SelfAnalysisLog[] = [1, 2, 3, 4, 5, 6, 7].map(log);
const CAP = EXAM_READ_CAPS.self_analysis;

/**
 * ★ server 側 fixture は cap 件ちょうど ★
 *   Stage 3 は `cap + 1` 件取得して `cap` を超えたら `truncated` にする。
 *   Stage 4 は `truncated` を `unreadable` に落とす（E-S8 / E-S30）ため、
 *   **行数が cap を超える user は verified になり得ない**。
 *   これは claim wiring とは独立した migration blocker であり、T11 で明示的に固定する。
 *   ここでは claim 経路そのものを検証するため cap 件ちょうどの server を使う。
 */
const SERVER_LOGS: SelfAnalysisLog[] = DEVICE_LOGS.slice(-CAP);

function serverRow(l: SelfAnalysisLog): Record<string, unknown> {
  return {
    id: l.id, user_id: USER_A, created_at: l.createdAt,
    analysis: l.analysis, summary: l.summary,
    displayed_questions: l.displayedQuestions, answers: l.answers,
    deep_answers: l.deepAnswers, free_memo: l.freeMemo,
  };
}
/** server の返却順を意図的に「古い順」にして、順序非依存を検証する。 */
function dbWith(logs: readonly SelfAnalysisLog[]): FakeDb {
  return { tables: { self_analysis_logs: logs.map(serverRow) } } as FakeDb;
}

const DEVICE_BASIC = { name: '受験 太郎', grade: '高校3年', track: '文系', examTypes: [],
  preferences: [{ university: '実在大学', faculty: '', department: '' }] } as BasicInfo;
const DEVICE_ACTIVITY = { clubActivities: [{ clubName: '吹奏楽部' }] } as unknown as ActivityData;

const authorizeA = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A });

async function assemble(opts: {
  logs?: readonly SelfAnalysisLog[];
  claim?: string | null;
  purpose?: 'tutor' | 'essay_chat';
  errors?: Record<string, { code: string; message: string }>;
  request?: Request;
} = {}) {
  const database = dbWith(opts.logs ?? SERVER_LOGS);
  if (opts.errors) (database as FakeDb).errors = opts.errors;
  const rec = createRecordingExecutor(database);
  const r = await buildCanonicalExamContext({
    request: opts.request ?? new Request('https://example.test/s54/' + Math.abs(JSON.stringify(opts).length)),
    purpose: opts.purpose ?? 'tutor',
    authorize: authorizeA,
    bridge: {},
    deviceClaims: opts.claim === undefined ? undefined
      : ({ self_analysis: { presented: true, fingerprint: opts.claim } } as never),
    executor: rec.executor,
    projectionNow: '2026-01-01T00:00:00.000Z',
  });
  if (!r.ok) throw new Error('veto: ' + r.veto.reasons.join(','));
  return { ctx: r.context, rec, resolved: r.shadowResolvedInput,
    source: r.context.sources.find((s) => s.kind === 'self_analysis') };
}

// ── 1. authority ──────────────────────────────────────────────────────
function t1Authority(): void {
  console.log('\n1. Self analysis authority');
  const q = Q.selfAnalysisQuery('00000000-0000-4000-8000-000000000000');
  eq('T1 table は self_analysis_logs', q.table, 'self_analysis_logs');
  eq('T1 mode は many（履歴 list）', q.mode, 'many');
  eq('T1 ordering は created_at DESC + id DESC',
    q.order.map((o) => `${o.column}:${o.ascending ? 'asc' : 'desc'}`),
    ['created_at:desc', 'id:desc']);
  eq('T1 limit は cap + 1', q.limit, CAP + 1);
  check('T1 owner filter を持つ', q.filters.some((f) => f.op === 'eq' && f.column === 'user_id'));
  check('T1 tutor は self_analysis を許可', sourcesForPurpose('tutor').includes('self_analysis'));
  check('T1 essay_chat は許可しない', !sourcesForPurpose('essay_chat').includes('self_analysis'));
}

// ── 2. single authority ───────────────────────────────────────────────
function t2SingleAuthority(): void {
  console.log('\n2. Single projection authority');
  const view = deviceSelfAnalysisView(DEVICE_LOGS);
  check('T2 canonical device view が成功', view.ok);
  if (view.ok) {
    const obs = examSyncObservation({ kind: 'self_analysis', source: 'device_canonical', view: view.view });
    eq('T2 transport は canonical projection と同一 token', deviceSelfAnalysisToken(DEVICE_LOGS), obs.fingerprint);
  }
  const claimSrc = stripComments(readFileSync(join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8'));
  check('T2 claim adapter が mapSelfAnalysisRow を自前で呼ばない', !claimSrc.includes('mapSelfAnalysisRow'));
  check('T2 claim adapter が selfAnalysisItemView を自前で呼ばない', !claimSrc.includes('selfAnalysisItemView'));
  check('T2 claim adapter は buildDeviceClaim へ委譲', claimSrc.includes('buildDeviceClaim'));
}

// ── 3. cap / ordering parity ──────────────────────────────────────────
function t3CapParity(): void {
  console.log('\n3. Cap / ordering parity');
  eq('T3 cap は 5', CAP, 5);

  // window 選択は「新しい順に cap 件」
  const win = selectDeviceSyncWindow(DEVICE_LOGS, CAP, (l) => l.createdAt);
  eq('T3 window は cap 件', win.length, CAP);
  eq('T3 window は新しい順の上位 cap 件',
    win.map((l) => l.id), ['log-7', 'log-6', 'log-5', 'log-4', 'log-3']);

  // cap 以下ならそのまま
  const few = DEVICE_LOGS.slice(0, 3);
  eq('T3 cap 以下なら全件', selectDeviceSyncWindow(few, CAP, (l) => l.createdAt).length, 3);

  // ★ device の挿入順を変えても token は変わらない
  const shuffled = [...DEVICE_LOGS].reverse();
  eq('T3 device の並び順で token は変わらない',
    deviceSelfAnalysisToken(shuffled), deviceSelfAnalysisToken(DEVICE_LOGS));

  // ★ cap 超過分は token に影響しない（server が読まないため）
  const withOlder = [log(0), ...DEVICE_LOGS];
  eq('T3 cap 外の古い log を足しても token は変わらない',
    deviceSelfAnalysisToken(withOlder), deviceSelfAnalysisToken(DEVICE_LOGS));

  // ★ cap 内の log を変えれば token は変わる
  const changed = [...DEVICE_LOGS.slice(0, 6), { ...log(7), freeMemo: 'changed' } as SelfAnalysisLog];
  check('T3 cap 内の変更は token を変える',
    deviceSelfAnalysisToken(changed) !== deviceSelfAnalysisToken(DEVICE_LOGS));
}

// ── 4. claim composition ──────────────────────────────────────────────
function t4Claim(): void {
  console.log('\n4. Claim composition');
  const before = serializeDeviceClaim(
    buildTutorDeviceClaimEntries(DEVICE_BASIC, null, DEVICE_ACTIVITY, null));
  const after = serializeDeviceClaim(
    buildTutorDeviceClaimEntries(DEVICE_BASIC, null, DEVICE_ACTIVITY, DEVICE_LOGS));
  const bytes = (v: string | null) => new TextEncoder().encode(v ?? '').length;
  console.log(`  info  header bytes: before = ${bytes(before)} / after = ${bytes(after)}`);

  const parsed = JSON.parse(after ?? '{}') as { c: { kind: string; token: string }[] };
  eq('T4 entry 順が固定', parsed.c.map((e) => e.kind), ['basic_info', 'activity', 'self_analysis']);
  check('T4 上限内', bytes(after) <= EXAM_DEVICE_CLAIM_MAX_BYTES, String(bytes(after)));

  // 既存 token が壊れていない
  const parsedBefore = JSON.parse(before ?? '{}') as { c: { kind: string; token: string }[] };
  eq('T4 basic_info token 不変', parsed.c[0].token, parsedBefore.c[0].token);
  eq('T4 activity token 不変', parsed.c[1].token, parsedBefore.c[1].token);

  // 大量データでも header は固定長
  const many = Array.from({ length: 200 }, (_, i) => log(i + 1));
  const big = serializeDeviceClaim(
    buildTutorDeviceClaimEntries(DEVICE_BASIC, null, DEVICE_ACTIVITY, many));
  eq('T4 log 200 件でも header サイズは同じ', bytes(big), bytes(after));

  // raw content 非混入
  for (const needle of [SECRET, '要約 7', '強み 7', '課題 7', USER_A, 'self_analysis_logs']) {
    check(`T4 header に "${needle}" が出ない`, !(after ?? '').includes(needle));
  }

  // parser は generic のまま
  const p = parseDeviceClaimValue(after);
  eq('T4 parser が self_analysis を通す',
    Object.keys(p.claims).sort(), ['activity', 'basic_info', 'self_analysis']);
  const denied = toDeviceClaims(p, {
    authenticatedUserId: USER_A, allowedSources: sourcesForPurpose('essay_chat') });
  check('T4 許可しない purpose では落とす', !('self_analysis' in denied));

  // spoof
  const spoof = parseDeviceClaimValue(JSON.stringify({ v: 'edc1',
    c: [{ kind: 'self_analysis', token: 'efp1:' + 'a'.repeat(64), verified: true, table: 'profiles', userId: 'x' }] }));
  const flat = JSON.stringify(toDeviceClaims(spoof, {
    authenticatedUserId: USER_A, allowedSources: sourcesForPurpose('tutor') }));
  check('T4 verified / table / userId は無視',
    !flat.includes('"verified"') && !flat.includes('profiles') && !flat.includes('"x"'));
}

// ── 5. token independence ─────────────────────────────────────────────
function t5Independence(): void {
  console.log('\n5. Token independence');
  const sa = deviceSelfAnalysisToken(DEVICE_LOGS);
  const bi = deviceBasicInfoToken(DEVICE_BASIC);
  const ac = deviceActivityToken(DEVICE_ACTIVITY);

  const otherLogs = [...DEVICE_LOGS.slice(0, 6), { ...log(7), freeMemo: 'x' } as SelfAnalysisLog];
  check('T5 self_analysis 変更 → self_analysis token 変化', deviceSelfAnalysisToken(otherLogs) !== sa);
  eq('T5 self_analysis 変更 → basic_info token 不変', deviceBasicInfoToken(DEVICE_BASIC), bi);
  eq('T5 self_analysis 変更 → activity token 不変', deviceActivityToken(DEVICE_ACTIVITY), ac);

  const otherBasic = { ...DEVICE_BASIC, grade: '高校2年' } as BasicInfo;
  eq('T5 basic_info 変更 → self_analysis token 不変', deviceSelfAnalysisToken(DEVICE_LOGS), sa);
  check('T5 basic_info 変更 → basic_info token 変化', deviceBasicInfoToken(otherBasic) !== bi);
}

// ── 6. verification matrix ────────────────────────────────────────────
async function t6Matrix(): Promise<void> {
  console.log('\n6. Verification matrix');
  const token = deviceSelfAnalysisToken(DEVICE_LOGS);

  const matching = await assemble({ claim: token });
  eq('T6 matching → verified', matching.source?.syncStatus, 'verified');
  eq('T6 matching → available', matching.source?.state, 'available');
  eq('T6 matching → origin server', matching.source?.origin, 'server');
  check('T6 matching → wallHittingResult が解決される',
    matching.resolved.wallHittingResult !== undefined && matching.resolved.wallHittingResult !== null);

  const absent = await assemble();
  eq('T6 absent → unclaimed', absent.source?.syncStatus, 'unclaimed');
  eq('T6 absent → unverified', absent.source?.state, 'unverified');
  eq('T6 absent → origin bridge', absent.source?.origin, 'bridge');

  const stale = await assemble({ claim: deviceSelfAnalysisToken(DEVICE_LOGS.slice(0, 5)) });
  check('T6 stale → verified にならない', stale.source?.syncStatus !== 'verified', String(stale.source?.syncStatus));

  const mismatch = await assemble({ claim: 'efp1:' + 'b'.repeat(64) });
  check('T6 mismatch → verified にならない', mismatch.source?.syncStatus !== 'verified');

  const empty = await assemble({ logs: [] });
  eq('T6 server 0 行 → empty', empty.source?.state, 'empty');

  const unreadable = await assemble({ errors: { self_analysis_logs: { code: '42P01', message: 'x' } } });
  eq('T6 read error → unreadable', unreadable.source?.state, 'unreadable');

  const denied = await assemble({ purpose: 'essay_chat' });
  eq('T6 purpose 不許可 → denied_by_purpose', denied.source?.state, 'denied_by_purpose');
  eq('T6 purpose 不許可 → query 0 本',
    denied.rec.trace.filter((t) => t.table === 'self_analysis_logs').length, 0);

  // ★ cap 超過でも matching する（parity の実証）
  eq('T6 device 7 件 / server cap 5 件でも verified（window parity）',
    matching.source?.syncStatus, 'verified');
}

// ── 7. privacy ────────────────────────────────────────────────────────
async function t7Privacy(): Promise<void> {
  console.log('\n7. Privacy');
  const { ctx } = await assemble({ claim: deviceSelfAnalysisToken(DEVICE_LOGS) });
  const serialized = JSON.stringify(ctx);
  for (const needle of [SECRET, '要約 7', '強み 7', USER_A]) {
    check(`T7 canonical context に "${needle}" が出ない`, !serialized.includes(needle));
  }
  const token = deviceSelfAnalysisToken(DEVICE_LOGS);
  check('T7 token に本文が出ない', !String(token).includes(SECRET));
}

// ── 8. shadow / false-match guard ─────────────────────────────────────
async function t8Shadow(): Promise<void> {
  console.log('\n8. Shadow / false-match guard');
  const token = deviceSelfAnalysisToken(DEVICE_LOGS);
  const newest = log(7);

  const legacyFromSupabase = {
    summary: (newest.analysis as unknown as Record<string, unknown>).summary,
    strengths: (newest.analysis as unknown as Record<string, unknown>).strengths,
    weaknesses: (newest.analysis as unknown as Record<string, unknown>).weaknesses,
    futureConnections: (newest.analysis as unknown as Record<string, unknown>).futureConnections,
  };

  const run = async (claim: string | null | undefined, legacy: unknown) => {
    const a = await assemble(claim === undefined ? {} : { claim });
    const before = a.rec.trace.length;
    const cmp = compareTutorShadow({
      legacy: { selfAnalysis: legacy }, canonicalInput: a.resolved, context: a.ctx });
    return { cmp, extra: a.rec.trace.length - before,
      diffs: cmp.entries.filter((e) => e.kind === 'self_analysis'),
      readiness: cmp.readiness.find((r) => r.kind === 'self_analysis') };
  };

  const m = await run(token, legacyFromSupabase);
  const matched = m.diffs.filter((d) => d.diff === 'MATCH');
  check('T8 self_analysis の比較が 4 件ある', m.diffs.length === 4, String(m.diffs.length));
  eq('T8 全 field が MATCH', matched.length, 4);
  eq('T8 compare は追加 read を出さない', m.extra, 0);

  // ★ 空同士だけの MATCH ではないことを示す
  const meaningful = m.diffs.filter((d) => d.legacyFingerprint !== null || d.canonicalFingerprint !== null);
  check('T8 実データのある比較が 1 件以上', meaningful.length >= 1, String(meaningful.length));
  eq('T8 meaningful MATCH なので READY', m.readiness?.readiness, 'READY');

  // ★ false-empty guard: 双方空なら READY にしない
  const emptyBoth = await assemble({ logs: [], claim: null });
  const emptyCmp = compareTutorShadow({
    legacy: { selfAnalysis: null }, canonicalInput: emptyBoth.resolved, context: emptyBoth.ctx });
  const emptyReadiness = emptyCmp.readiness.find((r) => r.kind === 'self_analysis');
  const emptyDiffs = emptyCmp.entries.filter((e) => e.kind === 'self_analysis');
  eq('T8 空同士でも diff は MATCH と数える', emptyDiffs.every((d) => d.diff === 'MATCH'), true);
  eq('T8 だが READY にはしない（false-empty guard）', emptyReadiness?.readiness, 'DEFERRED');

  // STATUS_MISMATCH
  const s = await run(undefined, legacyFromSupabase);
  check('T8 claim 無しは STATUS_MISMATCH', s.diffs.every((d) => d.diff === 'STATUS_MISMATCH'));
  eq('T8 claim 無しは DEFERRED', s.readiness?.readiness, 'DEFERRED');

  // VALUE_MISMATCH
  const v = await run(token, { ...legacyFromSupabase, summary: '違う要約' });
  check('T8 値違いは VALUE_MISMATCH',
    v.diffs.some((d) => d.field === 'self_analysis.summary' && d.diff === 'VALUE_MISMATCH'));
  eq('T8 値違いは NOT_READY', v.readiness?.readiness, 'NOT_READY');

  check('T8 diff に本文が出ない', !JSON.stringify(m.cmp).includes(SECRET));

  // ★ mismatch path こそ値が漏れやすい（S5-P5 の負例 N5 で発見した失敗形）★
  //   MATCH 経路しか検査していないと、VALUE_MISMATCH の `reason` に legacy /
  //   canonical の実値を載せる変更が guard をすり抜ける。shadow entry が持ってよいのは
  //   field id / diff kind / origin / status / 固定 reason enum だけ（E-S13 / E-S43）。
  const vJson = JSON.stringify(v.cmp);
  check('T8 mismatch 時も diff に自己分析本文が出ない', !vJson.includes(SECRET));
  check('T8 mismatch 時に legacy の実値が出ない', !vJson.includes('違う要約'));
  check('T8 mismatch 時に claim token（fingerprint）が出ない',
    token !== null && !vJson.includes(token));
  check('T8 mismatch 時に canonical の実値が出ない',
    !vJson.includes(String(legacyFromSupabase.summary)));
  //   reason は型上 enum だが、型を広げる変更が入っても runtime で落ちるようにする。
  const reasons = v.cmp.entries
    .map((e) => e.reason as unknown)
    .filter((r): r is string => typeof r === 'string');
  check('T8 reason は既知の enum 相当のみ',
    reasons.every((r) => /^[a-z_]+$/.test(r)), reasons.join(' | '));
}

// ── 9. schema / mirror / consumer ─────────────────────────────────────
function t9Static(): void {
  console.log('\n9. Schema / mirror / consumer');
  // self_analysis_logs は schema_version を sync view に含まない（snapshot kind と違う）
  const views = stripComments(readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/views.ts'), 'utf8'));
  const item = views.slice(views.indexOf('export function selfAnalysisItemView'));
  check('T9 self_analysis の sync view は schemaVersion を含まない',
    !item.slice(0, 400).includes('schemaVersion'));

  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  // ★ S5-P7: consumer path 全体を見る（stage5-2 / stage5-3 と同一の retarget）★
  //   本 lineage では prompt 合成が `composeTutorPrompt`（純関数）へ抽出済みで、
  //   section builder の呼び出しは route ではなくそちらにある。不変条件は
  //   「legacy の Supabase section が今も組み立てられていること」なので、route 単体では
  //   なく consumer path（route + composeTutorPrompt）を対象にする。
  //   ★ import 行を除いた本体で「呼ばれている」ことを見る ★
  //     単なる出現検査は、呼び出しの差し替え（import だけ残る）を見逃す。
  const consumerPath = [route, readFileSync(join(ROOT, 'lib/tutor/composeTutorPrompt.ts'), 'utf8')]
    .map((src) => src.split('\n').filter((l) => !/^\s*import /.test(l)).join('\n'))
    .join('\n');
  check('T9 legacy の Supabase section が残っている',
    /buildTutorSupabaseContextSection\s*\(/.test(consumerPath));
  check('T9 legacy section builder が実体として存在する',
    readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8')
      .includes('export function buildTutorSupabaseContextSection'));
  // ★ 修正（S5-P6 promotion）★ source 側は route.indexOf('buildTutorUserPrompt') を
  //   anchor に ±1500 字 window を見ていた。この識別子は file 冒頭の見出しコメントにも
  //   現れるため window が file 先頭に張られ、実際の prompt 経路を検査できていない
  //   （S5-P4 / S5-P5 で 5.2 / 5.3 側に見つかったのと同じ defect）。
  //   コメント行を除いた実コード上で **呼び出し形**に anchor し、
  //   固定 window ではなく prompt 組み立て「以降すべて」を検査する。
  const routeCode = route
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  // ★ S5-P7: 実在する組み立て呼び出しのうち最も早いものへ anchor を広げた ★
  //   `= buildTutorUserPrompt(` 固定では、prompt 合成が composeTutorPrompt へ
  //   抽出された本 lineage で anchor が消えて検査が空回りする
  //   （stage5-2 / stage5-3 に入れたものと同一の retarget。検査範囲は広がる方向）。
  const promptAnchors = ['= composeTutorPrompt(', '= buildTutorUserPrompt(']
    .map((a) => routeCode.indexOf(a))
    .filter((i) => i !== -1);
  const promptIdx = promptAnchors.length > 0 ? Math.min(...promptAnchors) : -1;
  check('T9 prompt 組み立て位置を特定できる', promptIdx !== -1);
  if (promptIdx !== -1) {
    const afterPrompt = routeCode.slice(promptIdx);
    check('T9 prompt 以降に shadowResolvedInput が現れない',
      !afterPrompt.includes('shadowResolvedInput'));
    check('T9 prompt 以降に self_analysis canonical 経路が現れない',
      !afterPrompt.includes('selfAnalysisLogs') && !afterPrompt.includes('deviceSelfAnalysis'));
    // optional chaining（`.context?.blocks`）でも抜けないよう正規表現で見る。
    check('T9 prompt 以降に canonical block 配列が現れない',
      !/\.context\??\.blocks/.test(afterPrompt));
    check('T9 prompt 以降に compareTutorShadow が現れない',
      !afterPrompt.includes('compareTutorShadow'));
  }
  const legacyCtx = readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8');
  check('T9 legacy が canonical block を import しない', !legacyCtx.includes('examSpine/blocks'));
  check('T9 legacy が canonical context を import しない', !legacyCtx.includes('examSpine/context'));
  const claimSrc = stripComments(readFileSync(join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8'));
  check('T9 claim 層に mutation が無い', !/\.(insert|upsert|update|delete|rpc)\s*\(/.test(claimSrc));
  const page = readFileSync(join(ROOT, 'app/tutor/page.tsx'), 'utf8');
  check('T9 client は device canonical を読むだけ', page.includes('loadSelfAnalysisLogs()'));
}

// ── 10. isolation ─────────────────────────────────────────────────────
async function t10Isolation(): Promise<void> {
  console.log('\n10. Request isolation');
  const token = deviceSelfAnalysisToken(DEVICE_LOGS);
  const tabA = await assemble({ claim: token, request: new Request('https://example.test/tabA') });
  const tabB = await assemble({ claim: 'efp1:' + 'c'.repeat(64), request: new Request('https://example.test/tabB') });
  eq('T10 tab A は verified', tabA.source?.syncStatus, 'verified');
  check('T10 tab B は verified にならない', tabB.source?.syncStatus !== 'verified');
  eq('T10 tab B の origin は bridge', tabB.source?.origin, 'bridge');

  const withClaim = await assemble({ claim: token });
  const without = await assemble();
  eq('T10 claim の有無で query 数が変わらない',
    withClaim.ctx.diagnostics.sourceQueryCount, without.ctx.diagnostics.sourceQueryCount);
  console.log(`  info  canonical query count = ${withClaim.ctx.diagnostics.sourceQueryCount}`);
}

// ── 11. overflow semantics（E-S43 で解消済み）─────────────────────────
async function t11TruncationBlocker(): Promise<void> {
  console.log('\n11. Overflow semantics (E-S43)');
  // ★ Stage 5.4 時点では「行数 > cap → unreadable」が blocker（E-S41）だった。
  //   Stage 5.5 の E-S43 で「cap は比較 window」と定め、overflow は unreadable に
  //   しないようにした。ここではその解消後の挙動を固定する。
  const over = await assemble({ logs: DEVICE_LOGS, claim: deviceSelfAnalysisToken(DEVICE_LOGS) });
  eq('T11 行数 > cap でも unreadable にしない', over.source?.state, 'available');
  eq('T11 window 同士が一致すれば verified', over.source?.syncStatus, 'verified');
  eq('T11 overflow の観測は readStatus に残る', over.source?.readStatus, 'truncated');
  eq('T11 truncated flag が provenance に残る', over.source?.truncated, true);
  eq('T11 origin は server', over.source?.origin, 'server');

  // ★ 旧 T11 が守っていた invariant のうち、E-S43 後も生き続けるものを移設する ★
  //   （S5-P7 / §T11 migration。「QA を通すため削除」にしない）
  //
  //   旧 T11 の保証:
  //     (1) 行数 > cap の server は unreadable            → E-S43 で意図的に廃止
  //     (2) unreadable では sync 判定に進まない           → 実際の失敗については維持（下記 b）
  //     (3) origin は bridge のまま                       → 同上
  //     (4) truncated が readStatus に残る                → 維持（上記）
  //   加えて E-S43 が新たに守るべきもの:
  //     (5) overflow を ok へ丸めない
  //     (6) 実際の失敗（error / skipped）は依然 unreadable
  //     (7) window 内が違えば verified にしない（false verified を作らない）

  // (a) overflow を ok へ丸めていない。
  check('T11 overflow を ok へ丸めていない', over.source?.readStatus !== 'ok');

  // (b) 実際の失敗は依然 unreadable で、sync 判定に進まず origin も bridge のまま。
  const failed = await assemble({
    logs: DEVICE_LOGS, claim: deviceSelfAnalysisToken(DEVICE_LOGS),
    errors: { self_analysis_logs: { code: '42P01', message: 'x' } },
  });
  eq('T11 query failure は依然 unreadable', failed.source?.state, 'unreadable');
  eq('T11 query failure では sync 判定に進まない', failed.source?.syncStatus, null);
  eq('T11 query failure の origin は bridge のまま', failed.source?.origin, 'bridge');

  // (c) overflow でも window 内が違えば verified にしない（自動 MATCH ではない）。
  const wrongWindow = await assemble({
    logs: DEVICE_LOGS, claim: 'efp1:' + 'd'.repeat(64),
  });
  check('T11 overflow でも window が違えば verified にしない',
    wrongWindow.source?.syncStatus !== 'verified', String(wrongWindow.source?.syncStatus));
}


// ── 12. Stage 5.4 の境界（5.5 feature 以降を巻き込んでいないこと）─────────
//
//   Stage 5.4 は self_analysis の device claim 配線と shadow 比較元の訂正だけを
//   昇格する packet である。source lineage には 5.5（cap を比較 window とみなす）/
//   5.6（statement_review）/ interview_record が続いており混入しやすい。
//
//   ★ window primitive と Stage 5.5 feature を取り違えない ★
//     device sync window primitive（`selectDeviceSyncWindow` / deviceViews.ts）は
//     device 側が server と同じ「上位 cap 件」を選ぶだけの選択規則であり、
//     Stage 5.4 の claim parity が成立するための **前提**（E-S47）。
//     canonical source の可読性判定は一切変えないので ALLOWED。
//
//     Stage 5.5 の feature は別物で、「cap を比較 window とみなし truncated を
//     unreadable にしない」という **可読性 semantics の変更**である
//     （assemble.server.ts の早期 return 除去 ＋ serverMirrorCandidate の
//     `windowed` opt-in）。これは未昇格なので FORBIDDEN。
function t12Boundary(): void {
  console.log('\n12. Stage 5.4 boundary');

  // (a) claim kind — 実ソースから抽出（arity 非依存）。
  const claimFile = readFileSync(join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8');
  const fnIdx = claimFile.indexOf('export function buildTutorDeviceClaimEntries(');
  check('T12 claim 組み立て関数を特定できる', fnIdx !== -1);
  const declaredKinds = Array.from(
    claimFile.slice(Math.max(fnIdx, 0)).matchAll(/entries\.push\(\{\s*kind:\s*'([a-z_]+)'/g),
  ).map((m) => m[1]).sort();
  eq('T12 tutor の claim kind は 5.1-5.4 の 4 つのみ', declaredKinds,
    ['activity', 'basic_info', 'diagnosis', 'self_analysis']);

  // (b) window primitive は許可、Stage 5.5 feature は禁止（機械的に区別する）。
  const deviceViews = readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/deviceViews.ts'), 'utf8');
  check('T12 device sync window primitive は昇格済み（許可）',
    deviceViews.includes('selectDeviceSyncWindow'));
  //   primitive は self_analysis にだけ適用されている（他 kind へ広げるのは 5.5 以降）。
  const otherWindowed = ['deviceStatementReviewView', 'deviceSelfPrView',
    'deviceInterviewRecordView', 'deviceEssayView'].filter((fn) => {
    const i = deviceViews.indexOf(`export function ${fn}(`);
    return i !== -1 && deviceViews.slice(i, i + 400).includes('selectDeviceSyncWindow');
  });
  eq('T12 window primitive は self_analysis 以外へ広がっていない', otherWindowed, []);

  const adapterTypes = readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/types.ts'), 'utf8');
  const smcIdx = adapterTypes.indexOf('export function serverMirrorCandidate(');
  check('T12 serverMirrorCandidate を特定できる', smcIdx !== -1);
  const smcBody = smcIdx === -1 ? '' : adapterTypes.slice(smcIdx, smcIdx + 1200);
  //   S5-P7 で Stage 5.5（E-S48）を昇格した。禁止から「opt-in が維持されていること」へ。
  check('T12 Stage 5.5 の windowed opt-in は昇格済み（許可）', /\bwindowed\b/.test(smcBody));
  check('T12 windowed は opt-in のまま（既定 strict）',
    /input\.windowed === true/.test(smcBody));

  const assembler = readFileSync(join(ROOT, 'lib/examSpine/context/assemble.server.ts'), 'utf8');
  check('T12 windowed の付与は capped kind に限定されている',
    /windowed: isExamCappedSourceKind\(kind\)/.test(assembler));
  check('T12 非 capped kind の truncated は unreadable のまま',
    /truncated && !isExamCappedSourceKind\(kind\)/.test(assembler));

  // (c) Stage 5.6 / interview_record の block が混入していない。
  const blockIds = Object.keys(EXAM_CONTEXT_BLOCK_REGISTRY);
  for (const later of ['interview_issue_line']) {
    check(`T12 未昇格 stage の block \`${later}\` が混入していない`, !blockIds.includes(later));
  }
  //   tutor plan は 5.1 + 5.2 + 5.3 のまま（5.4 は block を足さない / 下記 (e) 参照）。
  const tutorBlocks = EXAM_PURPOSE_PLANS.tutor.blocks.map((b) => b.id);
  eq('T12 tutor plan の block は 5.1 + 5.2 + 5.3 の 3 つのまま', tutorBlocks, [
    'tutor_student_context', 'diagnosis_type_hint', 'activity_category_counts',
  ]);

  // (d) consumer switch が動いていない。
  const entry = readFileSync(join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_STAGE5_ENTRY.md'), 'utf8');
  check('T12 FIRST_STAGE5_CONSUMER=tutor のまま', /FIRST_STAGE5_CONSUMER\s*=\s*tutor\b/.test(entry));
  check('T12 FIRST_STAGE5_SLOT=basic_info のまま（self_analysis へ切り替えない）',
    /FIRST_STAGE5_SLOT\s*=\s*basic_info\b/.test(entry));

  // (e) ★ Stage 5.4 は canonical block を追加しない ★
  //     legacy が prompt に出している 4 行に対応する tutor 向け block は
  //     Stage 5.4 の locked intent では **意図的に未実装**（新 block を乱造しない）。
  //     ここを緩めて block を足すと source の intent を変えることになる。
  check('T12 self_analysis の tutor 向け canonical block は未追加のまま',
    !blockIds.includes('self_analysis_tutor') && !blockIds.includes('self_analysis_summary_line'));
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5.4] Self analysis device claim wiring');
  t1Authority();
  t2SingleAuthority();
  t3CapParity();
  t4Claim();
  t5Independence();
  await t6Matrix();
  await t7Privacy();
  await t8Shadow();
  t9Static();
  await t10Isolation();
  await t11TruncationBlocker();
  t12Boundary();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage5.4] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1; return;
  }
  console.log(`\n[exam-spine-stage5.4] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-stage5.4] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage5.4] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1; return;
  }
  console.log('[exam-spine-stage5.4] PASS');
}
void main();
