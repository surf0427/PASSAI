// Exam Spine — Stage 5.5 / E-S43 history comparison window semantics の check。
//
// 「canonical read cap は **意図された比較 window** であり、overflow は unreadable ではない」
// を機械的に固定する。E-S41（truncation blocker）の regression test でもある。
//
// ★ overflow = 自動 MATCH ではない ★
//   top-N window の中身が違えば必ず mismatch のままであることも同時に検証する。
//
// 実 Supabase / 実 AI を使わない（fake executor のみ）。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let fetchCallCount = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage5.5] 外部通信: ${String(args[0])}`);
}) as typeof realFetch;

import type { SelfAnalysisLog } from '@/types/selfAnalysisLog';
import type { BasicInfo } from '@/types/basicInfo';
import { deviceSelfAnalysisToken, deviceBasicInfoToken,
  buildTutorDeviceClaimEntries } from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import { serializeDeviceClaim } from '@/lib/examSpine/sync/claim/serialize';
import { selectDeviceSyncWindow } from '@/lib/examSpine/sync/adapters/deviceViews';
import { serverMirrorCandidate } from '@/lib/examSpine/sync/adapters/types';
import { EXAM_READ_CAPS, isExamCappedSourceKind } from '@/lib/examSpine/read/types';
import { buildCanonicalExamContext } from '@/lib/examSpine/context/assemble.server';
import { compareTutorShadow } from '@/lib/examSpine/context/shadow/compareTutor';
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

const CAP = EXAM_READ_CAPS.self_analysis;
const SECRET = 'W5_SECRET_EPISODE';

function log(n: number, mark = ''): SelfAnalysisLog {
  return {
    id: `log-${n}`,
    // n が大きいほど新しい。ミリ秒まで一意。
    createdAt: `2026-03-01T00:00:${String(n % 60).padStart(2, '0')}.${String(n % 1000).padStart(3, '0')}Z`,
    updatedAt: '2026-03-01T00:00:00.000Z',
    summaryInputHash: `h${n}`,
    analysis: { summary: `要約 ${n}${mark}`, strengths: [`強み ${n}`],
      weaknesses: [`課題 ${n}`], futureConnections: [`将来 ${n}`] },
    displayedQuestions: [`Q${n}`], answers: [SECRET],
    deepAnswers: [`DA${n}`], freeMemo: SECRET,
    summary: { summary: `sum ${n}` },
  } as unknown as SelfAnalysisLog;
}

/** device: 挿入順（古い→新しい）。 */
function deviceLogs(count: number, markTop?: string): SelfAnalysisLog[] {
  const out = Array.from({ length: count }, (_, i) => log(i + 1));
  if (markTop) out[out.length - 1] = log(count, markTop);
  return out;
}
/** server: canonical ordering（created_at DESC）で保持されている想定の行。 */
function serverRows(logs: readonly SelfAnalysisLog[]): Record<string, unknown>[] {
  return [...logs]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((l) => ({
      id: l.id, user_id: USER_A, created_at: l.createdAt,
      analysis: l.analysis, summary: l.summary,
      displayed_questions: l.displayedQuestions, answers: l.answers,
      deep_answers: l.deepAnswers, free_memo: l.freeMemo,
    }));
}
const authorizeA = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A });

async function run(opts: {
  serverLogs: readonly SelfAnalysisLog[];
  deviceLogs?: readonly SelfAnalysisLog[] | null;
  errors?: Record<string, { code: string; message: string }>;
  claimOverride?: string | null;
}) {
  const database = { tables: { self_analysis_logs: serverRows(opts.serverLogs) } } as FakeDb;
  if (opts.errors) (database as FakeDb).errors = opts.errors;
  const rec = createRecordingExecutor(database);
  const token = opts.claimOverride !== undefined
    ? opts.claimOverride
    : opts.deviceLogs === null ? null : deviceSelfAnalysisToken(opts.deviceLogs ?? []);
  const r = await buildCanonicalExamContext({
    request: new Request('https://example.test/s55/' + Math.random().toString(36).slice(2)),
    purpose: 'tutor',
    authorize: authorizeA,
    bridge: {},
    deviceClaims: token === null ? undefined
      : ({ self_analysis: { presented: true, fingerprint: token } } as never),
    executor: rec.executor,
    projectionNow: '2026-01-01T00:00:00.000Z',
  });
  if (!r.ok) throw new Error('veto: ' + r.veto.reasons.join(','));
  return { ctx: r.context, rec, resolved: r.shadowResolvedInput,
    source: r.context.sources.find((s) => s.kind === 'self_analysis') };
}

