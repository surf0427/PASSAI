// Exam Spine — Stage 5.2 diagnosis block canonicalization の check。
//
// 目的: Tutor migration blocker G1（diagnosis block）が解消したことを実証する。
//   legacy の diagnosis.typeHint と canonical の diagnosis_type_hint block が
//   **同じ言い換え表を通って同じ値になる**こと、
//   status / origin / empty / purpose gate の各 semantics が正しいことを確認する。
//
// 実 Supabase / 実 AI を使わない（fake executor のみ）。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let fetchCallCount = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage5.2] 外部通信: ${String(args[0])}`);
}) as typeof realFetch;

import type { DiagnosisResult } from '@/lib/diagnosisStorage';
import {
  EXAM_DIAGNOSIS_TYPE_HINTS,
  LEGACY_DIAGNOSIS_TYPE_HINTS,
  resolveDiagnosisTypeHint,
} from '@/lib/examDiagnosis/tutorHints';
import { deviceDiagnosisToken } from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import { buildCanonicalExamContext } from '@/lib/examSpine/context/assemble.server';
import { compareTutorShadow } from '@/lib/examSpine/context/shadow/compareTutor';
import { EXAM_CONTEXT_BLOCK_REGISTRY } from '@/lib/examSpine/blocks/registry';
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
const DIAGNOSIS: DiagnosisResult = {
  resultType: 'challenger',
  resultTitle: 'チャレンジャー型',
  resultDescription: '挑戦を恐れないタイプです',
  answers: [1, 2, 3, 4],
  createdAt: '2026-01-01T00:00:00.000Z',
} as unknown as DiagnosisResult;

const EXPECTED_HINT = EXAM_DIAGNOSIS_TYPE_HINTS.challenger;

function diagnosisRow(payload: unknown, schemaVersion = '3'): Record<string, unknown> {
  return {
    id: 'dg-1', user_id: USER_A, payload,
    schema_version: schemaVersion, source_hash: 'x',
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function dbWith(rows: Record<string, unknown>[]): FakeDb {
  return { tables: { diagnosis_logs: rows } } as FakeDb;
}

const authorizeA = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A });

async function assemble(opts: {
  rows?: Record<string, unknown>[];
  claim?: string | null;
  purpose?: 'tutor' | 'essay_chat';
  errors?: Record<string, { code: string; message: string }>;
} = {}) {
  const database = dbWith(opts.rows ?? [diagnosisRow(DIAGNOSIS)]);
  if (opts.errors) (database as FakeDb).errors = opts.errors;
  const rec = createRecordingExecutor(database);
  const r = await buildCanonicalExamContext({
    request: new Request('https://example.test/s52/' + Math.abs(JSON.stringify(opts).length)),
    purpose: opts.purpose ?? 'tutor',
    authorize: authorizeA,
    bridge: {},
    deviceClaims: opts.claim === undefined ? undefined
      : ({ diagnosis: { presented: true, fingerprint: opts.claim } } as never),
    executor: rec.executor,
    projectionNow: '2026-01-01T00:00:00.000Z',
  });
  if (!r.ok) throw new Error('veto: ' + r.veto.reasons.join(','));
  const block = r.context.blocks.find((b) => b.id === 'diagnosis_type_hint');
  const source = r.context.sources.find((s) => s.kind === 'diagnosis');
  return { ctx: r.context, block, source, rec, resolved: r.shadowResolvedInput };
}

// ── 1. authority / query ──────────────────────────────────────────────
function t1Authority(): void {
  console.log('\n1. Diagnosis authority');
  const q = Q.diagnosisQuery('00000000-0000-4000-8000-000000000000');
  eq('T1 table は diagnosis_logs', q.table, 'diagnosis_logs');
  eq('T1 mode は maybeSingle（1 user 1 行）', q.mode, 'maybeSingle');
  eq('T1 ordering を持たない（snapshot）', q.order, []);
  eq('T1 limit は null（cap 不要）', q.limit, null);
  check('T1 owner filter を持つ', q.filters.some((f) => f.op === 'eq' && f.column === 'user_id'));
  check('T1 tutor purpose が diagnosis を許可', sourcesForPurpose('tutor').includes('diagnosis'));
  check('T1 essay_chat は diagnosis を許可しない', !sourcesForPurpose('essay_chat').includes('diagnosis'));
}

