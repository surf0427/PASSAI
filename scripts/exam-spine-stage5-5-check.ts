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

  // ★ mismatch path こそ値が漏れやすい（S5-P5 の負例 N5 で発見した失敗形）★
  //   MATCH 経路しか見ていない guard は、VALUE_MISMATCH の `reason` に legacy /
  //   canonical の実値を載せる変更をすり抜ける。overflow 状態でも同じ保証が要る。
  const token = deviceSelfAnalysisToken(selectDeviceSyncWindow(logs, CAP, (l) => l.createdAt));
  const vCmp = compareTutorShadow({
    legacy: { selfAnalysis: { ...legacy, summary: 'MISMATCH_PROBE_SUMMARY' } },
    canonicalInput: over.resolved, context: over.ctx });
  const vDiffs = vCmp.entries.filter((e) => e.kind === 'self_analysis');
  check('T5 mismatch は VALUE_MISMATCH になる',
    vDiffs.some((d) => d.field === 'self_analysis.summary' && d.diff === 'VALUE_MISMATCH'));
  const vJson = JSON.stringify(vCmp);
  check('T5 mismatch 時も本文が出ない', !vJson.includes(SECRET));
  check('T5 mismatch 時に legacy の実値が出ない', !vJson.includes('MISMATCH_PROBE_SUMMARY'));
  check('T5 mismatch 時に canonical の実値が出ない',
    !vJson.includes(String((newest.analysis as unknown as Record<string, unknown>).summary)));
  check('T5 mismatch 時に claim token（fingerprint）が出ない',
    token !== null && !vJson.includes(token));
  //   reason は型上 enum だが、型を広げる変更が入っても runtime で落ちるようにする。
  const reasons = vCmp.entries
    .map((e) => e.reason as unknown)
    .filter((r): r is string => typeof r === 'string');
  check('T5 reason は既知の enum 相当のみ',
    reasons.every((r) => /^[a-z_]+$/.test(r)), reasons.join(' | '));
  //   raw self-analysis の各 field 名が telemetry に出ない（answers / deep_answers / free_memo）。
  for (const raw of ['deep_answers', 'free_memo', 'displayed_questions']) {
    check(`T5 mismatch telemetry に ${raw} が出ない`, !vJson.includes(raw));
  }
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
  // ★ S5-P8: consumer path 全体を見る（stage5-2 / 5-3 / 5-4 と同一の retarget）★
  //   本 lineage では prompt 合成が `composeTutorPrompt`（純関数）へ抽出済みで、
  //   section builder の呼び出しは route ではなくそちらにある。不変条件は
  //   「legacy の Supabase section が今も組み立てられていること」なので、route 単体では
  //   なく consumer path（route + composeTutorPrompt）を対象にし、import 行を除いた
  //   本体で **呼び出し形** を検査する（単なる出現検査は呼び出しの差し替えを見逃す）。
  const consumerPath = [route, readFileSync(join(ROOT, 'lib/tutor/composeTutorPrompt.ts'), 'utf8')]
    .map((src) => src.split('\n').filter((l) => !/^\s*import /.test(l)).join('\n'))
    .join('\n');
  check('T6 legacy の Supabase section が残っている',
    /buildTutorSupabaseContextSection\s*\(/.test(consumerPath));
  check('T6 legacy section builder が実体として存在する',
    readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8')
      .includes('export function buildTutorSupabaseContextSection'));
  // ★ 修正（S5-P7 promotion）★ source 側は route.indexOf('buildTutorUserPrompt') を
  //   anchor に ±1500 字 window を見ていた。この識別子は file 冒頭の見出しコメントにも
  //   現れるため window が file 先頭に張られ、実際の prompt 経路を検査できていない
  //   （S5-P4 / S5-P5 / S5-P6 で 5.2 / 5.3 / 5.4 側に見つかったのと同じ defect。4 回目）。
  const routeCode = route
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  // ★ S5-P8: 実在する組み立て呼び出しのうち最も早いものへ anchor を広げた ★
  //   `= buildTutorUserPrompt(` 固定では、prompt 合成が composeTutorPrompt へ抽出された
  //   本 lineage で anchor が消えて検査が空回りする（検査範囲は広がる方向）。
  const promptAnchors = ['= composeTutorPrompt(', '= buildTutorUserPrompt(']
    .map((a) => routeCode.indexOf(a))
    .filter((i) => i !== -1);
  const promptIdx = promptAnchors.length > 0 ? Math.min(...promptAnchors) : -1;
  check('T6 prompt 組み立て位置を特定できる', promptIdx !== -1);
  if (promptIdx !== -1) {
    const afterPrompt = routeCode.slice(promptIdx);
    check('T6 prompt 以降に shadowResolvedInput が現れない',
      !afterPrompt.includes('shadowResolvedInput'));
    check('T6 prompt 以降に compareTutorShadow が現れない',
      !afterPrompt.includes('compareTutorShadow'));
    check('T6 prompt 以降に canonical block 配列が現れない',
      !/\.context\??\.blocks/.test(afterPrompt));
    check('T6 prompt 以降に windowed mirror 出力が現れない',
      !afterPrompt.includes('selfAnalysisLogs') && !afterPrompt.includes('serverMirrorCandidate'));
  }
  const legacyCtx = readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8');
  check('T6 legacy が canonical context を import しない', !legacyCtx.includes('examSpine/context'));
}

