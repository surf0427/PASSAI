// Exam Spine — Stage 5.6 statement_review claim wiring + semantic convergence（G8）。
//
// ★ transport parity と semantic parity を **別々に**検証する ★
//   claim が verified になることと、consumer semantics が一致することは別問題である。
//   前者は fingerprint の話、後者は「legacy が prompt に出している表現を canonical が
//   再現できるか」の話。混同すると「移行できる」という誤った結論になる。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let fetchCallCount = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage5.6] 外部通信: ${String(args[0])}`);
}) as typeof realFetch;

import type { ReviewHistoryItem } from '@/lib/statement/review/statementStorage';
import type { BasicInfo } from '@/types/basicInfo';
import { buildStatementWeaknessLine } from '@/lib/contextBuilders/tutorStudentContext';
import { buildPreviousOutputSummary } from '@/lib/contextBuilders/divergence/buildPreviousOutputSummary';
import {
  buildTutorDeviceClaimEntries,
  deviceBasicInfoToken,
  deviceStatementReviewToken,
} from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import { deviceStatementReviewView } from '@/lib/examSpine/sync/adapters/deviceViews';
import { examSyncObservation } from '@/lib/examSpine/sync/adapters/views';
import { serializeDeviceClaim } from '@/lib/examSpine/sync/claim/serialize';
import { parseDeviceClaimValue, toDeviceClaims } from '@/lib/examSpine/sync/claim/parse';
import { EXAM_DEVICE_CLAIM_MAX_BYTES } from '@/lib/examSpine/sync/claim/types';
import { EXAM_READ_CAPS, isExamCappedSourceKind } from '@/lib/examSpine/read/types';
import { buildCanonicalExamContext } from '@/lib/examSpine/context/assemble.server';
import { compareTutorShadow } from '@/lib/examSpine/context/shadow/compareTutor';
import { projectStatementReviewLegacyLine } from '@/lib/examSpine/context/shadow/statementReviewProjection';
import { sourcesForPurpose } from '@/lib/examSpine/purpose';
import { EXAM_PURPOSE_PLANS } from '@/lib/examSpine/orchestrator/plan';
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

const CAP = EXAM_READ_CAPS.statement_review;
const SECRET = 'STATEMENT_BODY_SECRET_TEXT';

function review(n: number, weaknesses: string[], extra: Partial<{ strengths: string[]; actions: string[] }> = {}): ReviewHistoryItem {
  return {
    id: `rv-${n}`,
    createdAt: `2026-04-01T00:00:${String(n % 60).padStart(2, '0')}.${String(n % 1000).padStart(3, '0')}Z`,
    university: `大学${n}`, faculty: `学部${n}`, department: `学科${n}`,
    essay: SECRET,
    result: { weaknesses, strengths: extra.strengths ?? [`強み${n}`], actions: extra.actions ?? [`行動${n}`] },
  } as unknown as ReviewHistoryItem;
}

/** device: newest-first（saveReviewHistory は [item, ...existing]）。 */
function deviceHistory(count: number, topWeak = '具体性が不足'): ReviewHistoryItem[] {
  const out: ReviewHistoryItem[] = [];
  for (let n = count; n >= 1; n -= 1) out.push(review(n, [n === count ? topWeak : `課題${n}`]));
  return out;
}
function serverRows(items: readonly ReviewHistoryItem[]): Record<string, unknown>[] {
  return [...items]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((i) => ({
      id: `db-${i.id}`, user_id: USER_A, local_review_id: i.id,
      university: i.university, faculty: i.faculty, department: i.department,
      result: i.result, created_at: i.createdAt,
    }));
}
const authorizeA = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A });