// ── 2. 言い換え表の単一 authority ─────────────────────────────────────
function t2Hints(): void {
  console.log('\n2. Hint resolver');
  eq('T2 ExamType を解決', resolveDiagnosisTypeHint('challenger'), EXAM_DIAGNOSIS_TYPE_HINTS.challenger);
  eq('T2 legacy number を解決', resolveDiagnosisTypeHint(2), LEGACY_DIAGNOSIS_TYPE_HINTS[2]);
  eq('T2 未知 number は null', resolveDiagnosisTypeHint(99), null);
  eq('T2 未知 string は null', resolveDiagnosisTypeHint('nope'), null);
  eq('T2 null は null', resolveDiagnosisTypeHint(null), null);
  eq('T2 object は null', resolveDiagnosisTypeHint({}), null);

  // legacy 側が同じ resolver を使っている（2 箇所に置かない）
  const legacy = readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8');
  check('T2 legacy が resolver へ委譲する', legacy.includes('resolveDiagnosisTypeHint'));
  check('T2 legacy に hint 表が残っていない', !legacy.includes('何から手をつけるかを一緒に整理'));
}

// ── 3. block presence semantics ───────────────────────────────────────
async function t3Presence(): Promise<void> {
  console.log('\n3. Block presence');
  const token = deviceDiagnosisToken(DIAGNOSIS);

  const ok = await assemble({ claim: token });
  eq('T3 verified なら source は available', ok.source?.state, 'available');
  eq('T3 verified なら block は present', ok.block?.presence, 'present');
  eq('T3 block content は hint そのもの', ok.block?.content, EXPECTED_HINT);

  const noClaim = await assemble();
  eq('T3 claim 無しは unverified', noClaim.source?.state, 'unverified');
  eq('T3 unverified なら block は missing', noClaim.block?.presence, 'missing');
  eq('T3 unverified なら content は空', noClaim.block?.content, '');

  const mismatch = await assemble({ claim: 'efp1:' + 'a'.repeat(64) });
  eq('T3 mismatch も unverified', mismatch.source?.state, 'unverified');
  eq('T3 mismatch なら block は missing', mismatch.block?.presence, 'missing');

  const empty = await assemble({ rows: [] });
  eq('T3 0 行は empty', empty.source?.state, 'empty');
  eq('T3 empty なら block は missing', empty.block?.presence, 'missing');

  const unreadable = await assemble({ errors: { diagnosis_logs: { code: '42P01', message: 'x' } } });
  eq('T3 read error は unreadable', unreadable.source?.state, 'unreadable');
  eq('T3 unreadable なら block は missing', unreadable.block?.presence, 'missing');

  // resultType が解決できない payload → hint 無し → block 無し
  const unknown = await assemble({ rows: [diagnosisRow({ resultType: 'zzz' })], claim: null });
  eq('T3 解決できない resultType では block が出ない', unknown.block?.presence, 'missing');

  // purpose denied
  const denied = await assemble({ purpose: 'essay_chat' });
  eq('T3 purpose 不許可は denied_by_purpose', denied.source?.state, 'denied_by_purpose');
  eq('T3 purpose 不許可では query 0 本',
    denied.rec.trace.filter((t) => t.table === 'diagnosis_logs').length, 0);
}

// ── 4. boundedness / privacy ──────────────────────────────────────────
async function t4Bounded(): Promise<void> {
  console.log('\n4. Boundedness / privacy');
  const token = deviceDiagnosisToken(DIAGNOSIS);
  const { ctx, block, resolved } = await assemble({ claim: token });

  const forbidden = ['チャレンジャー型', '挑戦を恐れないタイプです', 'resultTitle', 'resultDescription', 'answers'];
  for (const needle of forbidden) {
    check(`T4 block content に "${needle}" が無い`, !(block?.content ?? '').includes(needle));
    check(`T4 canonical context に "${needle}" が無い`, !JSON.stringify(ctx).includes(needle));
  }
  // resolved input は hint 文字列だけを持ち、payload を持たない
  eq('T4 resolved input は hint のみ', resolved.diagnosisTypeHint, EXPECTED_HINT);
  check('T4 resolved input に payload が無い', !JSON.stringify(resolved).includes('resultTitle'));

  check('T4 block content は 120 字以内', (block?.content ?? '').length <= 120);
}

// ── 5. determinism ────────────────────────────────────────────────────
async function t5Determinism(): Promise<void> {
  console.log('\n5. Determinism');
  const token = deviceDiagnosisToken(DIAGNOSIS);
  const a = await assemble({ claim: token });
  const b = await assemble({ claim: token });
  eq('T5 同入力で block content 一致', a.block?.content, b.block?.content);
  eq('T5 同入力で fingerprint 一致', a.ctx.fingerprint, b.ctx.fingerprint);

  // diagnosis が変われば fingerprint も変わる
  const other = { ...DIAGNOSIS, resultType: 'creator' } as unknown as DiagnosisResult;
  const c = await assemble({ rows: [diagnosisRow(other)], claim: deviceDiagnosisToken(other) });
  eq('T5 別 resultType なら別 hint', c.block?.content, EXAM_DIAGNOSIS_TYPE_HINTS.creator);
  check('T5 別 diagnosis なら fingerprint も変わる', c.ctx.fingerprint !== a.ctx.fingerprint);
}

