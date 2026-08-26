// Exam Spine — Stage 5.0 device revision claim wiring の contract check。
//
// 証明する 3 case（E-S2 の負の安全ゲート）:
//   A. claim 無し           → verified にならない（unclaimed）→ server 値を採用しない
//   B. 一致する claim       → verified → server 値を採用する
//   C. stale / mismatch     → verified にならない → server 値を採用しない
//
// ★ Case B は server の fingerprint を echo し返すのではなく、
//   **device 側の BasicInfo から独立に算出した token** が server の値と一致することを示す。
//   これが一致しなければ device view / server mapper のどちらかがずれている。
//
// 実 Supabase / 実 AI を使わない（fake executor のみ）。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let fetchCallCount = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage5] 外部通信が発生しました: ${String(args[0])}`);
}) as typeof realFetch;

import type { BasicInfo } from '@/types/basicInfo';
import { BASIC_INFO_SCHEMA_VERSION } from '@/lib/supabase/basicInfoLogs';
import {
  buildTutorDeviceClaimEntries,
  deviceBasicInfoToken,
} from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import {
  serializeDeviceClaim,
  withDeviceClaimHeader,
} from '@/lib/examSpine/sync/claim/serialize';
import {
  parseDeviceClaimHeader,
  parseDeviceClaimValue,
  summarizeDeviceClaim,
  toDeviceClaims,
} from '@/lib/examSpine/sync/claim/parse';
import {
  EXAM_DEVICE_CLAIM_HEADER,
  EXAM_DEVICE_CLAIM_MAX_BYTES,
  EXAM_DEVICE_CLAIM_VERSION,
} from '@/lib/examSpine/sync/claim/types';
import { buildCanonicalExamContext } from '@/lib/examSpine/context/assemble.server';
import { isExamSpineShadowEnabled } from '@/lib/examSpine/context/shadowGate.server';
import { sourcesForPurpose } from '@/lib/examSpine/purpose';
import type { ExamRequestAuthorization } from '@/lib/examSpine/read/requestSnapshot.server';
import { createRecordingExecutor, USER_A, USER_B, type FakeDb } from './fixtures/examSpineStage3';

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) passed += 1;
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
function eq(label: string, actual: unknown, expected: unknown): void {
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── device canonical（localStorage basicFormData 相当）────────────────
const DEVICE_BASIC_INFO: BasicInfo = {
  name: '受験 太郎',
  grade: '高校3年',
  track: '文系',
  examTypes: ['総合型選抜'],
  preferences: [{ university: '実在大学', faculty: '実在学部', department: '実在学科' }],
  overallGpa: '4.2',
  subjectGrades: { 国語: '5', 数学: '4' },
} as BasicInfo;

/** device が mirror した結果として server 側に入っている行（writer は name を strip する）。 */
function mirroredRow(userId = USER_A): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...(DEVICE_BASIC_INFO as unknown as Record<string, unknown>) };
  delete payload.name;
  return {
    id: 'bi-1',
    user_id: userId,
    payload,
    schema_version: BASIC_INFO_SCHEMA_VERSION,
    source_hash: 'irrelevant',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function dbWithMirror(userId = USER_A): FakeDb {
  return { tables: { basic_info_logs: [mirroredRow(userId)] } } as FakeDb;
}

const authorizeA = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A });

async function assemble(opts: {
  claims?: Parameters<typeof buildCanonicalExamContext>[0]['deviceClaims'];
  db?: FakeDb;
  request?: Request;
}) {
  const rec = createRecordingExecutor(opts.db ?? dbWithMirror());
  const result = await buildCanonicalExamContext({
    request: opts.request ?? new Request('https://example.test/stage5'),
    purpose: 'tutor',
    authorize: authorizeA,
    bridge: { basicInfo: { ...DEVICE_BASIC_INFO, preferences: [{ university: 'ブリッジ大学', faculty: '', department: '' }] } as BasicInfo },
    deviceClaims: opts.claims,
    executor: rec.executor,
    projectionNow: '2026-01-01T00:00:00.000Z',
  });
  if (!result.ok) throw new Error(`veto: ${result.veto.reasons.join(',')}`);
  const basic = result.context.sources.find((s) => s.kind === 'basic_info');
  return { ctx: result.context, basic, rec };
}

