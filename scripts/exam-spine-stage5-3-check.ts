// Exam Spine — Stage 5.3 activity device claim wiring の check（G6）。
//
// 目的: activity を DEFERRED → READY へ進めたことを実証する。
//   device ActivityData → canonical device view → token → header → parser →
//   Source-Sync → available → activity_category_counts block → shadow MATCH
//
// 実 Supabase / 実 AI を使わない（fake executor のみ）。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let fetchCallCount = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage5.3] 外部通信: ${String(args[0])}`);
}) as typeof realFetch;

import type { ActivityData } from '@/types/activity';
import type { BasicInfo } from '@/types/basicInfo';
import {
  ACTIVITY_CATEGORY_LABELS,
  formatActivityCategoryCounts,
  summarizeActivityCategories,
} from '@/lib/activityCategories';
import {
  buildTutorDeviceClaimEntries,
  deviceActivityToken,
  deviceBasicInfoToken,
} from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import { deviceActivityView } from '@/lib/examSpine/sync/adapters/deviceViews';
import { examSyncObservation } from '@/lib/examSpine/sync/adapters/views';
import { serializeDeviceClaim } from '@/lib/examSpine/sync/claim/serialize';
import { parseDeviceClaimValue, toDeviceClaims } from '@/lib/examSpine/sync/claim/parse';
import { EXAM_DEVICE_CLAIM_MAX_BYTES } from '@/lib/examSpine/sync/claim/types';
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

// ── fixtures ──────────────────────────────────────────────────────────
// ★ synthetic secret を活動本文に入れ、header / diff に漏れないことを確認する。
const SECRET = 'ACTIVITY_SECRET_NARRATIVE_9f2b';
const DEVICE_ACTIVITY = {
  clubActivities: [{ clubName: '吹奏楽部', description: SECRET }],
  volunteerActivities: [{ theme: '清掃活動', description: SECRET }],
  studyAbroadActivities: [],
  researchActivities: [],
  partTimeJobActivities: [],
  certificationActivities: [],
  contestActivities: [],
  readingActivities: [],
  hobbyActivities: [],
  otherActivities: [],
} as unknown as ActivityData;

const DEVICE_BASIC = {
  name: '受験 太郎', grade: '高校3年', track: '文系', examTypes: ['総合型選抜'],
  preferences: [{ university: '実在大学', faculty: '実在学部', department: '実在学科' }],
} as BasicInfo;

const EXPECTED_COUNTS = formatActivityCategoryCounts(
  summarizeActivityCategories(DEVICE_ACTIVITY as unknown as Record<string, unknown>)!,
);

function activityRow(payload: unknown, schemaVersion = '1'): Record<string, unknown> {
  return {
    id: 'ac-1', user_id: USER_A, payload, schema_version: schemaVersion, source_hash: 'x',
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  };
}
function dbWith(rows: Record<string, unknown>[]): FakeDb {
  return { tables: { activity_logs: rows } } as FakeDb;
}
const authorizeA = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A });

async function assemble(opts: {
  rows?: Record<string, unknown>[];
  claim?: string | null;
  purpose?: 'tutor' | 'essay_chat';
  errors?: Record<string, { code: string; message: string }>;
  request?: Request;
} = {}) {
  const database = dbWith(opts.rows ?? [activityRow(DEVICE_ACTIVITY)]);
  if (opts.errors) (database as FakeDb).errors = opts.errors;
  const rec = createRecordingExecutor(database);
  const r = await buildCanonicalExamContext({
    request: opts.request ?? new Request('https://example.test/s53/' + Math.abs(JSON.stringify(opts).length)),
    purpose: opts.purpose ?? 'tutor',
    authorize: authorizeA,
    bridge: {},
    deviceClaims: opts.claim === undefined ? undefined
      : ({ activity: { presented: true, fingerprint: opts.claim } } as never),
    executor: rec.executor,
    projectionNow: '2026-01-01T00:00:00.000Z',
  });
  if (!r.ok) throw new Error('veto: ' + r.veto.reasons.join(','));
  return {
    ctx: r.context, rec, resolved: r.shadowResolvedInput,
    block: r.context.blocks.find((b) => b.id === 'activity_category_counts'),
    source: r.context.sources.find((s) => s.kind === 'activity'),
  };
}