// ── 7. opt-in scope（誰が windowed になるのか）─────────────────────────
//
//   ★ E-S43 の対象は self_analysis だけではない ★
//     assembler は `windowed: isExamCappedSourceKind(kind)` を渡すので、
//     `EXAM_READ_CAPS` に載る **全 capped kind** が opt-in される。
//     これは source authority（E-S43 の §対象）どおりだが、
//     「self_analysis だけ」と誤読されやすいので scope を機械的に固定する。
//
//   ★ ただし canonical で verified に到達し得るのは self_analysis だけ ★
//     他の capped kind は device claim が未配線なので `unclaimed` 止まりであり、
//     windowed になっても available/verified にはならない。
//     この非対称性が崩れる（＝ 5.6 以降の claim が混入する）と落ちる。
function t7OptInScope(): void {
  console.log('\n7. Opt-in scope');

  // (a) 非 capped kind は opt-in されない。
  for (const k of ['basic_info', 'activity', 'diagnosis'] as const) {
    eq(`T7 ${k} は capped ではない（opt-in されない）`, isExamCappedSourceKind(k), false);
  }
  // (b) capped kind の集合を pin する（勝手に増減しない）。
  const capped = Object.keys(EXAM_READ_CAPS).sort();
  eq('T7 capped kind の集合', capped, ['essay', 'interview_ai', 'interview_record',
    'presentation', 'self_analysis', 'self_pr', 'statement_review']);

  // (c) assembler の opt-in は capped 判定に束縛されている（無条件ではない）。
  const assembler = readFileSync(join(ROOT, 'lib/examSpine/context/assemble.server.ts'), 'utf8');
  check('T7 windowed は capped kind 判定に束縛されている',
    /windowed: isExamCappedSourceKind\(kind\)/.test(assembler));
  check('T7 非 capped kind の truncated は契約違反として unreadable',
    /truncated && !isExamCappedSourceKind\(kind\)/.test(assembler));
  check('T7 実際の失敗（error / skipped）は unreadable のまま',
    /readStatus === 'error' \|\| readStatus === 'skipped'/.test(assembler));

  // (d) serverMirrorCandidate は opt-in しなければ strict のまま。
  const strictTruncated = serverMirrorCandidate({ status: 'truncated', observation: null });
  eq('T7 windowed 未指定なら truncated は unreadable', strictTruncated.state, 'unreadable');
  const strictError = serverMirrorCandidate({ status: 'error', observation: null, windowed: true });
  eq('T7 windowed でも error は unreadable', strictError.state, 'unreadable');
  const strictSkipped = serverMirrorCandidate({ status: 'skipped', observation: null, windowed: true });
  eq('T7 windowed でも skipped は unreadable', strictSkipped.state, 'unreadable');

  // (e) device 側 window primitive は self_analysis 以外へ広がっていない（E-S47 の scope）。
  const deviceViews = readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/deviceViews.ts'), 'utf8');
  const spread = ['deviceSelfPrView',
    'deviceInterviewRecordView', 'deviceEssayView'].filter((fn) => {
    const i = deviceViews.indexOf(`export function ${fn}(`);
    return i !== -1 && deviceViews.slice(i, i + 400).includes('selectDeviceSyncWindow');
  });
  eq('T7 device window primitive は self_analysis + statement_review のみ', spread, []);

  // (f) tutor の claim kind は 5.1-5.4 の 4 つのまま（5.6 の claim が入っていない）。
  const claimFile = readFileSync(
    join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8');
  const fnIdx = claimFile.indexOf('export function buildTutorDeviceClaimEntries(');
  const kinds = Array.from(
    claimFile.slice(Math.max(fnIdx, 0)).matchAll(/entries\.push\(\{\s*kind:\s*'([a-z_]+)'/g),
  ).map((m) => m[1]).sort();
  eq('T7 tutor の claim kind は 5.1-5.6 の 5 つのみ', kinds,
    ['activity', 'basic_info', 'diagnosis', 'self_analysis', 'statement_review']);

  // (g) self_analysis の tutor-facing canonical block は依然として未追加（§11）。
  const registry = readFileSync(join(ROOT, 'lib/examSpine/blocks/registry.ts'), 'utf8');
  for (const forbidden of ['self_analysis_tutor', 'self_analysis_summary_line',
    'self_analysis_strengths', 'interview_issue_line']) {
    check(`T7 block \`${forbidden}\` は追加されていない`, !registry.includes(`${forbidden}:`));
  }
}

// ── 8. T11 migration meta-guard ───────────────────────────────────────
//
//   ★ 「QA を通すために test を消す」を機械的に落とす ★
//     Stage 5.5 の昇格で Stage 5.4 の旧 T11（行数 > cap → unreadable）は
//     意図的に obsolete になった。しかし旧 T11 が守っていた invariant のうち
//     以下は E-S43 後も生き続けるものであり、**移設先が存在すること**を固定する。
//     移設せず削除した場合、ここが落ちる。
function t8T11Migration(): void {
  console.log('\n8. T11 migration meta-guard');
  const s54 = readFileSync(join(ROOT, 'scripts/exam-spine-stage5-4-check.ts'), 'utf8');

  check('T8 Stage 5.4 に overflow semantics section が存在する',
    s54.includes('11. Overflow semantics'));
  // (1) overflow が unreadable にならない（E-S43 の主要 regression）
  check('T8 overflow → available が固定されている',
    /行数 > cap でも unreadable にしない/.test(s54));
  // (2) overflow の観測が失われていない（readStatus / truncated flag の両方）
  check('T8 readStatus が truncated のまま固定されている',
    /readStatus.*'truncated'|overflow の観測は readStatus に残る/.test(s54));
  check('T8 truncated flag の保持が固定されている',
    /truncated flag が provenance に残る/.test(s54));
  check('T8 overflow を ok へ丸めない検査がある',
    /overflow を ok へ丸めていない/.test(s54));
  // (3) 実際の失敗は依然 unreadable / sync 判定に進まない / origin bridge
  check('T8 query failure が unreadable のまま固定されている',
    /query failure は依然 unreadable/.test(s54));
  check('T8 query failure で sync 判定に進まないことが固定されている',
    /query failure では sync 判定に進まない/.test(s54));
  check('T8 query failure で origin が bridge のままであることが固定されている',
    /query failure の origin は bridge のまま/.test(s54));
  // (4) false verified を作らない
  check('T8 overflow でも window 違いは verified にしない検査がある',
    /overflow でも window が違えば verified にしない/.test(s54));
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5.5] History comparison window semantics (E-S43)');
  t1Window();
  await t2RowCounts();
  await t3Mismatch();
  await t4RealFailures();
  await t5Guards();
  await t6Invariants();
  t7OptInScope();
  t8T11Migration();

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