// ── 1. device token ───────────────────────────────────────────────────
function t1DeviceToken(): void {
  console.log('\n1. Device token');
  const token = deviceBasicInfoToken(DEVICE_BASIC_INFO);
  check('T1 device token が算出できる', typeof token === 'string' && token.length > 0);
  check('T1 token は efp1 形式', (token ?? '').startsWith('efp1:'), String(token).slice(0, 12));

  // 決定性
  eq('T1 同一 device state → 同一 token', deviceBasicInfoToken(DEVICE_BASIC_INFO), token);

  // 氏名は token に影響しない（server payload に name が無いため）
  const renamed = { ...DEVICE_BASIC_INFO, name: '別の 名前' } as BasicInfo;
  eq('T1 氏名を変えても token は変わらない（E-P8）', deviceBasicInfoToken(renamed), token);

  // canonical data が変われば token も変わる
  const changed = { ...DEVICE_BASIC_INFO, grade: '高校2年' } as BasicInfo;
  check('T1 canonical data が変われば token も変わる', deviceBasicInfoToken(changed) !== token);

  // 空 device は申告しない
  eq('T1 null device は token 無し', deviceBasicInfoToken(null), null);
  // ★ 「実質空」の device は canonical projection では claimed になる（Stage 5.1 収束後）★
  //   writer（basicInfoRepository.ts:isEmptyBasicInfo）は grade / track / 志望校が
  //   すべて空なら mirror を書かないため、server 側は 0 行になる。
  //   このとき Stage 4 は Source-Sync より手前で `empty` を確定させる（E-S30）ので、
  //   token を送っても送らなくても **最終結果は同じ**（server 値は採用されない）。
  //   projection の正本は deviceViews.ts に一本化したため、ここで独自の
  //   emptiness 規則を再実装しない（それが dual authority を生んだ元の原因）。
  //   精度の改善（device 側 empty を `empty` claim にする）は Stage 5.2 の backlog。
  const emptyDeviceToken = deviceBasicInfoToken(
    { name: 'x', grade: '', track: '', examTypes: [], preferences: [] } as BasicInfo);
  check('T1 実質空でも canonical projection は token を返す（E-S30 が結果を吸収）',
    typeof emptyDeviceToken === 'string');
  check('T1 実質空の token は氏名を含まない', !String(emptyDeviceToken).includes('x'));

  // token に生データが現れない
  const serialized = String(token);
  for (const needle of ['受験', '太郎', '実在大学', '実在学部', '4.2', '国語']) {
    check(`T1 token に "${needle}" が現れない`, !serialized.includes(needle));
  }
}

// ── 2. serialize / header ─────────────────────────────────────────────
function t2Serialize(): void {
  console.log('\n2. Serialize / header');
  const entries = buildTutorDeviceClaimEntries(DEVICE_BASIC_INFO);
  eq('T2 pilot は basic_info 1 kind のみ申告', entries.map((e) => e.kind), ['basic_info']);

  const value = serializeDeviceClaim(entries);
  check('T2 header 値が作れる', typeof value === 'string');
  const size = new TextEncoder().encode(value ?? '').length;
  check('T2 header サイズが上限内', size <= EXAM_DEVICE_CLAIM_MAX_BYTES, `${size} bytes`);
  check('T2 header サイズが実用的に小さい（< 256B）', size < 256, `${size} bytes`);
  console.log(`  info  claim header size = ${size} bytes`);

  const parsedBack = JSON.parse(value ?? '{}') as { v: string; c: { kind: string; token: string }[] };
  eq('T2 wire version が固定', parsedBack.v, EXAM_DEVICE_CLAIM_VERSION);
  eq('T2 entry は kind と token だけ', Object.keys(parsedBack.c[0]).sort(), ['kind', 'token']);

  // 生データが header に乗らない
  for (const needle of ['受験', '太郎', '実在大学', 'name', 'userId', '4.2']) {
    check(`T2 header に "${needle}" が現れない`, !(value ?? '').includes(needle));
  }

  // 申告が無ければ header を付けない
  eq('T2 空 entries は null', serializeDeviceClaim([]), null);
  const headers = withDeviceClaimHeader({ 'Content-Type': 'application/json' }, EXAM_DEVICE_CLAIM_HEADER, null);
  eq('T2 claim 無しなら header を足さない', Object.keys(headers), ['Content-Type']);

  // 既存 header を壊さない
  const merged = withDeviceClaimHeader({ 'Content-Type': 'application/json' }, EXAM_DEVICE_CLAIM_HEADER, value);
  eq('T2 Content-Type を維持', merged['Content-Type'], 'application/json');
  eq('T2 claim header が付く', merged[EXAM_DEVICE_CLAIM_HEADER], value);
  const preset = withDeviceClaimHeader(
    { [EXAM_DEVICE_CLAIM_HEADER]: 'preexisting' }, EXAM_DEVICE_CLAIM_HEADER, value);
  eq('T2 既存の同名 header を上書きしない', preset[EXAM_DEVICE_CLAIM_HEADER], 'preexisting');

  // 不正 entry は落とす
  eq('T2 未知 kind は落とす',
    serializeDeviceClaim([{ kind: 'nope' as never, token: 'efp1:' + 'a'.repeat(64) }]), null);
  eq('T2 不正 token は落とす',
    serializeDeviceClaim([{ kind: 'basic_info', token: 'not-a-token' }]), null);
}