async function run(opts: {
  serverItems: readonly ReviewHistoryItem[];
  deviceItems?: readonly ReviewHistoryItem[] | null;
  claimOverride?: string | null;
  errors?: Record<string, { code: string; message: string }>;
  purpose?: 'tutor' | 'essay_chat';
}) {
  const database = { tables: { statement_review_history: serverRows(opts.serverItems) } } as FakeDb;
  if (opts.errors) (database as FakeDb).errors = opts.errors;
  const rec = createRecordingExecutor(database);
  const token = opts.claimOverride !== undefined ? opts.claimOverride
    : opts.deviceItems === null ? null : deviceStatementReviewToken(opts.deviceItems ?? []);
  const r = await buildCanonicalExamContext({
    request: new Request('https://example.test/s56/' + Math.random().toString(36).slice(2)),
    purpose: opts.purpose ?? 'tutor',
    authorize: authorizeA,
    bridge: {},
    deviceClaims: token === null ? undefined
      : ({ statement_review: { presented: true, fingerprint: token } } as never),
    executor: rec.executor,
    projectionNow: '2026-01-01T00:00:00.000Z',
  });
  if (!r.ok) throw new Error('veto: ' + r.veto.reasons.join(','));
  return { ctx: r.context, rec, resolved: r.shadowResolvedInput,
    source: r.context.sources.find((s) => s.kind === 'statement_review') };
}

// ── 1. authority ──────────────────────────────────────────────────────
function t1Authority(): void {
  console.log('\n1. Authority');
  const q = Q.statementReviewQuery('00000000-0000-4000-8000-000000000000');
  eq('T1 table', q.table, 'statement_review_history');
  eq('T1 mode は many', q.mode, 'many');
  eq('T1 ordering', q.order.map((o) => `${o.column}:${o.ascending ? 'asc' : 'desc'}`),
    ['created_at:desc', 'id:desc']);
  eq('T1 limit は cap+1', q.limit, CAP + 1);
  check('T1 本文 essay 列を読まない', !q.columns.includes('essay'), q.columns.join(','));
  check('T1 local_review_id を読む（device と共有される安定 id）', q.columns.includes('local_review_id'));
  eq('T1 capped(history) kind', isExamCappedSourceKind('statement_review'), true);
  check('T1 tutor は許可', sourcesForPurpose('tutor').includes('statement_review'));
  check('T1 essay_chat は不許可', !sourcesForPurpose('essay_chat').includes('statement_review'));
}