// ── 1. authority ──────────────────────────────────────────────────────
function t1Authority(): void {
  console.log('\n1. Activity authority');
  const q = Q.activityQuery('00000000-0000-4000-8000-000000000000');
  eq('T1 table は activity_logs', q.table, 'activity_logs');
  eq('T1 mode は maybeSingle', q.mode, 'maybeSingle');
  eq('T1 ordering なし', q.order, []);
  eq('T1 cap なし', q.limit, null);
  check('T1 owner filter を持つ', q.filters.some((f) => f.op === 'eq' && f.column === 'user_id'));
  check('T1 tutor は activity を許可', sourcesForPurpose('tutor').includes('activity'));
  check('T1 essay_chat は activity を許可しない', !sourcesForPurpose('essay_chat').includes('activity'));
}

// ── 2. single authority / label map 統合 ──────────────────────────────
function t2SingleAuthority(): void {
  console.log('\n2. Single authority');
  const viaCanonical = deviceActivityView(DEVICE_ACTIVITY);
  check('T2 canonical device view が成功', viaCanonical.ok);
  if (viaCanonical.ok) {
    const obs = examSyncObservation({ kind: 'activity', source: 'device_canonical', view: viaCanonical.view });
    eq('T2 transport は canonical projection と同一 token', deviceActivityToken(DEVICE_ACTIVITY), obs.fingerprint);
  }
  const claimSrc = stripComments(readFileSync(join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8'));
  check('T2 claim adapter が mapActivityRow を自前で呼ばない', !claimSrc.includes('mapActivityRow'));
  check('T2 claim adapter が activitySyncView を自前で呼ばない', !claimSrc.includes('activitySyncView'));

  // label map の重複が消えていること
  for (const rel of ['lib/contextBuilders/tutorContext.ts', 'lib/contextBuilders/tutorStudentContext.ts']) {
    const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    check(`T2 ${rel} が label 表を再宣言しない`, !src.includes("clubActivities: '部活動'"), rel);
  }
  eq('T2 label は 10 カテゴリ', Object.keys(ACTIVITY_CATEGORY_LABELS).length, 10);
}

// ── 3. token semantics ────────────────────────────────────────────────
function t3Token(): void {
  console.log('\n3. Token semantics');
  const token = deviceActivityToken(DEVICE_ACTIVITY);
  check('T3 token が算出できる', typeof token === 'string' && token.startsWith('efp1:'));
  eq('T3 決定性', deviceActivityToken(DEVICE_ACTIVITY), token);

  // key 順が変わっても同じ
  const reordered = Object.fromEntries(
    Object.entries(DEVICE_ACTIVITY as unknown as Record<string, unknown>).reverse(),
  ) as unknown as ActivityData;
  eq('T3 object key 順で変わらない', deviceActivityToken(reordered), token);

  // 内容が変われば変わる
  const changed = { ...(DEVICE_ACTIVITY as unknown as Record<string, unknown>),
    clubActivities: [{ clubName: '別の部活' }] } as unknown as ActivityData;
  check('T3 activity が変われば token も変わる', deviceActivityToken(changed) !== token);

  // kind independence
  const basicToken = deviceBasicInfoToken(DEVICE_BASIC);
  const otherBasic = { ...DEVICE_BASIC, grade: '高校2年' } as BasicInfo;
  eq('T3 basic_info を変えても activity token は不変', deviceActivityToken(DEVICE_ACTIVITY), token);
  check('T3 basic_info を変えれば basic_info token は変わる', deviceBasicInfoToken(otherBasic) !== basicToken);
  eq('T3 activity を変えても basic_info token は不変', deviceBasicInfoToken(DEVICE_BASIC), basicToken);

  // token に本文が出ない
  check('T3 token に活動本文が出ない', !String(token).includes(SECRET));
}

// ── 4. claim composition / header ─────────────────────────────────────
function t4Claim(): void {
  console.log('\n4. Claim composition');
  const before = serializeDeviceClaim(buildTutorDeviceClaimEntries(DEVICE_BASIC, null, null));
  const after = serializeDeviceClaim(buildTutorDeviceClaimEntries(DEVICE_BASIC, null, DEVICE_ACTIVITY));
  const bytes = (v: string | null) => new TextEncoder().encode(v ?? '').length;
  console.log(`  info  header bytes: basic_info only = ${bytes(before)} / +activity = ${bytes(after)}`);

  const parsedAfter = JSON.parse(after ?? '{}') as { c: { kind: string; token: string }[] };
  eq('T4 entry 順は basic_info → activity', parsedAfter.c.map((e) => e.kind), ['basic_info', 'activity']);
  check('T4 上限内', bytes(after) <= EXAM_DEVICE_CLAIM_MAX_BYTES, String(bytes(after)));

  // basic_info の token / 挙動が壊れていない
  const parsedBefore = JSON.parse(before ?? '{}') as { c: { kind: string; token: string }[] };
  eq('T4 basic_info token は activity 追加で変わらない',
    parsedAfter.c[0].token, parsedBefore.c[0].token);

  // claim size が data size に比例しない
  const big = { ...(DEVICE_ACTIVITY as unknown as Record<string, unknown>),
    clubActivities: Array.from({ length: 200 }, (_, i) => ({ clubName: `c${i}`, description: SECRET.repeat(20) })),
  } as unknown as ActivityData;
  const bigHeader = serializeDeviceClaim(buildTutorDeviceClaimEntries(DEVICE_BASIC, null, big));
  eq('T4 活動量が増えても header サイズは変わらない', bytes(bigHeader), bytes(after));
  check('T4 大量データでも本文が header に出ない', !(bigHeader ?? '').includes(SECRET));

  // raw content 非混入
  for (const needle of [SECRET, '吹奏楽部', '清掃活動', 'userId', 'activity_logs']) {
    check(`T4 header に "${needle}" が出ない`, !(after ?? '').includes(needle));
  }

  // parser は generic のまま activity を通す
  const parsed = parseDeviceClaimValue(after);
  eq('T4 parser が activity を通す', Object.keys(parsed.claims).sort(), ['activity', 'basic_info']);

  // purpose gate
  const denied = toDeviceClaims(parsed, {
    authenticatedUserId: USER_A, allowedSources: sourcesForPurpose('essay_chat'),
  });
  check('T4 activity を許可しない purpose では落とす', !('activity' in denied));
  const allowed = toDeviceClaims(parsed, {
    authenticatedUserId: USER_A, allowedSources: sourcesForPurpose('tutor'),
  });
  check('T4 tutor では activity を採用', 'activity' in allowed);

  // spoof 耐性
  const spoof = parseDeviceClaimValue(JSON.stringify({
    v: 'edc1',
    c: [{ kind: 'activity', token: 'efp1:' + 'a'.repeat(64), verified: true, table: 'profiles', userId: 'other' }],
  }));
  const spoofed = toDeviceClaims(spoof, { authenticatedUserId: USER_A, allowedSources: sourcesForPurpose('tutor') });
  const flat = JSON.stringify(spoofed);
  check('T4 verified flag は無視', !flat.includes('"verified"'));
  check('T4 table 指定は無視', !flat.includes('profiles'));
  check('T4 別 userId は無視', !flat.includes('other'));
}

// ── 5. verification matrix ────────────────────────────────────────────
async function t5Matrix(): Promise<void> {
  console.log('\n5. Verification matrix');
  const token = deviceActivityToken(DEVICE_ACTIVITY);

  const matching = await assemble({ claim: token });
  eq('T5 matching → verified', matching.source?.syncStatus, 'verified');
  eq('T5 matching → available', matching.source?.state, 'available');
  eq('T5 matching → block present', matching.block?.presence, 'present');
  eq('T5 matching → block content は件数表現', matching.block?.content, EXPECTED_COUNTS);
  eq('T5 matching → origin は server', matching.source?.origin, 'server');

  const absent = await assemble();
  eq('T5 absent → unclaimed', absent.source?.syncStatus, 'unclaimed');
  eq('T5 absent → unverified', absent.source?.state, 'unverified');
  eq('T5 absent → block missing', absent.block?.presence, 'missing');

  const stale = await assemble({
    claim: deviceActivityToken({ ...(DEVICE_ACTIVITY as unknown as Record<string, unknown>),
      clubActivities: [] } as unknown as ActivityData),
  });
  check('T5 stale → verified にならない', stale.source?.syncStatus !== 'verified', String(stale.source?.syncStatus));
  eq('T5 stale → block missing', stale.block?.presence, 'missing');

  const mismatch = await assemble({ claim: 'efp1:' + 'b'.repeat(64) });
  check('T5 mismatch → verified にならない', mismatch.source?.syncStatus !== 'verified');
  eq('T5 mismatch → block missing', mismatch.block?.presence, 'missing');

  const empty = await assemble({ rows: [] });
  eq('T5 server 0 行 → empty', empty.source?.state, 'empty');
  eq('T5 empty → block missing', empty.block?.presence, 'missing');

  const unreadable = await assemble({ errors: { activity_logs: { code: '42P01', message: 'x' } } });
  eq('T5 read error → unreadable', unreadable.source?.state, 'unreadable');
  eq('T5 unreadable → block missing', unreadable.block?.presence, 'missing');

  // 全カテゴリ空の payload → 件数 0 → block を出さない
  const allEmpty = await assemble({
    rows: [activityRow({ clubActivities: [], volunteerActivities: [] })],
    claim: deviceActivityToken({ clubActivities: [], volunteerActivities: [] } as unknown as ActivityData),
  });
  eq('T5 全カテゴリ空では block を出さない', allEmpty.block?.presence, 'missing');

  const denied = await assemble({ purpose: 'essay_chat' });
  eq('T5 purpose 不許可 → denied_by_purpose', denied.source?.state, 'denied_by_purpose');
  eq('T5 purpose 不許可 → query 0 本',
    denied.rec.trace.filter((t) => t.table === 'activity_logs').length, 0);
}

// ── 6. privacy / boundedness ──────────────────────────────────────────
async function t6Privacy(): Promise<void> {
  console.log('\n6. Privacy');
  const { ctx, block, resolved } = await assemble({ claim: deviceActivityToken(DEVICE_ACTIVITY) });
  check('T6 block content に本文が出ない', !(block?.content ?? '').includes(SECRET));
  check('T6 block content に活動名が出ない', !(block?.content ?? '').includes('吹奏楽部'));
  eq('T6 block content は件数表現のみ', block?.content, EXPECTED_COUNTS);
  check('T6 canonical context に本文が出ない', !JSON.stringify(ctx).includes(SECRET));
  eq('T6 resolved input の件数表現が一致', resolved.activityCategoryCounts, EXPECTED_COUNTS);
}

// ── 7. shadow / query / isolation ─────────────────────────────────────
async function t7Shadow(): Promise<void> {
  console.log('\n7. Shadow / query / isolation');
  const token = deviceActivityToken(DEVICE_ACTIVITY);

  const run = async (claim: string | null | undefined, legacyCounts: string | null) => {
    const a = await assemble(claim === undefined ? {} : { claim });
    const before = a.rec.trace.length;
    const cmp = compareTutorShadow({
      legacy: { activityCategoryCounts: legacyCounts },
      canonicalInput: a.resolved, context: a.ctx,
    });
    return { cmp, extra: a.rec.trace.length - before,
      diff: cmp.entries.find((e) => e.field === 'activity.categoryCounts'),
      reads: before };
  };

  const m = await run(token, EXPECTED_COUNTS);
  eq('T7 shadow MATCH', m.diff?.diff, 'MATCH');
  eq('T7 MATCH 時の origin は server', m.diff?.canonicalOrigin, 'server');
  eq('T7 compare は追加 read を出さない', m.extra, 0);
  console.log(`  info  canonical query count = ${m.reads}`);

  const s = await run(undefined, EXPECTED_COUNTS);
  eq('T7 claim 無しは STATUS_MISMATCH', s.diff?.diff, 'STATUS_MISMATCH');

  const v = await run(token, '部活動9件');
  eq('T7 値違いは VALUE_MISMATCH', v.diff?.diff, 'VALUE_MISMATCH');

  // ★ VALUE_MISMATCH こそ値が漏れやすい ★
  //   S5-P5 の負例 N5 で、`reason` に legacy / canonical の実値を載せても
  //   どの guard も落ちないことが判明した（MATCH 経路しか見ていなかった）。
  //   shadow entry が持ってよいのは field id / diff kind / origin / status / reason の
  //   **enum 相当**だけであり、値そのもの・block content・claim token は出さない（E-S13 / §13）。
  const vJson = JSON.stringify(v.cmp);
  check('T7 mismatch 時も diff に活動本文が出ない', !vJson.includes(SECRET));
  check('T7 mismatch 時に canonical block content が出ない', !vJson.includes(EXPECTED_COUNTS));
  check('T7 mismatch 時に legacy の実値が出ない', !vJson.includes('部活動9件'));
  check('T7 mismatch 時に claim token（fingerprint）が出ない',
    token !== null && !vJson.includes(token));
  //   reason は自由文字列なので、値を載せない enum 相当であることを明示的に固定する。
  //   （型上は enum だが、型を広げる変更が入っても runtime で落ちるようにしておく。
  //     負例 N5 はまさに `reason` を自由文字列へ広げる形の leak だった。）
  const reasons = v.cmp.entries
    .map((e) => e.reason as unknown)
    .filter((r): r is string => typeof r === 'string');
  check('T7 reason は既知の enum 相当のみ',
    reasons.every((r) => /^[a-z_]+$/.test(r)), reasons.join(' | '));

  const r = m.cmp.readiness.find((x) => x.kind === 'activity');
  eq('T7 MATCH なら activity は READY', r?.readiness, 'READY');
  check('T7 diff に活動本文が出ない', !JSON.stringify(m.cmp).includes(SECRET));

  // query 数は claim の有無で変わらない
  const withClaim = await assemble({ claim: token });
  const without = await assemble();
  eq('T7 claim の有無で query 数が変わらない',
    withClaim.ctx.diagnostics.sourceQueryCount, without.ctx.diagnostics.sourceQueryCount);

  // multi-tab isolation
  const tabA = await assemble({ claim: token, request: new Request('https://example.test/tabA') });
  const tabB = await assemble({ claim: 'efp1:' + 'c'.repeat(64), request: new Request('https://example.test/tabB') });
  eq('T7 tab A（一致）は verified', tabA.source?.syncStatus, 'verified');
  check('T7 tab B（不一致）は verified にならない', tabB.source?.syncStatus !== 'verified');
  eq('T7 tab B は block を出さない', tabB.block?.presence, 'missing');
}

// ── 8. schema version / registry / consumer ───────────────────────────
function stripComments(src: string): string {
  return src.split('\n').filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  }).join('\n');
}