// ── 6. shadow comparison ──────────────────────────────────────────────
async function t6Shadow(): Promise<void> {
  console.log('\n6. Shadow comparison');
  const token = deviceDiagnosisToken(DIAGNOSIS);

  const run = async (opts: Parameters<typeof assemble>[0], legacyHint: string | null) => {
    const a = await assemble(opts);
    const before = a.rec.trace.length;
    const cmp = compareTutorShadow({
      legacy: { diagnosisTypeHint: legacyHint },
      canonicalInput: a.resolved,
      context: a.ctx,
    });
    return { cmp, extraReads: a.rec.trace.length - before,
      diff: cmp.entries.find((e) => e.field === 'diagnosis.typeHint') };
  };

  // MATCH — legacy が同じ resolver を通した値
  const legacyHint = resolveDiagnosisTypeHint(DIAGNOSIS.resultType as unknown);
  const m = await run({ claim: token }, legacyHint);
  eq('T6 MATCH（legacy と canonical が一致）', m.diff?.diff, 'MATCH');
  eq('T6 MATCH 時の origin は server', m.diff?.canonicalOrigin, 'server');
  eq('T6 MATCH 時の syncStatus は verified', m.diff?.syncStatus, 'verified');
  eq('T6 compare は追加 read を出さない', m.extraReads, 0);

  // STATUS_MISMATCH — claim 無し
  const s = await run({}, legacyHint);
  eq('T6 STATUS_MISMATCH（claim 無し）', s.diff?.diff, 'STATUS_MISMATCH');

  // VALUE_MISMATCH — legacy と canonical で resultType が違う
  const v = await run({ claim: token }, LEGACY_DIAGNOSIS_TYPE_HINTS[1]);
  eq('T6 VALUE_MISMATCH（値が違う）', v.diff?.diff, 'VALUE_MISMATCH');

  // 双方空 → MATCH（空同士の一致）
  const e = await run({ rows: [] }, null);
  eq('T6 双方空は MATCH', e.diff?.diff, 'MATCH');

  // MISSING_CANONICAL — legacy にあり canonical が空（0 行）
  const mc = await run({ rows: [] }, legacyHint);
  eq('T6 MISSING_CANONICAL（canonical 側だけ空）', mc.diff?.diff, 'MISSING_CANONICAL');

  // diff に raw が出ない
  check('T6 diff に診断タイプ名が出ない', !JSON.stringify(m.cmp).includes('チャレンジャー型'));

  // readiness
  const r = m.cmp.readiness.find((x) => x.kind === 'diagnosis');
  eq('T6 diagnosis が readiness に含まれる', r?.kind, 'diagnosis');
  eq('T6 MATCH なら diagnosis は READY', r?.readiness, 'READY');
}

// ── 7. registry / consumer invariance ─────────────────────────────────
function t7Static(): void {
  console.log('\n7. Registry / consumer invariance');
  const spec = EXAM_CONTEXT_BLOCK_REGISTRY.diagnosis_type_hint;
  eq('T7 block の sourceKind は diagnosis', spec.sourceKind, 'diagnosis');
  eq('T7 provenance は system_metadata（app 製固定文）', spec.provenance, 'system_metadata');
  eq('T7 derivation は deterministic', spec.derivation, 'deterministic');
  eq('T7 heading を持たない', spec.headingOwner, 'none');

  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  // legacy diagnosis path が残っている
  check('T7 legacy の Supabase section が残っている', route.includes('buildTutorSupabaseContextSection'));
  // canonical block が prompt へ入っていない
  const promptIdx = route.indexOf('buildTutorUserPrompt');
  if (promptIdx !== -1) {
    const w = route.slice(Math.max(0, promptIdx - 1500), promptIdx + 1500);
    check('T7 prompt 付近に diagnosis_type_hint が現れない', !w.includes('diagnosis_type_hint'));
    check('T7 prompt 付近に shadowResolvedInput が現れない', !w.includes('shadowResolvedInput'));
  }
  const legacy = readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8');
  check('T7 legacy が canonical block を import しない', !legacy.includes('examSpine/blocks'));
  check('T7 legacy が canonical context を import しない', !legacy.includes('examSpine/context'));
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5.2] Diagnosis block canonicalization');
  t1Authority();
  t2Hints();
  await t3Presence();
  await t4Bounded();
  await t5Determinism();
  await t6Shadow();
  t7Static();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage5.2] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1; return;
  }
  console.log(`\n[exam-spine-stage5.2] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-stage5.2] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage5.2] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1; return;
  }
  console.log('[exam-spine-stage5.2] PASS');
}
void main();