// ── 2. transport matrix（A〜M）────────────────────────────────────────
async function t2Transport(): Promise<void> {
  console.log('\n2. Transport matrix');

  // A. storage absent
  const a = await run({ serverItems: deviceHistory(3), deviceItems: null });
  eq('T2-A claim 無し → unclaimed', a.source?.syncStatus, 'unclaimed');
  eq('T2-A → unverified', a.source?.state, 'unverified');

  // B. canonical empty
  const b = await run({ serverItems: [], deviceItems: [] });
  eq('T2-B canonical 0 行 → empty', b.source?.state, 'empty');

  // C. 1 row
  const c1 = deviceHistory(1);
  const c = await run({ serverItems: c1, deviceItems: c1 });
  eq('T2-C 1 行 → verified', c.source?.syncStatus, 'verified');

  // D. exactly cap
  const d5 = deviceHistory(CAP);
  const d = await run({ serverItems: d5, deviceItems: d5 });
  eq('T2-D cap ちょうど → verified', d.source?.syncStatus, 'verified');
  eq('T2-D truncated は立たない', d.source?.truncated, false);

  // E. cap + 1（E-S43 window semantics）
  const e6 = deviceHistory(CAP + 1);
  const e = await run({ serverItems: e6, deviceItems: e6 });
  eq('T2-E cap+1 → available（unreadable にしない）', e.source?.state, 'available');
  eq('T2-E cap+1 → verified', e.source?.syncStatus, 'verified');
  eq('T2-E truncated 観測が残る', e.source?.truncated, true);

  // F. 200 rows
  const f200 = deviceHistory(200);
  const f = await run({ serverItems: f200, deviceItems: f200 });
  eq('T2-F 200 行 → verified', f.source?.syncStatus, 'verified');
  eq('T2-F rowCount は cap', f.source?.rowCount, CAP);

  // G. mismatch inside window
  const gServer = deviceHistory(20);
  const gDevice = deviceHistory(20, '★window 内で変更');
  const g = await run({ serverItems: gServer, deviceItems: gDevice });
  check('T2-G window 内の差異 → verified にならない', g.source?.syncStatus !== 'verified',
    String(g.source?.syncStatus));

  // H. difference outside window only
  const hServer = deviceHistory(20);
  const hDevice = [...deviceHistory(20)];
  hDevice[hDevice.length - 1] = review(1, ['★window 外だけ変更']);
  const h = await run({ serverItems: hServer, deviceItems: hDevice });
  eq('T2-H window 外だけの差異 → verified', h.source?.syncStatus, 'verified');

  // I. newest added → old claim mismatch / new claim match
  const before = deviceHistory(10);
  const after = deviceHistory(11);
  const oldClaim = deviceStatementReviewToken(before);
  const iOld = await run({ serverItems: after, claimOverride: oldClaim });
  check('T2-I 古い claim は verified にならない', iOld.source?.syncStatus !== 'verified');
  const iNew = await run({ serverItems: after, claimOverride: deviceStatementReviewToken(after) });
  eq('T2-I 新しい claim は verified', iNew.source?.syncStatus, 'verified');

  // J. malformed claim
  const j = parseDeviceClaimValue(JSON.stringify({ v: 'edc1', c: [{ kind: 'statement_review', token: 'bad' }] }));
  eq('T2-J 不正 token は通さない', Object.keys(j.claims), []);

  // K. actual query failure
  const k = await run({ serverItems: deviceHistory(3), deviceItems: deviceHistory(3),
    errors: { statement_review_history: { code: '42P01', message: 'x' } } });
  eq('T2-K query failure → unreadable', k.source?.state, 'unreadable');
  eq('T2-K sync 判定に進まない', k.source?.syncStatus, null);

  // L. token independence
  const basic = { name: 'N', grade: 'G', track: '文系', examTypes: [],
    preferences: [{ university: 'U', faculty: '', department: '' }] } as BasicInfo;
  const biBefore = deviceBasicInfoToken(basic);
  const srBefore = deviceStatementReviewToken(deviceHistory(10));
  check('T2-L statement_review 変更 → 自身の token 変化',
    deviceStatementReviewToken(deviceHistory(11)) !== srBefore);
  eq('T2-L statement_review 変更 → basic_info token 不変', deviceBasicInfoToken(basic), biBefore);

  // M. header boundedness
  const bytes = (n: number) => new TextEncoder().encode(
    serializeDeviceClaim(buildTutorDeviceClaimEntries(basic, null, null, null, deviceHistory(n))) ?? '').length;
  const b5 = bytes(5), b200 = bytes(200), b1000 = bytes(1000);
  console.log(`  info  header bytes: 5=${b5} 200=${b200} 1000=${b1000}`);
  eq('T2-M 件数に比例しない（5 == 200）', b5, b200);
  eq('T2-M 件数に比例しない（200 == 1000）', b200, b1000);
  check('T2-M 上限内', b1000 <= EXAM_DEVICE_CLAIM_MAX_BYTES, String(b1000));
  const header = serializeDeviceClaim(buildTutorDeviceClaimEntries(basic, null, null, null, deviceHistory(5)));
  for (const needle of [SECRET, '具体性が不足', '大学5', USER_A]) {
    check(`T2-M header に "${needle}" が出ない`, !(header ?? '').includes(needle));
  }
}

// ── 3. claim composition / purpose ────────────────────────────────────
function t3Claim(): void {
  console.log('\n3. Claim composition');
  const basic = { name: 'N', grade: 'G', track: '文系', examTypes: [],
    preferences: [{ university: 'U', faculty: '', department: '' }] } as BasicInfo;
  const before = serializeDeviceClaim(buildTutorDeviceClaimEntries(basic, null, null, null, null));
  const after = serializeDeviceClaim(buildTutorDeviceClaimEntries(basic, null, null, null, deviceHistory(5)));
  const pa = JSON.parse(after ?? '{}') as { c: { kind: string; token: string }[] };
  eq('T3 entry 順は宣言順', pa.c.map((e) => e.kind), ['basic_info', 'statement_review']);
  const pb = JSON.parse(before ?? '{}') as { c: { kind: string; token: string }[] };
  eq('T3 basic_info token 不変', pa.c[0].token, pb.c[0].token);

  const parsed = parseDeviceClaimValue(after);
  check('T3 parser が statement_review を通す', 'statement_review' in parsed.claims);
  const denied = toDeviceClaims(parsed, {
    authenticatedUserId: USER_A, allowedSources: sourcesForPurpose('essay_chat') });
  check('T3 許可しない purpose では落とす', !('statement_review' in denied));

  const spoof = parseDeviceClaimValue(JSON.stringify({ v: 'edc1',
    c: [{ kind: 'statement_review', token: 'efp1:' + 'a'.repeat(64), verified: true, table: 'profiles', userId: 'z' }] }));
  const flat = JSON.stringify(toDeviceClaims(spoof, {
    authenticatedUserId: USER_A, allowedSources: sourcesForPurpose('tutor') }));
  check('T3 verified / table / userId は無視',
    !flat.includes('"verified"') && !flat.includes('profiles') && !flat.includes('"z"'));

  // canonical device view と transport の一致
  const view = deviceStatementReviewView(deviceHistory(20));
  check('T3 canonical device view が成功', view.ok);
  if (view.ok) {
    const obs = examSyncObservation({ kind: 'statement_review', source: 'device_canonical', view: view.view });
    eq('T3 transport は canonical projection と同一 token',
      deviceStatementReviewToken(deviceHistory(20)), obs.fingerprint);
  }
}