// ── 1. window abstraction ─────────────────────────────────────────────
function t1Window(): void {
  console.log('\n1. Window abstraction');
  eq('T1 self_analysis は capped(history) kind', isExamCappedSourceKind('self_analysis'), true);
  eq('T1 basic_info は capped ではない', isExamCappedSourceKind('basic_info'), false);
  eq('T1 diagnosis は capped ではない', isExamCappedSourceKind('diagnosis'), false);
  eq('T1 activity は capped ではない', isExamCappedSourceKind('activity'), false);

  const logs = deviceLogs(20);
  const win = selectDeviceSyncWindow(logs, CAP, (l) => l.createdAt);
  eq('T1 window は cap 件', win.length, CAP);
  eq('T1 window は新しい順', win.map((l) => l.id), ['log-20','log-19','log-18','log-17','log-16']);

  // strict default は維持されている
  const strict = serverMirrorCandidate({ status: 'truncated', observation: null });
  eq('T1 windowed 未指定なら truncated は unreadable のまま', strict.state, 'unreadable');
  const windowed = serverMirrorCandidate({ status: 'truncated', observation: null, windowed: true });
  eq('T1 windowed:true なら truncated は readable（空なら empty）', windowed.state, 'empty');
  const err = serverMirrorCandidate({ status: 'error', observation: null, windowed: true });
  eq('T1 windowed でも error は unreadable', err.state, 'unreadable');
}

// ── 2. row-count matrix（A〜E）────────────────────────────────────────
async function t2RowCounts(): Promise<void> {
  console.log('\n2. Row-count matrix');

  // A. 0 rows
  const a = await run({ serverLogs: [], deviceLogs: [] });
  eq('T2-A 0 行は empty', a.source?.state, 'empty');
  eq('T2-A 0 行で truncated は立たない', a.source?.truncated, false);

  // B. 1 row
  const b1 = deviceLogs(1);
  const b = await run({ serverLogs: b1, deviceLogs: b1 });
  eq('T2-B 1 行 matching → verified', b.source?.syncStatus, 'verified');
  eq('T2-B 1 行 → available', b.source?.state, 'available');
  eq('T2-B 1 行で truncated は立たない', b.source?.truncated, false);

  // C. exactly cap
  const c5 = deviceLogs(CAP);
  const c = await run({ serverLogs: c5, deviceLogs: c5 });
  eq('T2-C cap ちょうど → verified', c.source?.syncStatus, 'verified');
  eq('T2-C cap ちょうどで truncated は立たない', c.source?.truncated, false);

  // D. cap + 1 ★ E-S41 の主要 regression
  const d6 = deviceLogs(CAP + 1);
  const d = await run({ serverLogs: d6, deviceLogs: d6 });
  eq('T2-D cap+1 → unreadable にならない', d.source?.state, 'available');
  eq('T2-D cap+1 → verified', d.source?.syncStatus, 'verified');
  eq('T2-D cap+1 → truncated が観測として残る', d.source?.truncated, true);
  eq('T2-D cap+1 → readStatus は truncated のまま', d.source?.readStatus, 'truncated');
  eq('T2-D cap+1 → origin は server', d.source?.origin, 'server');

  // E. much greater than cap
  const e200 = deviceLogs(200);
  const e = await run({ serverLogs: e200, deviceLogs: e200 });
  eq('T2-E 200 行 → verified', e.source?.syncStatus, 'verified');
  eq('T2-E 200 行 → available', e.source?.state, 'available');
  eq('T2-E 200 行でも rowCount は cap', e.source?.rowCount, CAP);
}