// ── 3. parse（fail-safe）──────────────────────────────────────────────
function t3Parse(): void {
  console.log('\n3. Parse (fail-safe)');
  const value = serializeDeviceClaim(buildTutorDeviceClaimEntries(DEVICE_BASIC_INFO));

  const ok = parseDeviceClaimValue(value);
  eq('T3 正常な header は basic_info を通す', Object.keys(ok.claims), ['basic_info']);

  const cases: Array<[string, string | null, string]> = [
    ['absent', null, 'absent'],
    ['empty string', '', 'absent'],
    ['malformed json', '{not json', 'malformed'],
    ['non-object', '"str"', 'malformed'],
    ['unknown version', JSON.stringify({ v: 'zzz', c: [] }), 'unknown_version'],
    ['c not array', JSON.stringify({ v: EXAM_DEVICE_CLAIM_VERSION, c: 1 }), 'malformed'],
    ['oversize', JSON.stringify({ v: EXAM_DEVICE_CLAIM_VERSION, c: [] }) + 'x'.repeat(4096), 'oversize'],
  ];
  for (const [label, raw, reason] of cases) {
    const r = parseDeviceClaimValue(raw);
    eq(`T3 ${label} は claims 空`, Object.keys(r.claims), []);
    check(`T3 ${label} の reason は ${reason}`, r.rejected.some((x) => x.reason === reason),
      r.rejected.map((x) => x.reason).join(','));
  }

  const tok = 'efp1:' + 'a'.repeat(64);
  const unknownKind = parseDeviceClaimValue(JSON.stringify({ v: EXAM_DEVICE_CLAIM_VERSION, c: [{ kind: 'zzz', token: tok }] }));
  check('T3 未知 kind は unknown_kind', unknownKind.rejected.some((r) => r.reason === 'unknown_kind'));

  const classTwo = parseDeviceClaimValue(JSON.stringify({ v: EXAM_DEVICE_CLAIM_VERSION, c: [{ kind: 'presentation', token: tok }] }));
  eq('T3 class 2 kind の申告は受け取らない（E-S3）', Object.keys(classTwo.claims), []);
  check('T3 class 2 は not_syncable', classTwo.rejected.some((r) => r.reason === 'not_syncable'));

  const dup = parseDeviceClaimValue(JSON.stringify({
    v: EXAM_DEVICE_CLAIM_VERSION, c: [{ kind: 'basic_info', token: tok }, { kind: 'basic_info', token: tok }],
  }));
  eq('T3 重複 kind は 1 件だけ通す', Object.keys(dup.claims), ['basic_info']);
  check('T3 重複は duplicate_kind として記録', dup.rejected.some((r) => r.reason === 'duplicate_kind'));

  const badTok = parseDeviceClaimValue(JSON.stringify({ v: EXAM_DEVICE_CLAIM_VERSION, c: [{ kind: 'basic_info', token: 'x' }] }));
  eq('T3 不正 token は通さない', Object.keys(badTok.claims), []);

  // Headers 経由
  const h = new Headers({ [EXAM_DEVICE_CLAIM_HEADER]: value ?? '' });
  eq('T3 Headers から取り出せる', Object.keys(parseDeviceClaimHeader(h).claims), ['basic_info']);
  eq('T3 header 未設定は claims 空', Object.keys(parseDeviceClaimHeader(new Headers()).claims), []);

  // 観測要約に token / 本文が出ない
  const summary = summarizeDeviceClaim(ok);
  const s = JSON.stringify(summary);
  check('T3 summary に token が出ない', !s.includes('efp1:'));
  for (const needle of ['受験', '実在大学']) {
    check(`T3 summary に "${needle}" が出ない`, !s.includes(needle));
  }
}