// ── 4. semantic matrix（S1〜S5）───────────────────────────────────────
async function t4Semantics(): Promise<void> {
  console.log('\n4. Semantic matrix');

  const legacyLineOf = (items: readonly ReviewHistoryItem[]): string | null =>
    buildStatementWeaknessLine({ weaknesses: items[0]?.result?.weaknesses ?? [] });

  const cmpFor = async (items: readonly ReviewHistoryItem[]) => {
    const r = await run({ serverItems: items, deviceItems: items });
    const before = r.rec.trace.length;
    const cmp = compareTutorShadow({
      legacy: { statementWeaknessLine: legacyLineOf(items) },
      canonicalInput: r.resolved, context: r.ctx });
    return { r, cmp, extra: r.rec.trace.length - before,
      diff: cmp.entries.find((e) => e.field === 'statement_review.latestWeaknessLine'),
      repeated: cmp.entries.find((e) => e.field === 'statement_review.repeatedAdvice'),
      readiness: cmp.readiness.find((x) => x.kind === 'statement_review') };
  };

  // S1 — one meaningful record
  const s1 = await cmpFor(deviceHistory(1));
  check('S1 legacy は 1 件でも非空', legacyLineOf(deviceHistory(1)) !== null);
  eq('S1 canonical 相当射影も非空',
    typeof s1.r.resolved.statementWeaknessLine === 'string', true);
  eq('S1 legacy 相当射影は MATCH', s1.diff?.diff, 'MATCH');
  eq('S1 compare は追加 read を出さない', s1.extra, 0);
  // ★ canonical 固有の反復論点は 1 件では空（MIN_RECORDS=2）
  const s1Summary = buildPreviousOutputSummary([{ weaknesses: ['a'] }]);
  eq('S1 反復論点は 1 件では空（legacy と threshold が違う）', s1Summary.repeatedAdvice, []);

  // S2 — multiple records
  const s2 = await cmpFor(deviceHistory(3));
  eq('S2 3 件でも legacy 相当は MATCH', s2.diff?.diff, 'MATCH');
  eq('S2 反復論点は legacy に対応物が無い（INTENTIONALLY_OMITTED）',
    s2.repeated?.diff, 'INTENTIONALLY_OMITTED');

  // S3 — repeated weakness
  const rep = [review(3, ['具体性が不足']), review(2, ['構成が弱い']), review(1, ['具体性が不足'])];
  const s3 = await cmpFor(rep);
  eq('S3 legacy は最新 1 件のみ', legacyLineOf(rep), '具体性が不足');
  const s3Summary = buildPreviousOutputSummary(rep.map((r) => r.result));
  check('S3 canonical 反復論点は頻度順で複数を返す', s3Summary.repeatedAdvice.length >= 1,
    JSON.stringify(s3Summary.repeatedAdvice));
  check('S3 legacy と反復論点は別物（片方だけを見ても他方は再現できない）',
    JSON.stringify(s3Summary.repeatedAdvice) !== JSON.stringify([legacyLineOf(rep)]));
  eq('S3 legacy 相当射影は依然 MATCH', s3.diff?.diff, 'MATCH');

  // S4 — latest-only change
  const base4 = deviceHistory(5);
  const changed4 = [review(5, ['★最新だけ変更']), ...base4.slice(1)];
  eq('S4 legacy 結果が変わる', legacyLineOf(changed4) !== legacyLineOf(base4), true);
  check('S4 claim token も変わる',
    deviceStatementReviewToken(changed4) !== deviceStatementReviewToken(base4));
  const s4 = await cmpFor(changed4);
  eq('S4 変更後も legacy 相当は MATCH', s4.diff?.diff, 'MATCH');

  // S5 — historical-only change (inside window)
  const base5 = deviceHistory(5);
  const changed5 = [...base5.slice(0, 4), review(1, ['★古い方だけ変更'])];
  eq('S5 legacy 結果は変わらない（最新のみ参照）', legacyLineOf(changed5), legacyLineOf(base5));
  check('S5 だが claim token は変わる（window 内の差異）',
    deviceStatementReviewToken(changed5) !== deviceStatementReviewToken(base5));

  // meaningful + readiness
  const meaningful = [s1.diff, s2.diff, s3.diff].filter(
    (d) => d && (d.legacyFingerprint !== null || d.canonicalFingerprint !== null));
  check('S 全体 meaningful comparison が 1 件以上', meaningful.length >= 1, String(meaningful.length));
  eq('S 全体 meaningful MATCH なので transport 上は READY', s2.readiness?.readiness, 'READY');

  // false-empty guard
  const empty = await run({ serverItems: [], deviceItems: [] });
  const emptyCmp = compareTutorShadow({
    legacy: { statementWeaknessLine: null }, canonicalInput: empty.resolved, context: empty.ctx });
  eq('S 空同士では READY にしない（E-S42）',
    emptyCmp.readiness.find((x) => x.kind === 'statement_review')?.readiness, 'DEFERRED');

  // privacy
  check('S diff に本文が出ない', !JSON.stringify(s3.cmp).includes(SECRET));
  check('S canonical context に本文が出ない', !JSON.stringify(s3.r.ctx).includes(SECRET));

  // ★ mismatch path こそ値が漏れやすい（S5-P5 の負例 N5 で発見した失敗形）★
  //   MATCH 経路しか見ていない guard は、VALUE_MISMATCH の `reason` に legacy /
  //   canonical の実値を載せる変更をすり抜ける。statement_review は添削本文を
  //   持つ kind なので、ここを塞がないと raw content が telemetry へ出る。
  const mmItems = deviceHistory(5);
  const mmRun = await run({ serverItems: mmItems, deviceItems: mmItems });
  const PROBE = 'MISMATCH_PROBE_WEAKNESS';
  const mmCmp = compareTutorShadow({
    legacy: { statementWeaknessLine: PROBE },
    canonicalInput: mmRun.resolved, context: mmRun.ctx });
  const mmDiff = mmCmp.entries.find((e) => e.field === 'statement_review.latestWeaknessLine');
  eq('S mismatch は VALUE_MISMATCH になる', mmDiff?.diff, 'VALUE_MISMATCH');
  const mmJson = JSON.stringify(mmCmp);
  check('S mismatch 時も添削本文が出ない', !mmJson.includes(SECRET));
  check('S mismatch 時に legacy の実値が出ない', !mmJson.includes(PROBE));
  check('S mismatch 時に canonical の実値が出ない',
    !mmJson.includes(String(legacyLineOf(mmItems))));
  const mmToken = deviceStatementReviewToken(mmItems);
  check('S mismatch 時に claim token（fingerprint）が出ない',
    mmToken !== null && !mmJson.includes(mmToken));
  check('S mismatch 時に userId が出ない', !mmJson.includes(USER_A));
  //   reason は型上 enum だが、型を広げる変更が入っても runtime で落ちるようにする。
  const mmReasons = mmCmp.entries
    .map((e) => e.reason as unknown)
    .filter((r): r is string => typeof r === 'string');
  check('S reason は既知の enum 相当のみ',
    mmReasons.every((r) => /^[a-z_]+$/.test(r)), mmReasons.join(' | '));

  // ★ false-empty verified が成立しないこと（§false empty）★
  //   device に履歴があるのに server 側が読めない場合、"[] verified" になってはいけない。
  const failRun = await run({
    serverItems: mmItems, deviceItems: mmItems,
    errors: { statement_review_history: { code: '42P01', message: 'x' } },
  });
  eq('S read failure は unreadable（false-empty にしない）', failRun.source?.state, 'unreadable');
  check('S read failure では verified にならない', failRun.source?.syncStatus !== 'verified',
    String(failRun.source?.syncStatus));
  check('S read failure を empty と誤認しない', failRun.source?.state !== 'empty');
}