// ── 3. mismatch は保たれる（D 制約）──────────────────────────────────
async function t3Mismatch(): Promise<void> {
  console.log('\n3. Mismatch preserved');

  // F. window 内の差異 → mismatch
  const server = deviceLogs(20);
  const deviceChanged = deviceLogs(20, '★changed');
  const f = await run({ serverLogs: server, deviceLogs: deviceChanged });
  check('T3-F window 内が違えば verified にならない', f.source?.syncStatus !== 'verified',
    String(f.source?.syncStatus));
  eq('T3-F window 内が違えば state は unverified', f.source?.state, 'unverified');
  eq('T3-F origin は bridge のまま', f.source?.origin, 'bridge');

  // G. window 外だけが違う → verified（仕様どおり）
  const serverG = deviceLogs(20);
  const deviceG = [...deviceLogs(20)];
  // 最古（window 外）の 1 件だけを変える
  deviceG[0] = log(1, '★outside');
  const g = await run({ serverLogs: serverG, deviceLogs: deviceG });
  eq('T3-G window 外だけの差異は verified', g.source?.syncStatus, 'verified');
  check('T3-G window 外の差異は state を落とさない', g.source?.state === 'available');

  // H. ordering shift: 新しい row が増えて window がずれる
  const before = deviceLogs(10);
  const after = deviceLogs(11);
  const oldClaim = deviceSelfAnalysisToken(before);
  const newClaim = deviceSelfAnalysisToken(after);
  check('T3-H window がずれれば token も変わる', oldClaim !== newClaim);
  const hOld = await run({ serverLogs: after, claimOverride: oldClaim });
  check('T3-H 古い claim は verified にならない', hOld.source?.syncStatus !== 'verified',
    String(hOld.source?.syncStatus));
  const hNew = await run({ serverLogs: after, claimOverride: newClaim });
  eq('T3-H 新しい claim は verified', hNew.source?.syncStatus, 'verified');
}

// ── 4. 実際の失敗は unreadable のまま（E 制約）───────────────────────
async function t4RealFailures(): Promise<void> {
  console.log('\n4. Real failures stay unreadable');
  const logs = deviceLogs(20);
  const err = await run({ serverLogs: logs, deviceLogs: logs,
    errors: { self_analysis_logs: { code: '42P01', message: 'x' } } });
  eq('T4 query failure は unreadable', err.source?.state, 'unreadable');
  eq('T4 query failure では sync 判定に進まない', err.source?.syncStatus, null);
  eq('T4 query failure の readStatus は error', err.source?.readStatus, 'error');

  const absent = await run({ serverLogs: logs, deviceLogs: null });
  eq('T4 claim 無しは unclaimed', absent.source?.syncStatus, 'unclaimed');
  eq('T4 claim 無しは unverified', absent.source?.state, 'unverified');

  const bogus = await run({ serverLogs: logs, claimOverride: 'efp1:' + 'f'.repeat(64) });
  check('T4 無関係 token は verified にならない', bogus.source?.syncStatus !== 'verified');
}

