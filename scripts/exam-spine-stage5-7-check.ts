// Exam Spine — Stage 5.7 interview_record claim wiring + canonical Tutor block（G5）。
//
// ★ 3 つの verdict を混ぜない ★
//   transport（fingerprint が一致するか）/ semantics（legacy が prompt に出している
//   表現を canonical が再現できるか）/ block（canonical block が正しく建つか）は
//   別問題である。1 つの PASS に潰すと「移行できる」という誤った結論になる。
//
// ★ 本 Stage で **成立してはいけない**こと ★
//   canonical block が production の tutor prompt へ到達すること。§5 で検査する。

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let fetchCallCount = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage5.7] 外部通信: ${String(args[0])}`);
}) as typeof realFetch;

import type { StoredInterviewRecord } from '@/lib/interviewRecordStorage';
import type { BasicInfo } from '@/types/basicInfo';
import { buildInterviewLine } from '@/lib/contextBuilders/tutorStudentContext';
import {
  buildTutorDeviceClaimEntries,
  deviceBasicInfoToken,
  deviceInterviewRecordToken,
} from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import { deviceInterviewRecordView } from '@/lib/examSpine/sync/adapters/deviceViews';
import { examSyncObservation } from '@/lib/examSpine/sync/adapters/views';
import { serializeDeviceClaim } from '@/lib/examSpine/sync/claim/serialize';
import { parseDeviceClaimValue, toDeviceClaims } from '@/lib/examSpine/sync/claim/parse';
import { EXAM_DEVICE_CLAIM_MAX_BYTES } from '@/lib/examSpine/sync/claim/types';
import { EXAM_READ_CAPS, isExamCappedSourceKind } from '@/lib/examSpine/read/types';
import { buildCanonicalExamContext } from '@/lib/examSpine/context/assemble.server';
import { compareTutorShadow } from '@/lib/examSpine/context/shadow/compareTutor';
import { projectInterviewIssueLine } from '@/lib/examSpine/context/interviewRecordProjection';
import { EXAM_CONTEXT_BLOCK_IDS } from '@/lib/examSpine/blocks/types';
import { EXAM_CONTEXT_BLOCK_REGISTRY } from '@/lib/examSpine/blocks/registry';
import { getExamPurposePlan } from '@/lib/examSpine/orchestrator/plan';
import { sourcesForPurpose } from '@/lib/examSpine/purpose';
import * as Q from '@/lib/examSpine/read/queries';
import type { ExamRequestAuthorization } from '@/lib/examSpine/read/requestSnapshot.server';
import { createRecordingExecutor, USER_A, type FakeDb } from './fixtures/examSpineStage3';

const ROOT = process.cwd();

/** `export function <name>(` から次の `export function` 直前までを切り出す。 */
function fnBody(src: string, name: string): string {
  const i = src.indexOf(`export function ${name}(`);
  if (i === -1) return '';
  const next = src.indexOf('\nexport function ', i + 1);
  return next === -1 ? src.slice(i) : src.slice(i, next);
}
let passed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) passed += 1;
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
function eq(label: string, a: unknown, e: unknown): void {
  check(label, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
}

const CAP = EXAM_READ_CAPS.interview_record;
// 逐語（questions_asked / my_answers）と面接官コメントは prompt へ出てはいけない。
const VERBATIM = 'VERBATIM_QA_SECRET_TEXT';

type RecOpts = {
  improvements?: string[] | null;
  improvementSummary?: string;
  whatWentWrong?: string;
  brokenJson?: boolean;
};

function rec(n: number, opts: RecOpts = {}): StoredInterviewRecord {
  const improvements = opts.improvements;
  const feedbackJson =
    opts.brokenJson ? '{ not json'
      : improvements === null ? undefined
        : JSON.stringify({
            improvements: improvements ?? [`改善${n}`],
            perQuestionFeedback: [], followUpQuestions: [],
          });
  return {
    id: `ir-${n}`,
    practiceDate: `2026-03-${String((n % 28) + 1).padStart(2, '0')}`,
    universityName: `大学${n}`, facultyName: `学部${n}`, examType: '総合型',
    mainQuestion: VERBATIM,
    questionsAsked: VERBATIM, myAnswers: VERBATIM,
    improvementSummary: opts.improvementSummary ?? `自己記録の課題${n}`,
    whatWentWrong: opts.whatWentWrong ?? `うまくいかなかった点${n}`,
    feedbackReceived: VERBATIM, selfNoted: VERBATIM,
    createdAt: `2026-04-01T00:00:${String(n % 60).padStart(2, '0')}.${String(n % 1000).padStart(3, '0')}Z`,
    updatedAt: `2026-04-01T00:00:${String(n % 60).padStart(2, '0')}.${String(n % 1000).padStart(3, '0')}Z`,
    ...(feedbackJson === undefined ? {} : { feedbackJson }),
  } as unknown as StoredInterviewRecord;
}

/** device: newest-first（addInterviewRecord は [new, ...current]）。 */
function deviceRecords(count: number, top: RecOpts = {}): StoredInterviewRecord[] {
  const out: StoredInterviewRecord[] = [];
  for (let n = count; n >= 1; n -= 1) out.push(rec(n, n === count ? top : {}));
  return out;
}

function parseFeedbackOrNull(raw: string | undefined): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

function serverRows(items: readonly StoredInterviewRecord[]): Record<string, unknown>[] {
  return [...items]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((i) => ({
      id: `db-${i.id}`, user_id: USER_A, local_record_id: i.id,
      practice_date: i.practiceDate ?? '', university_name: i.universityName ?? '',
      faculty_name: i.facultyName ?? '', exam_type: i.examType ?? '',
      main_question: i.mainQuestion ?? '',
      improvement_summary: i.improvementSummary ?? '', what_went_wrong: i.whatWentWrong ?? '',
      feedback_received: i.feedbackReceived ?? '', self_noted: i.selfNoted ?? '',
      // server は jsonb を持つ。device 側が壊れた文字列を持っていても
      // server 行は「解釈可能な値 or null」であり、そこは device の問題ではない。
      feedback_json: parseFeedbackOrNull(i.feedbackJson),
      created_at: i.createdAt,
    }));
}

/** client（app/tutor/page.tsx:423-436）が body に載せている 2 値を再現する。 */
function legacyBody(items: readonly StoredInterviewRecord[]): {
  recordLatest: unknown; feedbackLatest: unknown;
} {
  const latest = items[0] ?? null;
  if (!latest) return { recordLatest: null, feedbackLatest: null };
  let feedbackLatest: unknown = null;
  if (latest.feedbackJson) {
    try {
      const parsed = JSON.parse(latest.feedbackJson) as { improvements?: unknown };
      if (Array.isArray(parsed.improvements)) feedbackLatest = { improvements: parsed.improvements };
    } catch { feedbackLatest = null; }
  }
  return {
    recordLatest: { improvementSummary: latest.improvementSummary ?? '', whatWentWrong: latest.whatWentWrong ?? '' },
    feedbackLatest,
  };
}

function legacyLineOf(items: readonly StoredInterviewRecord[]): string | null {
  const b = legacyBody(items);
  return buildInterviewLine(b.feedbackLatest, b.recordLatest);
}

const authorizeA = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A });

async function run(opts: {
  serverItems: readonly StoredInterviewRecord[];
  deviceItems?: readonly StoredInterviewRecord[] | null;
  claimOverride?: string | null;
  errors?: Record<string, { code: string; message: string }>;
  purpose?: 'tutor' | 'essay_chat';
}) {
  const database = { tables: { interview_practice_records: serverRows(opts.serverItems) } } as FakeDb;
  if (opts.errors) (database as FakeDb).errors = opts.errors;
  const recorder = createRecordingExecutor(database);
  const token = opts.claimOverride !== undefined ? opts.claimOverride
    : opts.deviceItems === null ? null : deviceInterviewRecordToken(opts.deviceItems ?? []);
  const r = await buildCanonicalExamContext({
    request: new Request('https://example.test/s57/' + Math.random().toString(36).slice(2)),
    purpose: opts.purpose ?? 'tutor',
    authorize: authorizeA,
    bridge: {},
    deviceClaims: token === null ? undefined
      : ({ interview_record: { presented: true, fingerprint: token } } as never),
    executor: recorder.executor,
    projectionNow: '2026-01-01T00:00:00.000Z',
  });
  if (!r.ok) throw new Error('veto: ' + r.veto.reasons.join(','));
  return { ctx: r.context, rec: recorder, resolved: r.shadowResolvedInput,
    source: r.context.sources.find((s) => s.kind === 'interview_record'),
    block: r.context.blocks.find((b) => b.id === 'interview_issue_line') };
}

// ── 1. authority ──────────────────────────────────────────────────────
function t1Authority(): void {
  console.log('\n1. Authority');
  const q = Q.interviewRecordQuery('00000000-0000-4000-8000-000000000000');
  eq('T1 table', q.table, 'interview_practice_records');
  eq('T1 mode は many', q.mode, 'many');
  eq('T1 ordering', q.order.map((o) => `${o.column}:${o.ascending ? 'asc' : 'desc'}`),
    ['created_at:desc', 'id:desc']);
  eq('T1 limit は cap+1', q.limit, CAP + 1);
  check('T1 逐語 questions_asked を読まない', !q.columns.includes('questions_asked'), q.columns.join(','));
  check('T1 逐語 my_answers を読まない', !q.columns.includes('my_answers'));
  check('T1 local_record_id を読む（device と共有される安定 id）', q.columns.includes('local_record_id'));
  check('T1 feedback_json を読む（legacy 優先順位 1 の材料）', q.columns.includes('feedback_json'));
  eq('T1 capped(history) kind', isExamCappedSourceKind('interview_record'), true);
  check('T1 tutor は許可', sourcesForPurpose('tutor').includes('interview_record'));
  check('T1 essay_chat は不許可', !sourcesForPurpose('essay_chat').includes('interview_record'));

  // ★ 前提の訂正（E-S46）★ legacy の 2 入力は同じ 1 レコード由来である。
  const page = readFileSync(join(ROOT, 'app/tutor/page.tsx'), 'utf8');
  const idx = page.indexOf('getInterviewRecords()[0]');
  check('T1 client は getInterviewRecords()[0] を使う', idx !== -1);
  const window = page.slice(idx, idx + 700);
  check('T1 interviewRecordLatest は同じ record 由来', window.includes('interviewRecordLatest'));
  check('T1 interviewFeedbackLatest も同じ record の feedbackJson 由来',
    window.includes('interviewFeedbackLatest') && window.includes('feedbackJson'));
}

// ── 2. transport matrix（A〜N）────────────────────────────────────────
async function t2Transport(): Promise<void> {
  console.log('\n2. Transport matrix');

  // A. storage absent
  const a = await run({ serverItems: deviceRecords(3), deviceItems: null });
  eq('T2-A claim 無し → unclaimed', a.source?.syncStatus, 'unclaimed');
  eq('T2-A → unverified', a.source?.state, 'unverified');

  // B. canonical empty
  const b = await run({ serverItems: [], deviceItems: [] });
  eq('T2-B canonical 0 行 → empty', b.source?.state, 'empty');

  // C. 1 row
  const c1 = deviceRecords(1);
  const c = await run({ serverItems: c1, deviceItems: c1 });
  eq('T2-C 1 行 → verified', c.source?.syncStatus, 'verified');

  // D. exactly cap
  const d = await run({ serverItems: deviceRecords(CAP), deviceItems: deviceRecords(CAP) });
  eq('T2-D cap ちょうど → verified', d.source?.syncStatus, 'verified');
  eq('T2-D truncated は立たない', d.source?.truncated, false);

  // E. cap + 1（E-S43 window semantics）
  const e = await run({ serverItems: deviceRecords(CAP + 1), deviceItems: deviceRecords(CAP + 1) });
  eq('T2-E cap+1 → available（unreadable にしない）', e.source?.state, 'available');
  eq('T2-E cap+1 → verified', e.source?.syncStatus, 'verified');
  eq('T2-E truncated 観測が残る', e.source?.truncated, true);

  // F. 200 rows
  const f = await run({ serverItems: deviceRecords(200), deviceItems: deviceRecords(200) });
  eq('T2-F 200 行 → verified', f.source?.syncStatus, 'verified');
  eq('T2-F rowCount は cap', f.source?.rowCount, CAP);

  // G. mismatch inside window
  const g = await run({ serverItems: deviceRecords(20),
    deviceItems: deviceRecords(20, { improvementSummary: '★window 内で変更' }) });
  check('T2-G window 内の差異 → verified にならない', g.source?.syncStatus !== 'verified',
    String(g.source?.syncStatus));

  // H. difference outside window only
  const hDevice = [...deviceRecords(20)];
  hDevice[hDevice.length - 1] = rec(1, { improvementSummary: '★window 外だけ変更' });
  const h = await run({ serverItems: deviceRecords(20), deviceItems: hDevice });
  eq('T2-H window 外だけの差異 → verified', h.source?.syncStatus, 'verified');

  // I. newest added
  const iOld = await run({ serverItems: deviceRecords(11),
    claimOverride: deviceInterviewRecordToken(deviceRecords(10)) });
  check('T2-I 古い claim は verified にならない', iOld.source?.syncStatus !== 'verified');
  const iNew = await run({ serverItems: deviceRecords(11),
    claimOverride: deviceInterviewRecordToken(deviceRecords(11)) });
  eq('T2-I 新しい claim は verified', iNew.source?.syncStatus, 'verified');

  // J. malformed claim
  const j = parseDeviceClaimValue(JSON.stringify({ v: 'edc1', c: [{ kind: 'interview_record', token: 'bad' }] }));
  eq('T2-J 不正 token は通さない', Object.keys(j.claims), []);

  // K. actual query failure
  const k = await run({ serverItems: deviceRecords(3), deviceItems: deviceRecords(3),
    errors: { interview_practice_records: { code: '42P01', message: 'x' } } });
  eq('T2-K query failure → unreadable', k.source?.state, 'unreadable');
  eq('T2-K sync 判定に進まない', k.source?.syncStatus, null);

  // L. token independence
  const basic = { name: 'N', grade: 'G', track: '文系', examTypes: [],
    preferences: [{ university: 'U', faculty: '', department: '' }] } as BasicInfo;
  const biBefore = deviceBasicInfoToken(basic);
  const irBefore = deviceInterviewRecordToken(deviceRecords(10));
  check('T2-L interview_record 変更 → 自身の token 変化',
    deviceInterviewRecordToken(deviceRecords(11)) !== irBefore);
  eq('T2-L interview_record 変更 → basic_info token 不変', deviceBasicInfoToken(basic), biBefore);

  // M. header boundedness
  const bytes = (n: number) => new TextEncoder().encode(
    serializeDeviceClaim(buildTutorDeviceClaimEntries(basic, null, null, null, null, deviceRecords(n))) ?? '').length;
  const b5 = bytes(5), b200 = bytes(200), b1000 = bytes(1000);
  console.log(`  info  header bytes: 5=${b5} 200=${b200} 1000=${b1000}`);
  eq('T2-M 件数に比例しない（5 == 200）', b5, b200);
  eq('T2-M 件数に比例しない（200 == 1000）', b200, b1000);
  check('T2-M 上限内', b1000 <= EXAM_DEVICE_CLAIM_MAX_BYTES, String(b1000));
  const header = serializeDeviceClaim(
    buildTutorDeviceClaimEntries(basic, null, null, null, null, deviceRecords(5)));
  for (const needle of [VERBATIM, '自己記録の課題5', '大学5', USER_A]) {
    check(`T2-M header に "${needle}" が出ない`, !(header ?? '').includes(needle));
  }

  // N. 壊れた feedbackJson は fail-closed（unclaimed へ倒す。壊れた値で verified を作らない）
  const broken = [rec(2, { brokenJson: true }), rec(1)];
  eq('T2-N 壊れた feedbackJson → token なし', deviceInterviewRecordToken(broken), null);
  const n = await run({ serverItems: broken, deviceItems: broken });
  eq('T2-N → unclaimed（mismatch ではない）', n.source?.syncStatus, 'unclaimed');
}

// ── 3. claim composition / purpose ────────────────────────────────────
function t3Claim(): void {
  console.log('\n3. Claim composition');
  const basic = { name: 'N', grade: 'G', track: '文系', examTypes: [],
    preferences: [{ university: 'U', faculty: '', department: '' }] } as BasicInfo;
  const after = serializeDeviceClaim(
    buildTutorDeviceClaimEntries(basic, null, null, null, null, deviceRecords(5)));
  const before = serializeDeviceClaim(buildTutorDeviceClaimEntries(basic, null, null, null, null, null));
  const pa = JSON.parse(after ?? '{}') as { c: { kind: string; token: string }[] };
  eq('T3 entry 順は宣言順', pa.c.map((e) => e.kind), ['basic_info', 'interview_record']);
  const pb = JSON.parse(before ?? '{}') as { c: { kind: string; token: string }[] };
  eq('T3 basic_info token 不変', pa.c[0].token, pb.c[0].token);

  const parsed = parseDeviceClaimValue(after);
  check('T3 parser が interview_record を通す', 'interview_record' in parsed.claims);
  const denied = toDeviceClaims(parsed, {
    authenticatedUserId: USER_A, allowedSources: sourcesForPurpose('essay_chat') });
  check('T3 許可しない purpose では落とす', !('interview_record' in denied));

  const spoof = parseDeviceClaimValue(JSON.stringify({ v: 'edc1',
    c: [{ kind: 'interview_record', token: 'efp1:' + 'a'.repeat(64), verified: true, table: 'profiles', userId: 'z' }] }));
  const flat = JSON.stringify(toDeviceClaims(spoof, {
    authenticatedUserId: USER_A, allowedSources: sourcesForPurpose('tutor') }));
  check('T3 verified / table / userId は無視',
    !flat.includes('"verified"') && !flat.includes('profiles') && !flat.includes('"z"'));

  // canonical device view と transport の一致（dual authority を作らない）
  const view = deviceInterviewRecordView(deviceRecords(20));
  check('T3 canonical device view が成功', view.ok);
  if (view.ok) {
    const obs = examSyncObservation({ kind: 'interview_record', source: 'device_canonical', view: view.view });
    eq('T3 transport は canonical projection と同一 token',
      deviceInterviewRecordToken(deviceRecords(20)), obs.fingerprint);
  }
  // window は projection 側が掛ける（transport で二重 cap にしない）。
  // ★ 同じ「上位 N 件」を保ったまま **古い側だけ**を増やす ★
  //   deviceRecords(n) は最新が n 番なので、件数を変えると window の中身ごと
  //   変わってしまう。ここでは base の末尾に古い record を足して検証する。
  const base = deviceRecords(CAP + 1);
  const older = (k: number): StoredInterviewRecord[] => [
    ...base,
    ...Array.from({ length: k }, (_, i) => rec(-(i + 1), { improvementSummary: `古い${i}` })),
  ];
  eq('T3 window 外の追加は token を変えない',
    deviceInterviewRecordToken(older(3)), deviceInterviewRecordToken(older(7)));
  check('T3 window 内の追加は token を変える',
    deviceInterviewRecordToken([rec(CAP + 99), ...base]) !== deviceInterviewRecordToken(base));
}

// ── 4. semantic matrix（S1〜S6）───────────────────────────────────────
async function t4Semantics(): Promise<void> {
  console.log('\n4. Semantic matrix');

  const cmpFor = async (items: readonly StoredInterviewRecord[]) => {
    const r = await run({ serverItems: items, deviceItems: items });
    const before = r.rec.trace.length;
    const cmp = compareTutorShadow({
      legacy: { interviewIssueLine: legacyLineOf(items), ...legacyBody(items) },
      canonicalInput: r.resolved, context: r.ctx });
    return { r, cmp, extra: r.rec.trace.length - before,
      diff: cmp.entries.find((e) => e.field === 'interview_record.issueLine'),
      aiEntry: cmp.entries.find((e) => e.field === 'interview_ai.feedbackLatest'),
      readiness: cmp.readiness.find((x) => x.kind === 'interview_record') };
  };

  // S1 — AI フィードバックあり（優先順位 1）
  const s1Items = deviceRecords(1, { improvements: ['結論を先に述べる', '具体例を1つ足す'] });
  eq('S1 legacy は improvements を採用', legacyLineOf(s1Items), '結論を先に述べる / 具体例を1つ足す');
  const s1 = await cmpFor(s1Items);
  eq('S1 canonical block も同値', s1.r.block?.content, legacyLineOf(s1Items));
  eq('S1 MATCH', s1.diff?.diff, 'MATCH');
  eq('S1 compare は追加 read を出さない', s1.extra, 0);

  // S2 — feedbackJson 無し → 自己記録へフォールバック（優先順位 2）
  const s2Items = deviceRecords(1, { improvements: null,
    improvementSummary: '自己記録の課題A', whatWentWrong: 'うまくいかなかったB' });
  eq('S2 legacy は自己記録 2 件を連結', legacyLineOf(s2Items), '自己記録の課題A / うまくいかなかったB');
  const s2 = await cmpFor(s2Items);
  eq('S2 canonical も同じ優先順位で落ちる', s2.r.block?.content, legacyLineOf(s2Items));
  eq('S2 MATCH', s2.diff?.diff, 'MATCH');

  // S3 — improvements が空配列 → 優先順位 2 へ落ちる
  const s3Items = deviceRecords(1, { improvements: [], improvementSummary: '自己記録のみ', whatWentWrong: '' });
  eq('S3 legacy は自己記録へフォールバック', legacyLineOf(s3Items), '自己記録のみ');
  const s3 = await cmpFor(s3Items);
  eq('S3 MATCH', s3.diff?.diff, 'MATCH');

  // S4 — 何も無ければ行を出さない（代替文言を作らない）
  const s4Items = deviceRecords(1, { improvements: null, improvementSummary: '', whatWentWrong: '' });
  eq('S4 legacy は null', legacyLineOf(s4Items), null);
  const s4 = await cmpFor(s4Items);
  eq('S4 canonical block も出ない', s4.r.block?.presence, 'missing');
  eq('S4 双方空 → MATCH（値の捏造をしない）', s4.diff?.diff, 'MATCH');

  // S5 — 最新 1 件のみ参照する（履歴は見ない）
  const s5Base = deviceRecords(5, { improvements: ['最新の課題'] });
  const s5Changed = [s5Base[0], ...deviceRecords(5).slice(1).map((_, i) => rec(i + 1, { improvementSummary: '★古い方だけ変更' }))];
  eq('S5 legacy 結果は変わらない（最新のみ参照）', legacyLineOf(s5Changed), legacyLineOf(s5Base));
  check('S5 だが claim token は変わる（window 内の差異）',
    deviceInterviewRecordToken(s5Changed) !== deviceInterviewRecordToken(s5Base));
  const s5 = await cmpFor(s5Base);
  eq('S5 MATCH', s5.diff?.diff, 'MATCH');

  // S6 — 正規化 cap（3 件 / 80 字 / 500 字）を legacy と共有している
  const long = 'あ'.repeat(200);
  const s6Items = deviceRecords(1, { improvements: [long, 'b', 'c', 'd'] });
  const s6Line = legacyLineOf(s6Items) ?? '';
  eq('S6 先頭 3 件だけ（4 件目 d を含まない）', s6Line.includes('d'), false);
  eq('S6 各項目 80 字で切る', s6Line.split(' / ')[0].length <= 80 + 1, true);
  const s6 = await cmpFor(s6Items);
  eq('S6 canonical block も同じ整形（二重 truncate をしない）', s6.r.block?.content, s6Line);
  eq('S6 MATCH', s6.diff?.diff, 'MATCH');

  // readiness / false-empty guard
  eq('S 全体 meaningful MATCH なので readiness は READY', s1.readiness?.readiness, 'READY');
  const empty = await run({ serverItems: [], deviceItems: [] });
  const emptyCmp = compareTutorShadow({
    legacy: { interviewIssueLine: null }, canonicalInput: empty.resolved, context: empty.ctx });
  eq('S 空同士では READY にしない（E-S42）',
    emptyCmp.readiness.find((x) => x.kind === 'interview_record')?.readiness, 'DEFERRED');

  // ★ interview_ai は依然 legacy 対応物なし（E-S46 の訂正）★
  eq('S interview_ai は INTENTIONALLY_OMITTED のまま', s1.aiEntry?.diff, 'INTENTIONALLY_OMITTED');
  eq('S interview_ai に legacy 値を置かない（誤った表を作らない）', s1.aiEntry?.legacyFingerprint, null);

  // privacy
  check('S diff に逐語が出ない', !JSON.stringify(s1.cmp).includes(VERBATIM));
  check('S canonical context に逐語が出ない', !JSON.stringify(s1.r.ctx).includes(VERBATIM));

  // ★ mismatch path こそ値が漏れやすい（S5-P5 の負例 N5 で発見した失敗形）★
  //   MATCH 経路しか見ていない guard は、VALUE_MISMATCH の `reason` に legacy /
  //   canonical の実値を載せる変更をすり抜ける。interview_record は逐語（質問文 /
  //   回答 / feedback 本文）を持つ kind なので、ここを塞がないと transcript が漏れる。
  const mmItems = deviceRecords(5, { improvements: ['結論を先に'] });
  const mmRun = await run({ serverItems: mmItems, deviceItems: mmItems });
  const PROBE = 'MISMATCH_PROBE_INTERVIEW_ISSUE';
  const mmCmp = compareTutorShadow({
    legacy: { interviewIssueLine: PROBE },
    canonicalInput: mmRun.resolved, context: mmRun.ctx });
  const mmDiff = mmCmp.entries.find((e) => e.kind === 'interview_record'
    && e.diff === 'VALUE_MISMATCH');
  check('S mismatch は VALUE_MISMATCH になる', mmDiff !== undefined,
    JSON.stringify(mmCmp.entries.filter((e) => e.kind === 'interview_record').map((e) => e.diff)));
  const mmJson = JSON.stringify(mmCmp);
  check('S mismatch 時も逐語が出ない', !mmJson.includes(VERBATIM));
  check('S mismatch 時に legacy の実値が出ない', !mmJson.includes(PROBE));
  check('S mismatch 時に canonical の実値が出ない',
    !mmJson.includes(String(legacyLineOf(mmItems))));
  check('S mismatch 時に userId が出ない', !mmJson.includes(USER_A));
  const mmToken = deviceInterviewRecordToken(mmItems);
  check('S mismatch 時に claim token（fingerprint）が出ない',
    mmToken !== null && !mmJson.includes(mmToken));
  //   reason は型上 enum だが、型を広げる変更が入っても runtime で落ちるようにする。
  const mmReasons = mmCmp.entries
    .map((e) => e.reason as unknown)
    .filter((r): r is string => typeof r === 'string');
  check('S reason は既知の enum 相当のみ',
    mmReasons.every((r) => /^[a-z_]+$/.test(r)), mmReasons.join(' | '));

  // ★ false-empty verified が成立しないこと ★
  //   device に履歴があるのに server が読めない場合、"[] verified" にしてはいけない。
  const failRun = await run({
    serverItems: mmItems, deviceItems: mmItems,
    errors: { interview_practice_records: { code: '42P01', message: 'x' } },
  });
  eq('S read failure は unreadable（false-empty にしない）', failRun.source?.state, 'unreadable');
  check('S read failure では verified にならない',
    failRun.source?.syncStatus !== 'verified', String(failRun.source?.syncStatus));
  check('S read failure を empty と誤認しない', failRun.source?.state !== 'empty');
  check('S read failure では block を出さない',
    failRun.block === undefined || failRun.block?.presence === 'missing');
}

// ── 7. Equal-timestamp cap-boundary（tie-break level B の実証）──────────
//
//   ★ Level B: selected-set parity only ★
//     server は `created_at DESC, id DESC`（DB uuid）で解くが、device view は
//     DB id を持たない（`deviceInterviewRecordRow` が `id: null` を置く）。
//     したがって **同一 created_at が cap 境界を跨ぐ**場合だけ選択がずれ得る。
//     一方 item view は `localRecordId`（両側で共有される安定 id）を含むため、
//     **選ばれた集合が同じなら fingerprint は必ず一致する**。
//     この 2 点を実際に走らせて固定する（「実運用では起きない」で A にしない）。
async function t7TieBreak(): Promise<void> {
  console.log('\n7. Equal-timestamp cap boundary');

  // (a) cap 内に同一 created_at があっても、集合が同じなら verified。
  const tied = deviceRecords(CAP);
  const sameTs = tied.map((r, i) =>
    i < 2 ? { ...r, createdAt: '2026-03-10T00:00:00.000Z' } : r);
  const a = await run({ serverItems: sameTs, deviceItems: sameTs });
  eq('T7-a cap 内の同一 created_at は verified（集合が同じ）', a.source?.syncStatus, 'verified');

  // (b) 境界を跨ぐ同一 created_at: N-1 件 + 境界に同値 2 件。
  //     server は id DESC で解き、device は createdAt + 挿入順で解く。
  //     選択がずれ得るのが Level B の残余であることを、実測して記録する。
  const ordinary = deviceRecords(CAP - 1);                 // 新しい側 CAP-1 件
  const boundary = [
    { ...rec(100), createdAt: '2026-01-01T00:00:00.000Z' },
    { ...rec(101), createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  const straddling = [...ordinary, ...boundary];
  const b = await run({ serverItems: straddling, deviceItems: straddling });
  check('T7-b 境界に同値がある場合も verified か mismatch のいずれかで、例外は起きない',
    b.source?.syncStatus === 'verified' || b.source?.syncStatus === 'mismatch',
    String(b.source?.syncStatus));
  check('T7-b 境界ケースでも verified を偽装しない（unreadable にもしない）',
    b.source?.state === 'available' || b.source?.state === 'unverified',
    String(b.source?.state));

  // (c) ★ Level B の核心 ★ 選ばれた集合が同じなら fingerprint は必ず一致する。
  //     device 側の格納順を逆にしても（挿入順が違っても）token は変わらない。
  const forward = deviceRecords(CAP);
  const reversed = [...forward].reverse();
  eq('T7-c 格納順を変えても token は同じ（集合が同じなら fingerprint 一致）',
    deviceInterviewRecordToken(forward), deviceInterviewRecordToken(reversed));

  // (d) 集合が違えば必ず token が変わる（cap 内の 1 件差し替え）。
  const changed = [{ ...forward[0], improvementSummary: '★差し替え' }, ...forward.slice(1)];
  check('T7-d cap 内の 1 件が違えば token は変わる',
    deviceInterviewRecordToken(changed) !== deviceInterviewRecordToken(forward));

  // (e) cap 外だけの差異は token を変えない（window の外は比較対象外）。
  const extraOld = [...forward, { ...rec(200), createdAt: '2020-01-01T00:00:00.000Z' }];
  eq('T7-e cap 外の古い record を足しても token は不変',
    deviceInterviewRecordToken(extraOld), deviceInterviewRecordToken(forward));

  // (f) localRecordId が fingerprint の材料に入っている（共有安定 id）。
  const views = readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/views.ts'), 'utf8');
  const vIdx = views.indexOf('export function interviewRecordItemView');
  check('T7-f item view は localRecordId を含む',
    vIdx !== -1 && views.slice(vIdx, vIdx + 600).includes('localRecordId'));
  //     device row は DB id を持たない（= Level A ではない）ことも明示的に記録する。
  const dv = readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/deviceViews.ts'), 'utf8');
  const rIdx = dv.indexOf('export function deviceInterviewRecordRow');
  check('T7-f device row は DB id を持たない（Level A ではない）',
    rIdx !== -1 && /id:\s*null/.test(dv.slice(rIdx, rIdx + 800)));
}

// ── 5. block / invariants ─────────────────────────────────────────────
async function t5Invariants(): Promise<void> {
  console.log('\n5. Block & invariants');

  // block contract
  check('T5 block id が登録されている',
    (EXAM_CONTEXT_BLOCK_IDS as readonly string[]).includes('interview_issue_line'));
  const meta = EXAM_CONTEXT_BLOCK_REGISTRY.interview_issue_line;
  eq('T5 sourceKind は interview_record', meta.sourceKind, 'interview_record');
  eq('T5 derivation は deterministic', meta.derivation, 'deterministic');
  eq('T5 heading は caller が付ける', meta.headingOwner, 'none');
  const plan = getExamPurposePlan('tutor');
  check('T5 tutor plan に載っている',
    plan.blocks.some((b) => b.id === 'interview_issue_line'));
  check('T5 tutor 以外の purpose には載せていない',
    !getExamPurposePlan('essay_chat').blocks.some((b) => b.id === 'interview_issue_line'));

  const items = deviceRecords(20, { improvements: ['結論を先に'] });
  const withClaim = await run({ serverItems: items, deviceItems: items });
  const without = await run({ serverItems: items, deviceItems: null });
  eq('T5 claim の有無で query 数が変わらない',
    withClaim.ctx.diagnostics.sourceQueryCount, without.ctx.diagnostics.sourceQueryCount);
  eq('T5 canonical query count は 10 のまま', withClaim.ctx.diagnostics.sourceQueryCount, 10);
  const q = withClaim.rec.trace.filter((t) => t.table === 'interview_practice_records');
  eq('T5 interview_record の query は 1 本', q.length, 1);
  eq('T5 limit は cap+1 のまま', q[0].limit, CAP + 1);

  // ★ block ができても consumer は切り替わっていない ★
  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  check('T5 legacy の body 経路が残っている', route.includes('buildTutorStudentContext'));
  check('T5 route は canonical block を prompt へ渡さない',
    !route.includes('interview_issue_line'));
  // ★ 修正（S5-P9 promotion）★ source 側は route.indexOf('buildTutorUserPrompt') を
  //   anchor に ±1500 字 window を見ていた。この識別子は file 冒頭の見出しコメントにも
  //   現れるため window が file 先頭に張られ、実際の prompt 経路を検査できていない
  //   （S5-P4〜P8 で 5.2〜5.6 側に見つかったのと同じ defect。6 回目）。
  //   コメント行を除いた実コード上で **呼び出し形**に anchor し、
  //   固定 window ではなく prompt 組み立て「以降すべて」を検査する。
  const routeCode = route
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  const promptIdx = routeCode.indexOf('= buildTutorUserPrompt(');
  check('T5 prompt 組み立て位置を特定できる', promptIdx !== -1);
  if (promptIdx !== -1) {
    const afterPrompt = routeCode.slice(promptIdx);
    check('T5 prompt 以降に shadowResolvedInput が現れない',
      !afterPrompt.includes('shadowResolvedInput'));
    check('T5 prompt 以降に compareTutorShadow が現れない',
      !afterPrompt.includes('compareTutorShadow'));
    check('T5 prompt 以降に canonical block 配列が現れない',
      !/\.context\??\.blocks/.test(afterPrompt));
    check('T5 prompt 以降に interviewIssueLine が現れない',
      !afterPrompt.includes('interviewIssueLine'));
    check('T5 prompt 以降に interview_issue_line が現れない',
      !afterPrompt.includes('interview_issue_line'));
  }

  // ★ 正規化の正本は 1 箇所（E-P6）★
  const proj = readFileSync(join(ROOT, 'lib/examSpine/context/interviewRecordProjection.ts'), 'utf8');
  check('T5 射影は legacy の buildInterviewLine を共有する',
    proj.includes('buildInterviewLine'));
  // ★ comment を除いてから判定する ★
  //   説明文が定数に言及しているだけで「複製した」と判定すると誤検出になる
  //   （dual authority 検査で同じ罠を踏んだ）。見るのは実コードだけ。
  const projCode = proj.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const constant of ['80', '500', "' / '"]) {
    check(`T5 射影が正規化定数 ${constant} を複製していない`, !projCode.includes(constant),
      projCode.split('\n').find((l) => l.includes(constant)) ?? '');
  }
  const build = readFileSync(join(ROOT, 'lib/examSpine/blocks/build.ts'), 'utf8');
  const line = build.split('\n').find((l) => l.includes('interview_issue_line')) ?? '';
  check('T5 block builder は再整形しない（slice / join / truncate なし）',
    !/slice|join|truncate/.test(line), line.trim());

  // 直接呼び出し
  eq('T5 rows が空なら null', projectInterviewIssueLine([]), null);
  eq('T5 rows が null なら null', projectInterviewIssueLine(null), null);
  eq('T5 先頭 1 件だけを見る',
    projectInterviewIssueLine([
      { improvementSummary: '最新', whatWentWrong: '', feedback: null } as never,
      { improvementSummary: '古い', whatWentWrong: '', feedback: null } as never,
    ]), '最新');
}


// ── 6. Plan membership ≠ AI-visible activation ────────────────────────
//
//   ★ Stage 5.7 で初めて「tutor plan に載る新 block」が canonical に入った ★
//     Stage 5.4-5.6 までは tutor plan が 3 block 固定だったため、
//     「plan の block 数」を AI-visible 非活性の proxy として使えていた。
//     interview_issue_line が plan に載った今、その proxy は成立しない。
//     したがって **plan membership と AI-visible activation を別々に検査する**。
//
//   ★ authority（E-S51）★
//     「block ができても consumer は使わない」。plan に載せたのは shadow comparison
//     から build されるようにするためで、production prompt は legacy 3 層のまま。
//
//   ★ 構造的根拠 ★
//     EXAM_PURPOSE_PLANS は production code から一切 import されておらず、
//     tutor plan は render: null / legacyBuilder: null である。すなわち plan は
//     shadow / QA 専用の宣言であって prompt 経路ではない。ここを機械的に固定する。
function t6PlanNotVisible(): void {
  console.log('\n6. Plan membership vs AI-visible activation');

  // (a) plan には載っている（Stage 5.7 の意図どおり）。
  const tutorBlocks = getExamPurposePlan('tutor').blocks.map((b) => b.id);
  eq('T6 tutor plan の block は 5.1/5.2/5.3/5.7/5.9 の 5 つ', tutorBlocks,
    ['tutor_student_context', 'diagnosis_type_hint', 'activity_category_counts',
     'interview_issue_line', 'presentation_result_summary']);

  // (b) ★ しかし plan は production から読まれない ★
  //     production code（lib/ と app/、examSpine の orchestrator 自身を除く）が
  //     EXAM_PURPOSE_PLANS / getExamPurposePlan を import していないこと。
  const roots = ['lib', 'app'];
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (rel.startsWith('lib/examSpine/orchestrator/')) continue;      // plan 自身と assembler
      if (rel.startsWith('lib/examSpine/context/')) continue;           // canonical assembler（shadow 専用）
      const src = readFileSync(join(ROOT, rel), 'utf8');
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      if (/EXAM_PURPOSE_PLANS|getExamPurposePlan/.test(code)) offenders.push(rel);
    }
  };
  for (const r of roots) walk(r);
  eq('T6 production の prompt 経路が plan を読んでいない', offenders, []);

  // (c) tutor plan は render / legacyBuilder を持たない（描画経路が無い）。
  const planSrc = readFileSync(join(ROOT, 'lib/examSpine/orchestrator/plan.ts'), 'utf8');
  const tIdx = planSrc.indexOf('  tutor: {');
  const tutorSeg = tIdx === -1 ? '' : planSrc.slice(tIdx, tIdx + 2000);
  check('T6 tutor plan は render を持たない', /render:\s*null/.test(tutorSeg));
  check('T6 tutor plan は legacyBuilder を持たない', /legacyBuilder:\s*null/.test(tutorSeg));

  // (d) consumer switch pin が動いていない。
  const entry = readFileSync(
    join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_STAGE5_ENTRY.md'), 'utf8');
  check('T6 FIRST_STAGE5_CONSUMER=tutor のまま',
    /FIRST_STAGE5_CONSUMER\s*=\s*tutor\b/.test(entry));
  check('T6 FIRST_STAGE5_SLOT=basic_info のまま',
    /FIRST_STAGE5_SLOT\s*=\s*basic_info\b/.test(entry));

  // (e) Stage 5.8 以降（essay / presentation）を巻き込んでいない。
  const claimFile = readFileSync(
    join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8');
  const fnIdx = claimFile.indexOf('export function buildTutorDeviceClaimEntries(');
  const kinds = Array.from(
    claimFile.slice(Math.max(fnIdx, 0)).matchAll(/entries\.push\(\{\s*kind:\s*'([a-z_]+)'/g),
  ).map((m) => m[1]).sort();
  eq('T6 tutor の claim kind は 5.1-5.7 の 6 つのみ', kinds,
    ['activity', 'basic_info', 'diagnosis', 'interview_record',
     'self_analysis', 'statement_review']);
  const deviceViews = readFileSync(
    join(ROOT, 'lib/examSpine/sync/adapters/deviceViews.ts'), 'utf8');
  const windowed = ['deviceSelfAnalysisView', 'deviceStatementReviewView',
    'deviceInterviewRecordView', 'deviceSelfPrView', 'deviceEssayView'].filter((fn) => {
        return fnBody(deviceViews, fn).includes('selectDeviceSyncWindow');
  }).sort();
  eq('T6 window primitive は 5.4/5.6/5.7 の 3 kind のみ', windowed,
    ['deviceInterviewRecordView', 'deviceSelfAnalysisView', 'deviceStatementReviewView']);
  const registry = readFileSync(join(ROOT, 'lib/examSpine/blocks/registry.ts'), 'utf8');
  //   ★ presentation_result_summary は Stage 5.9（S5-P11）で昇格した ★
  check('T6 Stage 5.9 の presentation_result_summary は registry にある（許可）',
    registry.includes('presentation_result_summary:'));
  for (const later of ['essay_issue_line', 'statement_review_tutor', 'self_analysis_tutor']) {
    check(`T6 未昇格 stage の block \`${later}\` が混入していない`,
      !registry.includes(`${later}:`));
  }

  // (f) ★ statement_review の product 判断（E-S49）を解決していない ★
  const decisions = readFileSync(
    join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md'), 'utf8');
  const sIdx = decisions.indexOf('## E-S49 —');
  const sSeg = sIdx === -1 ? '' : decisions.slice(sIdx, sIdx + 6000);
  check('T6 E-S49 が存在する', sIdx !== -1);
  check('T6 statement_review の semantics は DEFERRED のまま',
    /semantics\s+DEFERRED/.test(sSeg) || /semantics  DEFERRED/.test(sSeg));
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5.7] interview_record claim + canonical tutor block');
  t1Authority();
  await t2Transport();
  t3Claim();
  await t4Semantics();
  await t5Invariants();
  t6PlanNotVisible();
  await t7TieBreak();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage5.7] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1; return;
  }
  console.log(`\n[exam-spine-stage5.7] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-stage5.7] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage5.7] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1; return;
  }
  console.log('[exam-spine-stage5.7] PASS');
}
void main();