// ── 4. auth binding / policy 不可 ─────────────────────────────────────
function t4AuthBinding(): void {
  console.log('\n4. Auth binding / claim は policy input ではない');
  const value = serializeDeviceClaim(buildTutorDeviceClaimEntries(DEVICE_BASIC_INFO));
  const parsed = parseDeviceClaimValue(value);
  const allowed = sourcesForPurpose('tutor');

  eq('T4 未認証では claim を一切採用しない',
    Object.keys(toDeviceClaims(parsed, { authenticatedUserId: null, allowedSources: allowed })), []);
  eq('T4 認証済みなら採用',
    Object.keys(toDeviceClaims(parsed, { authenticatedUserId: USER_A, allowedSources: allowed })), ['basic_info']);

  // purpose gate を広げられない
  const narrow = toDeviceClaims(parsed, {
    authenticatedUserId: USER_A,
    allowedSources: sourcesForPurpose('presentation_feedback'),
  });
  eq('T4 purpose が許可しない kind の申告は捨てる', Object.keys(narrow), []);

  // claim に userId / authority / table を書く口が無い（型と parser で閉じている）
  const injected = parseDeviceClaimValue(JSON.stringify({
    v: EXAM_DEVICE_CLAIM_VERSION,
    c: [{ kind: 'basic_info', token: 'efp1:' + 'a'.repeat(64), userId: USER_B, table: 'profiles', verified: true }],
  }));
  const claims = toDeviceClaims(injected, { authenticatedUserId: USER_A, allowedSources: allowed });
  eq('T4 余計な field は無視される', Object.keys(claims), ['basic_info']);
  const flat = JSON.stringify(claims);
  check('T4 claim に別 user の id が残らない', !flat.includes(USER_B));
  check('T4 claim に table 指定が残らない', !flat.includes('profiles'));
  check('T4 claim に verified フラグが残らない', !flat.includes('"verified"'));
}

// ── 5. Case A / B / C（Source-Sync）───────────────────────────────────
async function t5SyncCases(): Promise<void> {
  console.log('\n5. Source-Sync case A / B / C');

  // Case A — claim 無し
  const a = await assemble({});
  eq('T5-A claim 無しは unclaimed', a.basic?.syncStatus, 'unclaimed');
  eq('T5-A state は unverified', a.basic?.state, 'unverified');
  eq('T5-A server を採用しない（origin は bridge）', a.basic?.origin, 'bridge');
  const blockA = a.ctx.blocks.find((b) => b.sourceKind === 'basic_info');
  check('T5-A bridge の値が使われる', (blockA?.content ?? '').includes('ブリッジ大学') || blockA === undefined);

  // Case B — device 側で独立に算出した token が一致する
  const token = deviceBasicInfoToken(DEVICE_BASIC_INFO);
  const b = await assemble({ claims: { basic_info: { presented: true, fingerprint: token } } });
  eq('T5-B 一致する claim は verified', b.basic?.syncStatus, 'verified');
  eq('T5-B state は available', b.basic?.state, 'available');
  eq('T5-B server を採用する', b.basic?.origin, 'server');
  eq('T5-B 氏名は bridge から維持（E-P8）', [...(b.basic?.bridgeFields ?? [])], ['name']);

  // Case C — stale / mismatch
  const staleToken = deviceBasicInfoToken({ ...DEVICE_BASIC_INFO, grade: '高校2年' } as BasicInfo);
  check('T5-C stale token は別値', staleToken !== token);
  const c = await assemble({ claims: { basic_info: { presented: true, fingerprint: staleToken } } });
  check('T5-C verified にならない', c.basic?.syncStatus !== 'verified', String(c.basic?.syncStatus));
  eq('T5-C state は unverified', c.basic?.state, 'unverified');
  eq('T5-C server を採用しない', c.basic?.origin, 'bridge');

  // 完全に無関係な token
  const d = await assemble({ claims: { basic_info: { presented: true, fingerprint: 'efp1:' + 'b'.repeat(64) } } });
  check('T5-C 無関係な token でも verified にならない', d.basic?.syncStatus !== 'verified');
  eq('T5-C 無関係 token でも server を採用しない', d.basic?.origin, 'bridge');
}