// ── 5. guards / boundedness / privacy ────────────────────────────────
async function t5Guards(): Promise<void> {
  console.log('\n5. Guards / boundedness / privacy');

  // header boundedness
  const basic = { name: '受験 太郎', grade: '高校3年', track: '文系', examTypes: [],
    preferences: [{ university: 'U', faculty: '', department: '' }] } as BasicInfo;
  const bytes = (n: number) => new TextEncoder().encode(
    serializeDeviceClaim(buildTutorDeviceClaimEntries(basic, null, null, deviceLogs(n))) ?? '').length;
  const b5 = bytes(5), b20 = bytes(20), b200 = bytes(200), b1000 = bytes(1000);
  console.log(`  info  header bytes: 5=${b5} 20=${b20} 200=${b200} 1000=${b1000}`);
  eq('T5 履歴件数に比例しない（5 == 20）', b5, b20);
  eq('T5 履歴件数に比例しない（20 == 200）', b20, b200);
  eq('T5 履歴件数に比例しない（200 == 1000）', b200, b1000);

  // token independence（E-S42 の前提を壊さない）
  const saBefore = deviceSelfAnalysisToken(deviceLogs(20));
  const biBefore = deviceBasicInfoToken(basic);
  const saAfter = deviceSelfAnalysisToken(deviceLogs(21));
  check('T5 self_analysis 変更 → self_analysis token 変化', saAfter !== saBefore);
  eq('T5 self_analysis 変更 → basic_info token 不変', deviceBasicInfoToken(basic), biBefore);

  // false-empty guard（E-S42）が生きている
  const empty = await run({ serverLogs: [], deviceLogs: [] });
  const emptyCmp = compareTutorShadow({
    legacy: { selfAnalysis: null }, canonicalInput: empty.resolved, context: empty.ctx });
  eq('T5 空同士では READY にしない（E-S42）',
    emptyCmp.readiness.find((r) => r.kind === 'self_analysis')?.readiness, 'DEFERRED');

  // meaningful MATCH → READY（overflow 状態で）
  const logs = deviceLogs(20);
  const over = await run({ serverLogs: logs, deviceLogs: logs });
  const newest = log(20);
  const legacy = {
    summary: (newest.analysis as unknown as Record<string, unknown>).summary,
    strengths: (newest.analysis as unknown as Record<string, unknown>).strengths,
    weaknesses: (newest.analysis as unknown as Record<string, unknown>).weaknesses,
    futureConnections: (newest.analysis as unknown as Record<string, unknown>).futureConnections,
  };
  const before = over.rec.trace.length;
  const cmp = compareTutorShadow({ legacy: { selfAnalysis: legacy },
    canonicalInput: over.resolved, context: over.ctx });
  const diffs = cmp.entries.filter((e) => e.kind === 'self_analysis');
  eq('T5 overflow 状態でも 4 field が MATCH', diffs.filter((d) => d.diff === 'MATCH').length, 4);
  eq('T5 overflow 状態で self_analysis は READY',
    cmp.readiness.find((r) => r.kind === 'self_analysis')?.readiness, 'READY');
  eq('T5 compare は追加 read を出さない', over.rec.trace.length - before, 0);

  // privacy
  check('T5 context に本文が出ない', !JSON.stringify(over.ctx).includes(SECRET));
  check('T5 diff に本文が出ない', !JSON.stringify(cmp).includes(SECRET));
}

// ── 6. query count / consumer invariance ─────────────────────────────
async function t6Invariants(): Promise<void> {
  console.log('\n6. Query count / consumer invariance');
  const logs = deviceLogs(20);
  const withClaim = await run({ serverLogs: logs, deviceLogs: logs });
  const without = await run({ serverLogs: logs, deviceLogs: null });
  eq('T6 claim の有無で query 数が変わらない',
    withClaim.ctx.diagnostics.sourceQueryCount, without.ctx.diagnostics.sourceQueryCount);
  eq('T6 canonical query count は 10 のまま', withClaim.ctx.diagnostics.sourceQueryCount, 10);
  console.log(`  info  canonical query count = ${withClaim.ctx.diagnostics.sourceQueryCount}`);

  // self_analysis の query は 1 本だけ（verification 用の再 read が無い）
  const saQueries = withClaim.rec.trace.filter((t) => t.table === 'self_analysis_logs');
  eq('T6 self_analysis の query は 1 本', saQueries.length, 1);
  eq('T6 limit は cap + 1 のまま', saQueries[0].limit, CAP + 1);

  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  check('T6 legacy の Supabase section が残っている', route.includes('buildTutorSupabaseContextSection'));
  const idx = route.indexOf('buildTutorUserPrompt');
  if (idx !== -1) {
    const w = route.slice(Math.max(0, idx - 1500), idx + 1500);
    check('T6 prompt 付近に shadowResolvedInput が現れない', !w.includes('shadowResolvedInput'));
    check('T6 prompt 付近に comparison が現れない', !w.includes('comparison'));
  }
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5.5] History comparison window semantics (E-S43)');
  t1Window();
  await t2RowCounts();
  await t3Mismatch();
  await t4RealFailures();
  await t5Guards();
  await t6Invariants();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage5.5] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1; return;
  }
  console.log(`\n[exam-spine-stage5.5] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-stage5.5] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage5.5] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1; return;
  }
  console.log('[exam-spine-stage5.5] PASS');
}
void main();