// ── 5. invariants ─────────────────────────────────────────────────────
async function t5Invariants(): Promise<void> {
  console.log('\n5. Invariants');
  const items = deviceHistory(20);
  const withClaim = await run({ serverItems: items, deviceItems: items });
  const without = await run({ serverItems: items, deviceItems: null });
  eq('T5 claim の有無で query 数が変わらない',
    withClaim.ctx.diagnostics.sourceQueryCount, without.ctx.diagnostics.sourceQueryCount);
  eq('T5 canonical query count は 10 のまま', withClaim.ctx.diagnostics.sourceQueryCount, 10);
  const q = withClaim.rec.trace.filter((t) => t.table === 'statement_review_history');
  eq('T5 statement_review の query は 1 本', q.length, 1);
  eq('T5 limit は cap+1 のまま', q[0].limit, CAP + 1);

  // shadow projection は prompt へ接続されない
  const proj = readFileSync(join(ROOT, 'lib/examSpine/context/shadow/statementReviewProjection.ts'), 'utf8');
  check('T5 projection は shadow 専用と明記', proj.includes('shadow') && proj.includes('E-S44'));
  const build = readFileSync(join(ROOT, 'lib/examSpine/blocks/build.ts'), 'utf8');
  check('T5 block builder が legacy 相当射影を参照しない',
    !build.includes('statementWeaknessLine'));
  const input = readFileSync(join(ROOT, 'lib/examSpine/orchestrator/input.ts'), 'utf8');
  check('T5 ExamContextInput に shadow slot が漏れていない',
    !input.includes('statementWeaknessLine'));

  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  // ★ S5-P9: consumer path 全体を見る（stage5-2〜5-5 と同一の retarget）★
  //   本 lineage では prompt 合成が `composeTutorPrompt`（純関数）へ抽出済みで、
  //   body 経路の組み立ては route ではなくそちらにある。不変条件は
  //   「legacy の body 経路が今も組み立てられていること」なので、route 単体ではなく
  //   consumer path（route + composeTutorPrompt）を対象にし、import 行を除いた本体で
  //   **呼び出し形** を検査する（単なる出現検査は呼び出しの差し替えを見逃す）。
  const consumerPath = [route, readFileSync(join(ROOT, 'lib/tutor/composeTutorPrompt.ts'), 'utf8')]
    .map((src) => src.split('\n').filter((l) => !/^\s*import /.test(l)).join('\n'))
    .join('\n');
  //   ★ 名前は exact で見る ★ `\w*` の緩い一致は改名（…SectionX）を素通りさせる（実測）。
  const legacyBodyCalls: ReadonlyArray<readonly [string, string]> = [
    ['buildTutorStudentContext', 'lib/contextBuilders/tutorStudentContext.ts'],
    ['buildTutorStudentContextSection', 'lib/tutor/tutorPrompt.ts'],
  ];
  for (const [name, file] of legacyBodyCalls) {
    check(`T5 legacy の body 経路が残っている: ${name}`,
      new RegExp(`(?<![\\w$])${name}\\s*\\(`).test(consumerPath));
    check(`T5 legacy の body 経路 builder が実体として存在する: ${name}`,
      readFileSync(join(ROOT, file), 'utf8').includes(`export function ${name}(`));
  }
  // ★ 修正（S5-P8 promotion）★ source 側は route.indexOf('buildTutorUserPrompt') を
  //   anchor に ±1500 字 window を見ていた。この識別子は file 冒頭の見出しコメントにも
  //   現れるため window が file 先頭に張られ、実際の prompt 経路を検査できていない
  //   （S5-P4/P5/P6/P7 で 5.2/5.3/5.4/5.5 側に見つかったのと同じ defect。5 回目）。
  const routeCode = route
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  // ★ S5-P9: 実在する組み立て呼び出しのうち最も早いものへ anchor を広げた ★
  //   `= buildTutorUserPrompt(` 固定では、prompt 合成が composeTutorPrompt へ抽出された
  //   本 lineage で anchor が消えて検査が空回りする（検査範囲は広がる方向）。
  const promptAnchors = ['= composeTutorPrompt(', '= buildTutorUserPrompt(']
    .map((a) => routeCode.indexOf(a))
    .filter((i) => i !== -1);
  const promptIdx = promptAnchors.length > 0 ? Math.min(...promptAnchors) : -1;
  check('T5 prompt 組み立て位置を特定できる', promptIdx !== -1);
  if (promptIdx !== -1) {
    const afterPrompt = routeCode.slice(promptIdx);
    check('T5 prompt 以降に shadowResolvedInput が現れない',
      !afterPrompt.includes('shadowResolvedInput'));
    check('T5 prompt 以降に statementWeaknessLine が現れない',
      !afterPrompt.includes('statementWeaknessLine'));
    check('T5 prompt 以降に compareTutorShadow が現れない',
      !afterPrompt.includes('compareTutorShadow'));
    check('T5 prompt 以降に canonical block 配列が現れない',
      !/\.context\??\.blocks/.test(afterPrompt));
    check('T5 prompt 以降に previousOutputSummary が現れない',
      !afterPrompt.includes('previousOutputSummary'));
  }

  // legacy 相当射影が canonical rows から作れること（直接呼び出し）
  const line = projectStatementReviewLegacyLine([
    { localReviewId: 'x', university: 'U', faculty: 'F', department: 'D',
      result: { weaknesses: ['具体性が不足', '構成が弱い', '3つ目'] }, id: 'db-x', createdAt: 'z' } as never,
  ]);
  eq('T5 射影は先頭 2 件を ” / ” で連結（legacy と同じ正規化）', line, '具体性が不足 / 構成が弱い');
  eq('T5 rows が空なら null', projectStatementReviewLegacyLine([]), null);
  eq('T5 rows が null なら null', projectStatementReviewLegacyLine(null), null);
}