function t8Static(): void {
  console.log('\n8. Schema version / registry / consumer');
  // writer / device / DDL の schema_version 整合
  const writer = readFileSync(join(ROOT, 'lib/supabase/activityLogs.ts'), 'utf8');
  const wm = /const SCHEMA_VERSION = "([^"]+)"/.exec(writer);
  check('T8 writer の schema_version を読める', wm !== null);
  const ddl = readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8');
  const ddlDefault = /CREATE TABLE activity_logs[\s\S]*?schema_version\s+text\s+NOT NULL DEFAULT '([^']+)'/.exec(ddl);
  check('T8 DDL default を読める', ddlDefault !== null);
  if (wm && ddlDefault) {
    eq('T8 writer と DDL default が一致（drift なし）', wm[1], ddlDefault[1]);
  }

  const spec = EXAM_CONTEXT_BLOCK_REGISTRY.activity_category_counts;
  eq('T8 sourceKind は activity', spec.sourceKind, 'activity');
  eq('T8 provenance は user_authored', spec.provenance, 'user_authored');
  eq('T8 derivation は deterministic', spec.derivation, 'deterministic');
  eq('T8 heading を持たない', spec.headingOwner, 'none');

  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  // ★ S5-P3: consumer path 全体を見る ★
  //   本 lineage では prompt 合成が `composeTutorPrompt`（純関数）へ抽出済みで、
  //   section builder の呼び出しは route ではなくそちらにある。
  //   不変条件は「legacy の Supabase section が今も組み立てられていること」なので、
  //   route 単体ではなく consumer path（route + composeTutorPrompt）を対象にする。
  //   ★ import 行を除いた本体で「呼ばれている」ことを見る ★
  //     単なる出現検査は、呼び出しの差し替え（import だけ残る）を見逃す。
  const consumerPath = [route, readFileSync(join(ROOT, 'lib/tutor/composeTutorPrompt.ts'), 'utf8')]
    .map((src) => src.split('\n').filter((l) => !/^\s*import /.test(l)).join('\n'))
    .join('\n');
  check('T8 legacy の Supabase section が残っている',
    /buildTutorSupabaseContextSection\s*\(/.test(consumerPath));
  check('T8 legacy section builder が実体として存在する',
    readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8')
      .includes('export function buildTutorSupabaseContextSection'));
  // canonical block が prompt へ入っていない
  //
  // ★ 修正（S5-P5 promotion）★ source 側の実装は
  //   `route.indexOf('buildTutorUserPrompt')` を anchor に ±1500 字の window を
  //   検査していた。この識別子は file 冒頭の見出しコメントにも現れるため window が
  //   file 先頭に張られ、実際の prompt 組み立て位置を検査できていなかった
  //   （S5-P4 で stage 5.2 側に同じ defect が見つかっている）。
  //   コメント行を除いた実コード上で **呼び出し形**に anchor し、
  //   固定 window ではなく prompt 組み立て「以降すべて」を検査する。
  const routeCode = route
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  // ★ S5-P3: 実在する組み立て呼び出しのうち最も早いものへ anchor を広げた ★
  //   `= buildTutorUserPrompt(` 固定では、prompt 合成が composeTutorPrompt へ
  //   抽出された本 lineage で anchor が消えて検査が空回りする（stage5-2 と同一の retarget）。
  const promptAnchors = ['= composeTutorPrompt(', '= buildTutorUserPrompt(']
    .map((a) => routeCode.indexOf(a))
    .filter((i) => i !== -1);
  const promptIdx = promptAnchors.length > 0 ? Math.min(...promptAnchors) : -1;
  check('T8 prompt 組み立て位置を特定できる', promptIdx !== -1);
  if (promptIdx !== -1) {
    const afterPrompt = routeCode.slice(promptIdx);
    check('T8 prompt 以降に activity_category_counts が現れない',
      !afterPrompt.includes('activity_category_counts'));
    check('T8 prompt 以降に shadowResolvedInput が現れない',
      !afterPrompt.includes('shadowResolvedInput'));
    // optional chaining（`.context?.blocks`）でも抜けないよう正規表現で見る。
    check('T8 prompt 以降に canonical block 配列が現れない',
      !/\.context\??\.blocks/.test(afterPrompt));
  }
  const legacyActivity = readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8');
  check('T8 legacy が canonical block を import しない', !legacyActivity.includes('examSpine/blocks'));
  check('T8 legacy が canonical context を import しない', !legacyActivity.includes('examSpine/context'));
  // 書き込みが無い
  const claimSrc = stripComments(readFileSync(join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8'));
  check('T8 claim 層に mutation が無い', !/\.(insert|upsert|update|delete|rpc)\s*\(/.test(claimSrc));
  const page = readFileSync(join(ROOT, 'app/tutor/page.tsx'), 'utf8');
  check('T8 client は device canonical を読むだけ', page.includes('loadActivityData()'));
}


// ── 9. Stage 5.3 の境界（5.4 以降を巻き込んでいないこと）─────────────────
//
//   Stage 5.3 は activity block ＋ activity device claim だけを昇格する packet である。
//   source lineage には 5.4（self_analysis claim）/ 5.5（history comparison window）/
//   5.6（statement_review）/ その先の interview_record が続いており、
//   cherry-pick 時に混入しやすい。
//
//   ★ registry の membership だけでは足りない ★
//     5.4 / 5.6 は **既存 block を再利用**して claim kind だけを足すため、
//     block 集合を見ても検出できない。したがって
//       (a) tutor plan の block 列
//       (b) tutor が申告する claim kind 集合（**実ソースから抽出** = arity 非依存）
//       (c) 後続 stage が新設する block id の不在
//     の 3 点を pin する。
function t9Boundary(): void {
  console.log('\n9. Stage 5.3 boundary');

  // (a) tutor plan の block 列 — Stage 5.1 / 5.2 / 5.3 の 3 つだけ。
  const tutorBlocks = EXAM_PURPOSE_PLANS.tutor.blocks.map((b) => b.id);
  eq('T9 tutor plan の block は 5.1 + 5.2 + 5.3 の 3 つだけ', tutorBlocks, [
    'tutor_student_context',
    'diagnosis_type_hint',
    'activity_category_counts',
  ]);

  // (b) tutor claim kind — **実ソースから抽出**する。
  //     `buildTutorDeviceClaimEntries()` を呼ぶだけの検査は、後続 stage が
  //     引数を増やした場合に「渡さなければ出ない」ので混入を見逃す（arity 依存）。
  //     push している kind literal を関数本体から直接読み取る。
  const claimSrc = readFileSync(join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8');
  const fnIdx = claimSrc.indexOf('export function buildTutorDeviceClaimEntries(');
  check('T9 claim 組み立て関数を特定できる', fnIdx !== -1);
  const fnBody = fnIdx === -1 ? '' : claimSrc.slice(fnIdx);
  const declaredKinds = Array.from(fnBody.matchAll(/entries\.push\(\{\s*kind:\s*'([a-z_]+)'/g))
    .map((m) => m[1])
    .sort();
  eq('T9 tutor の claim kind は 5.1-5.4 の 4 つのみ', declaredKinds, [
    'activity',
    'basic_info',
    'diagnosis',
    'self_analysis',
  ]);

  // (c) 後続 stage が新設する block id が registry に無い。
  //     interview_record（5.6 の先）は `interview_issue_line` を新設する。
  const blockIds = Object.keys(EXAM_CONTEXT_BLOCK_REGISTRY);
  check('T9 activity_category_counts が登録されている', blockIds.includes('activity_category_counts'));
  for (const later of ['interview_issue_line']) {
    check(`T9 後続 stage の block \`${later}\` が混入していない`, !blockIds.includes(later));
  }

  // (d) consumer switch は行われていない — first consumer / slot の pin が動いていない。
  const entry = readFileSync(join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_STAGE5_ENTRY.md'), 'utf8');
  check('T9 FIRST_STAGE5_CONSUMER=tutor のまま', /FIRST_STAGE5_CONSUMER\s*=\s*tutor\b/.test(entry));
  check('T9 FIRST_STAGE5_SLOT=basic_info のまま（activity へ切り替えない）',
    /FIRST_STAGE5_SLOT\s*=\s*basic_info\b/.test(entry));

  // (e) Stage 5.5 の **feature** を巻き込んでいない。
  //
  //     ★ S5-P5 の分類を S5-P6 で訂正した ★
  //       `selectDeviceSyncWindow` を「5.5 の read-cap window」として禁止していたが
  //       誤分類だった。これは Stage 5.4 の claim parity の前提となる device 側の
  //       選択規則（E-S47）であり、canonical source の可読性は変えない。
  //       Stage 5.5 の feature は assemble.server.ts / adapters/types.ts 側にある
  //       「truncated を unreadable にしない」semantics のほうである。
  const adapterTypes = readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/types.ts'), 'utf8');
  const smcIdx = adapterTypes.indexOf('export function serverMirrorCandidate(');
  const smcBody = smcIdx === -1 ? '' : adapterTypes.slice(smcIdx, smcIdx + 1200);
  check('T9 Stage 5.5 feature（windowed opt-in）が混入していない', !/\bwindowed\b/.test(smcBody));
  const assembler = readFileSync(join(ROOT, 'lib/examSpine/context/assemble.server.ts'), 'utf8');
  check('T9 assembler は truncated を unreadable のままにしている',
    /readStatus === 'truncated'/.test(assembler));
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5.3] Activity device claim wiring');
  t1Authority();
  t2SingleAuthority();
  t3Token();
  t4Claim();
  await t5Matrix();
  await t6Privacy();
  await t7Shadow();
  t8Static();
  t9Boundary();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage5.3] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1; return;
  }
  console.log(`\n[exam-spine-stage5.3] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-stage5.3] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage5.3] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1; return;
  }
  console.log('[exam-spine-stage5.3] PASS');
}
void main();