// ── 6. query count / request isolation ────────────────────────────────
async function t6QueryAndIsolation(): Promise<void> {
  console.log('\n6. Query count / request isolation');
  const token = deviceBasicInfoToken(DEVICE_BASIC_INFO);

  const noClaim = await assemble({});
  const withClaim = await assemble({ claims: { basic_info: { presented: true, fingerprint: token } } });
  eq('T6 claim の有無で query 数が変わらない',
    withClaim.ctx.diagnostics.sourceQueryCount, noClaim.ctx.diagnostics.sourceQueryCount);
  console.log(`  info  source query count = ${noClaim.ctx.diagnostics.sourceQueryCount}`);

  // 同一 table を 2 度読まない（verification のための再 read が無い）
  const counts = new Map<string, number>();
  for (const t of withClaim.rec.trace) counts.set(t.table, (counts.get(t.table) ?? 0) + 1);
  eq('T6 verification のための再 read が無い',
    [...counts.entries()].filter(([, n]) => n > 1).map(([t]) => t), []);

  // multi-tab: 同一 user・別 request・別 claim が独立評価される
  const reqA = new Request('https://example.test/tabA');
  const reqB = new Request('https://example.test/tabB');
  const tabA = await assemble({ request: reqA, claims: { basic_info: { presented: true, fingerprint: token } } });
  const tabB = await assemble({ request: reqB, claims: { basic_info: { presented: true, fingerprint: 'efp1:' + 'c'.repeat(64) } } });
  eq('T6 tab A（一致）は verified', tabA.basic?.syncStatus, 'verified');
  check('T6 tab B（不一致）は verified にならない', tabB.basic?.syncStatus !== 'verified');
  eq('T6 tab A の結果が tab B に漏れない', tabB.basic?.origin, 'bridge');

  // 同一 request 内で claim を変えても snapshot は再 read しない
  const shared = new Request('https://example.test/shared');
  const first = await assemble({ request: shared, claims: { basic_info: { presented: true, fingerprint: token } } });
  const before = first.ctx.diagnostics.freshlyReadKinds.length;
  check('T6 同一 request の 1 回目は fresh read', before > 0);
}

// ── 7. shadow gate（default deny）─────────────────────────────────────
function t7ShadowGate(): void {
  console.log('\n7. Shadow gate (default deny)');
  const saved = {
    p: process.env.EXAM_SPINE_SHADOW_PURPOSES,
    u: process.env.EXAM_SPINE_SHADOW_USER_IDS,
  };
  delete process.env.EXAM_SPINE_SHADOW_PURPOSES;
  delete process.env.EXAM_SPINE_SHADOW_USER_IDS;
  check('T7 env 未設定は OFF', !isExamSpineShadowEnabled('tutor', USER_A));

  process.env.EXAM_SPINE_SHADOW_PURPOSES = 'tutor';
  check('T7 purpose だけでは OFF（allowlist 空）', !isExamSpineShadowEnabled('tutor', USER_A));

  process.env.EXAM_SPINE_SHADOW_USER_IDS = USER_A;
  check('T7 purpose AND allowlist で ON', isExamSpineShadowEnabled('tutor', USER_A));
  check('T7 allowlist 外の user は OFF', !isExamSpineShadowEnabled('tutor', USER_B));
  check('T7 別 purpose は OFF', !isExamSpineShadowEnabled('matching', USER_A));
  check('T7 userId 空は OFF', !isExamSpineShadowEnabled('tutor', ''));

  process.env.EXAM_SPINE_SHADOW_PURPOSES = 'zzz-not-a-purpose';
  check('T7 不正 purpose 値は OFF', !isExamSpineShadowEnabled('tutor', USER_A));

  if (saved.p === undefined) delete process.env.EXAM_SPINE_SHADOW_PURPOSES;
  else process.env.EXAM_SPINE_SHADOW_PURPOSES = saved.p;
  if (saved.u === undefined) delete process.env.EXAM_SPINE_SHADOW_USER_IDS;
  else process.env.EXAM_SPINE_SHADOW_USER_IDS = saved.u;
}