// ── 6. Stage 5.6 boundary / block / tie-break parity ────────────────────
//
//   Stage 5.6 は statement_review の **transport**（claim + window parity）だけを
//   昇格する packet である。source lineage には 5.7（interview_record）/ essay /
//   presentation が続いており混入しやすい。
//
//   ★ transport READY と semantics READY を混同しない ★
//     legacy は「最新 1 件の課題」、canonical は「履歴の反復論点」で、選択・集約・
//     下限がすべて違う（E-S49 classification C）。どちらを採るかは product 判断で
//     あり本 Stage では決めない。したがって tutor-facing canonical block は作らない。
function t6Boundary(): void {
  console.log('\n6. Stage 5.6 boundary');

  // (a) claim kind は 5.1-5.6 の 5 つだけ（実ソースから抽出 / arity 非依存）。
  const claimFile = readFileSync(
    join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8');
  const fnIdx = claimFile.indexOf('export function buildTutorDeviceClaimEntries(');
  check('T6 claim 組み立て関数を特定できる', fnIdx !== -1);
  const kinds = Array.from(
    claimFile.slice(Math.max(fnIdx, 0)).matchAll(/entries\.push\(\{\s*kind:\s*'([a-z_]+)'/g),
  ).map((m) => m[1]).sort();
  eq('T6 tutor の claim kind は 5.1-5.6 の 5 つのみ', kinds,
    ['activity', 'basic_info', 'diagnosis', 'self_analysis', 'statement_review']);

  // (b) device window primitive は self_analysis + statement_review のみ。
  //     Stage 5.7 以降（self_pr / interview_record / essay）へ広げない。
  const deviceViews = readFileSync(
    join(ROOT, 'lib/examSpine/sync/adapters/deviceViews.ts'), 'utf8');
  const windowed = ['deviceSelfAnalysisView', 'deviceStatementReviewView', 'deviceSelfPrView',
    'deviceInterviewRecordView', 'deviceEssayView'].filter((fn) => {
    const i = deviceViews.indexOf(`export function ${fn}(`);
    return i !== -1 && deviceViews.slice(i, i + 400).includes('selectDeviceSyncWindow');
  }).sort();
  eq('T6 window primitive は self_analysis + statement_review のみ', windowed,
    ['deviceSelfAnalysisView', 'deviceStatementReviewView']);

  // (c) ★ tutor-facing canonical block を作っていない（§Canonical block boundary）★
  const registry = readFileSync(join(ROOT, 'lib/examSpine/blocks/registry.ts'), 'utf8');
  for (const forbidden of ['statement_review_tutor', 'statement_review_summary',
    'statement_review_history', 'statement_weakness_line',
    'self_analysis_tutor', 'self_analysis_summary_line', 'interview_issue_line']) {
    check(`T6 block \`${forbidden}\` は追加されていない`, !registry.includes(`${forbidden}:`));
  }
  //     tutor plan は 5.1 + 5.2 + 5.3 の 3 block のまま（5.4/5.5/5.6 は block を足さない）。
  const tutorBlocks = EXAM_PURPOSE_PLANS.tutor.blocks.map((b) => b.id);
  eq('T6 tutor plan の block は 3 つのまま', tutorBlocks,
    ['tutor_student_context', 'diagnosis_type_hint', 'activity_category_counts']);

  // (d) consumer switch が動いていない。
  const entry = readFileSync(
    join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_STAGE5_ENTRY.md'), 'utf8');
  check('T6 FIRST_STAGE5_CONSUMER=tutor のまま',
    /FIRST_STAGE5_CONSUMER\s*=\s*tutor\b/.test(entry));
  check('T6 FIRST_STAGE5_SLOT=basic_info のまま',
    /FIRST_STAGE5_SLOT\s*=\s*basic_info\b/.test(entry));

  // (e) Stage 5.5 の opt-in 契約が維持されている（truncated は無条件 readable ではない）。
  const adapterTypes = readFileSync(
    join(ROOT, 'lib/examSpine/sync/adapters/types.ts'), 'utf8');
  const smcIdx = adapterTypes.indexOf('export function serverMirrorCandidate(');
  const smcBody = smcIdx === -1 ? '' : adapterTypes.slice(smcIdx, smcIdx + 1200);
  check('T6 windowed は opt-in のまま（既定 strict）', /input\.windowed === true/.test(smcBody));
  const assembler = readFileSync(
    join(ROOT, 'lib/examSpine/context/assemble.server.ts'), 'utf8');
  check('T6 windowed の付与は capped kind に限定されている',
    /windowed: isExamCappedSourceKind\(kind\)/.test(assembler));
  check('T6 実際の失敗（error / skipped）は unreadable のまま',
    /readStatus === 'error' \|\| readStatus === 'skipped'/.test(assembler));

  // (f) ★ tie-break parity（E-S50）★
  //     server は created_at DESC → id DESC。device view は DB id を持たないが、
  //     statement_review の item view は localReviewId（両側で共有される安定 id）を
  //     含むため、選ばれた集合が同じなら fingerprint は必ず一致する。
  const q = Q.statementReviewQuery('00000000-0000-4000-8000-000000000000');
  eq('T6 server ordering は created_at DESC → id DESC',
    q.order, [{ column: 'created_at', ascending: false }, { column: 'id', ascending: false }]);
  eq('T6 limit は cap + 1', q.limit, EXAM_READ_CAPS.statement_review + 1);
  check('T6 device item view は localReviewId を含む（安定 id）',
    deviceViews.includes('deviceStatementReviewItemView'));
  const rowSrc = readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/views.ts'), 'utf8');
  const svIdx = rowSrc.indexOf('export function statementReviewItemView');
  check('T6 statementReviewItemView が localReviewId を持つ',
    svIdx !== -1 && rowSrc.slice(svIdx, svIdx + 500).includes('localReviewId'));
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5.6] statement_review claim + semantic convergence');
  t1Authority();
  await t2Transport();
  t3Claim();
  await t4Semantics();
  await t5Invariants();
  t6Boundary();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage5.6] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1; return;
  }
  console.log(`\n[exam-spine-stage5.6] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-stage5.6] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage5.6] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1; return;
  }
  console.log('[exam-spine-stage5.6] PASS');
}
void main();