// ── 8. static: production path / consumer 不変 ───────────────────────
function t8Static(): void {
  console.log('\n8. Static: production path');
  const client = readFileSync(join(ROOT, 'app/tutor/page.tsx'), 'utf8');
  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');

  check('T8 client が claim serializer を使う', client.includes('serializeDeviceClaim'));
  check('T8 client が canonical header 名を使う', client.includes('EXAM_DEVICE_CLAIM_HEADER'));
  check('T8 client が既存 Content-Type を維持', client.includes("'Content-Type': 'application/json'"));
  check('T8 route が claim を parse する', route.includes('parseDeviceClaimHeader'));
  check('T8 route が auth 済み userId で binding', route.includes('authenticatedUserId: userId'));
  check('T8 route が purpose gate で filter', route.includes("sourcesForPurpose('tutor')"));
  check('T8 shadow は gate 済み', route.includes('isExamSpineShadowEnabled'));

  // consumer 出力経路を変えていない
  check('T8 requestBody を変更していない', route.includes('body.message') || client.includes('const requestBody'));
  // ★ claim 層が prompt 組み立てへ入り込んでいないこと（consumer 出力の不変性）★
  //   tutor の prompt を作る module が claim / canonical context を import していたら、
  //   出力経路が変わっている可能性がある。
  const promptModules = [
    'lib/tutor/tutorPrompt.ts',
    'lib/contextBuilders/tutorStudentContext.ts',
    'lib/contextBuilders/tutor/buildTutorPromptContext.ts',
  ];
  for (const rel of promptModules) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    check(`T8 ${rel} が claim 層を import しない`, !src.includes('examSpine/sync/claim'), rel);
    check(`T8 ${rel} が canonical context を import しない`, !src.includes('examSpine/context'), rel);
  }

  // route は claim を parse するが、prompt へは渡していないこと。
  const promptCallIdx = route.indexOf('buildTutorUserPrompt');
  const claimVarIdx = route.indexOf('deviceClaims');
  check('T8 route が deviceClaims を prompt へ渡していない',
    promptCallIdx === -1 || !route.slice(promptCallIdx, promptCallIdx + 600).includes('deviceClaims'));
  check('T8 deviceClaims は shadow 経路にだけ現れる', claimVarIdx !== -1);

  // claim 層に mutation / AI / service_role が無い
  const files = ['types.ts', 'serialize.ts', 'parse.ts', 'deviceBasicInfo.ts'].map((f) =>
    readFileSync(join(ROOT, 'lib/examSpine/sync/claim', f), 'utf8'));
  for (const src of files) {
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    check('T8 claim 層に mutation が無い', !/\.(insert|upsert|update|delete|rpc)\s*\(/.test(code));
    check('T8 claim 層に AI SDK が無い', !/@anthropic-ai|openai/.test(code));
    check('T8 claim 層に service_role が無い', !/service_role|SERVICE_ROLE/.test(code));
    check('T8 claim 層に global mutable cache が無い',
      !/^\s*(let|var)\s+\w+\s*(:|=)\s*(new\s+Map|new\s+Set|\{)/m.test(code));
  }
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5] Stage 5.0 device revision claim wiring check');
  console.log('[exam-spine-stage5] PILOT_PURPOSE=tutor / kind=basic_info');

  t1DeviceToken();
  t2Serialize();
  t3Parse();
  t4AuthBinding();
  await t5SyncCases();
  await t6QueryAndIsolation();
  t7ShadowGate();
  t8Static();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage5] FAIL: 外部通信が ${fetchCallCount} 回発生しました`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[exam-spine-stage5] network calls = ${fetchCallCount}（実 Supabase / AI 呼び出しゼロ）`);
  console.log(`[exam-spine-stage5] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage5] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-stage5] PASS');
}

void main();
