// Exam Spine — Stage 3 canonical reader contract check。
//
// 目的:
//   Stage 3 の read layer が
//     durable server source → canonical reader → ExamSourceBundle + 10 kind status
//   という契約を、**実 Supabase / 実ネットワークを一切使わずに**満たすことを機械的に示す。
//
// 厳守:
//   - 実ネットワーク 0 / AI 呼び出し 0（fetch を trap し、1 回でも呼ばれたら fail）
//   - production runtime を一切変更しない（本 script は読むだけ）
//   - fake executor で query shape（table / 列 / filter / ordering / limit）を freeze する
//
// 使い方:
//   npm run qa:examSpine:stage3

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── 1. 外部通信 trap（S28 / 実ネットワーク 0 の機械的証明）─────────
let fetchCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCallCount += 1;
  const target = typeof args[0] === 'string' ? args[0] : '(non-string input)';
  throw new Error(`[exam-spine-stage3] 外部通信が発生しました（Stage 3 では禁止）: ${target}`);
}) as typeof globalThis.fetch;
void originalFetch;

import { EXAM_SOURCE_KINDS, EXAM_SOURCE_TABLES } from '@/lib/examSpine/sourceData/types';
import type { ExamSourceKind } from '@/lib/examSpine/sourceData/types';
import { EXAM_READ_CAPS, formatSelect } from '@/lib/examSpine/read/types';
import type { ExamReadExecutor, ExamReadQuery } from '@/lib/examSpine/read/types';
import { readExamSources } from '@/lib/examSpine/read/readSources';
import { readExamSourcesForRequest } from '@/lib/examSpine/read/requestSnapshot.server';
import type { ExamRequestAuthorization } from '@/lib/examSpine/read/requestSnapshot.server';
import { mapInterviewAiRow } from '@/lib/examSpine/read/rowMappers';
import { unwrapEmbedded } from '@/lib/examSpine/read/guards';
import * as Q from '@/lib/examSpine/read/queries';

import {
  USER_A,
  USER_B,
  createRecordingExecutor,
  emptyDb,
  essayRows,
  fullDb,
  interviewAiResultRows,
  isoAt,
  presentationAttemptRows,
  presentationResultRows,
  presentationSessionRows,
  selfAnalysisRows,
  selfPrRows,
} from './fixtures/examSpineStage3';
import type { FakeDb, FakeRow } from './fixtures/examSpineStage3';

// ── 2. assertion helper ───────────────────────────────────────────
let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    return;
  }
  failures.push(detail ? `${label}\n      ${detail}` : label);
}

function eq<T>(label: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, `expected=${e}\n      actual  =${a}`);
}

const ALL: readonly ExamSourceKind[] = EXAM_SOURCE_KINDS;

/** filter を無視して固定行を返す executor。reader 自身の防御を単体で試すために使う。 */
function createRawExecutor(rowsByTable: Record<string, FakeRow[]>): ExamReadExecutor {
  return async (query: ExamReadQuery) => ({
    rows: rowsByTable[query.table] ?? [],
    error: null,
  });
}

// ── 3. S1–S3 基本ケース ───────────────────────────────────────────

async function s1AllSuccess(): Promise<void> {
  const rec = createRecordingExecutor(fullDb());
  const r = await readExamSources({ userId: USER_A, kinds: ALL, executor: rec.executor });

  check('S1 10 kind すべての status が返る', Object.keys(r.statuses).length === 10);
  const notOk = ALL.filter((k) => r.statuses[k] !== 'ok');
  check('S1 全 kind が ok', notOk.length === 0, `not ok: ${notOk.join(', ')}`);
  const nullSlots = ALL.filter((k) => r.bundle[slotOf(k)] === null);
  check('S1 成功 kind の slot が null でない', nullSlots.length === 0, nullSlots.join(', '));

  // basic_info / activity / diagnosis は present/absent 表現
  check('S1 snapshot kind が present 表現', valueState(r.bundle.basicInfo) === 'present');
  check('S1 history kind が配列', Array.isArray(r.bundle.selfAnalysisLogs));
  check('S1 log が全 kind 分', r.log.length === 10);
}

async function s2EmptyUser(): Promise<void> {
  const rec = createRecordingExecutor(emptyDb());
  const r = await readExamSources({ userId: USER_A, kinds: ALL, executor: rec.executor });

  const notOk = ALL.filter((k) => r.statuses[k] !== 'ok');
  check('S2 空ユーザーでも全 kind が ok', notOk.length === 0, `not ok: ${notOk.join(', ')}`);

  // ★ null + ok を作らない
  const nullWithOk = ALL.filter((k) => r.bundle[slotOf(k)] === null && r.statuses[k] === 'ok');
  check('S2 null + ok の曖昧状態が存在しない', nullWithOk.length === 0, nullWithOk.join(', '));

  check('S2 snapshot 0 行は absent（null ではない）', valueState(r.bundle.basicInfo) === 'absent');
  eq('S2 history 0 件は []', r.bundle.selfAnalysisLogs, []);
  eq('S2 presentation 0 件は []', r.bundle.presentation, []);
}

async function s3Partial(): Promise<void> {
  const db = emptyDb();
  db.tables.basic_info_logs = fullDb().tables.basic_info_logs;
  db.tables.self_analysis_logs = selfAnalysisRows(2);
  const rec = createRecordingExecutor(db);
  const r = await readExamSources({ userId: USER_A, kinds: ALL, executor: rec.executor });

  check('S3 埋まっている kind は present', valueState(r.bundle.basicInfo) === 'present');
  check('S3 空の kind は absent', valueState(r.bundle.activity) === 'absent');
  eq('S3 空 history は []', r.bundle.statementReviews, []);
  check('S3 部分的でも全 kind ok', ALL.every((k) => r.statuses[k] === 'ok'));
}

// ── 4. S4–S6 失敗と敵対的入力 ─────────────────────────────────────

async function s4PostgrestError(): Promise<void> {
  const db = fullDb();
  db.errors = { self_analysis_logs: { code: '42P01', message: 'relation does not exist' } };
  const rec = createRecordingExecutor(db);
  const r = await readExamSources({ userId: USER_A, kinds: ALL, executor: rec.executor });

  check('S4 失敗 kind は error', r.statuses.self_analysis === 'error');
  check('S4 失敗 kind の slot は null', r.bundle.selfAnalysisLogs === null);
  const others = ALL.filter((k) => k !== 'self_analysis');
  check('S4 他 kind は継続（fail-open）', others.every((k) => r.statuses[k] === 'ok'),
    others.filter((k) => r.statuses[k] !== 'ok').join(', '));
}

async function s5ThrownError(): Promise<void> {
  const db = fullDb();
  db.throws = { essay_workspaces: 'boom: socket closed' };
  const rec = createRecordingExecutor(db);
  const r = await readExamSources({ userId: USER_A, kinds: ALL, executor: rec.executor });

  check('S5 throw も その kind だけ error', r.statuses.essay === 'error');
  check('S5 throw kind の slot は null', r.bundle.essayWorkspaces === null);
  check('S5 全体は throw しない（他 kind 継続）',
    ALL.filter((k) => k !== 'essay').every((k) => r.statuses[k] === 'ok'));
}

async function s6AdversarialJsonb(): Promise<void> {
  const db = emptyDb();
  db.tables.basic_info_logs = [{
    user_id: USER_A,
    payload: {
      grade: 12345,                       // string でない
      examTypes: 'not-an-array',
      // null / string / university が非 string の行は型不整合として落ちる。
      // `university: ''` は型として正しいので残る（空を使うかは consumer の判断）。
      preferences: [null, 'x', { university: 42 }, { university: '' }, { university: 'サンプル大学' }],
      subjectGrades: ['not', 'a', 'record'],
    },
    schema_version: null,
  }];
  db.tables.self_analysis_logs = [{
    id: null, analysis: 'not-an-object', summary: [], answers: 'nope',
    displayed_questions: [1, 2, null], deep_answers: null, free_memo: 999, created_at: 42,
  }];
  db.tables.presentation_results = [{ id: 'p1', user_id: USER_A, attempt_id: null, feedback: 'x', created_at: null }];

  const rec = createRecordingExecutor(db);
  const r = await readExamSources({ userId: USER_A, kinds: ALL, executor: rec.executor });

  check('S6 敵対的 jsonb でも throw しない', true);
  check('S6 敵対的 jsonb でも status は ok', r.statuses.basic_info === 'ok' && r.statuses.self_analysis === 'ok');
  const basic = presentRow(r.bundle.basicInfo) as Record<string, unknown> | null;
  eq('S6 string でない grade は null', basic?.grade ?? null, null);
  eq('S6 配列でない examTypes は []', basic?.examTypes ?? null, []);
  eq('S6 型不整合の preferences だけ落ちる（空文字は残す）',
    (basic?.preferences as unknown[])?.length ?? -1, 2);
  eq('S6 record でない subjectGrades は null', basic?.subjectGrades ?? null, null);
  // core が取れているので enrichment は発行される（attempt_id が null なので 0 件へ縮退）
  check('S6 attempt_id が null でも enrichment を暴走させない',
    rec.countFor('presentation_attempts') === 0, `count=${rec.countFor('presentation_attempts')}`);
}

// ── 5. S7–S8 cap ──────────────────────────────────────────────────

async function s7CapExactly(): Promise<void> {
  const db = emptyDb();
  db.tables.self_analysis_logs = selfAnalysisRows(EXAM_READ_CAPS.self_analysis);
  const rec = createRecordingExecutor(db);
  const r = await readExamSources({ userId: USER_A, kinds: ['self_analysis'], executor: rec.executor });

  check('S7 ちょうど cap 件は ok', r.statuses.self_analysis === 'ok');
  eq('S7 件数は cap のまま', (r.bundle.selfAnalysisLogs as unknown[]).length, EXAM_READ_CAPS.self_analysis);
  check('S7 truncated は false', r.outcomes.self_analysis.truncated === false);
  eq('S7 limit は cap + 1 で発行', rec.trace[0].limit, EXAM_READ_CAPS.self_analysis + 1);
}

async function s8CapPlusOne(): Promise<void> {
  const db = emptyDb();
  db.tables.self_analysis_logs = selfAnalysisRows(EXAM_READ_CAPS.self_analysis + 3);
  const rec = createRecordingExecutor(db);
  const r = await readExamSources({ userId: USER_A, kinds: ['self_analysis'], executor: rec.executor });

  check('S8 cap 超過は truncated', r.statuses.self_analysis === 'truncated');
  eq('S8 余剰行は drop され cap 件', (r.bundle.selfAnalysisLogs as unknown[]).length, EXAM_READ_CAPS.self_analysis);
  check('S8 count query を追加していない', rec.trace.length === 1, `queries=${rec.trace.length}`);
}

// ── 6. S9–S10 ordering ────────────────────────────────────────────

/** ordering の正本。ここを変えるのは仕様変更であり、意図的な判断を要求する。 */
const EXPECTED_ORDER: Record<string, string[]> = {
  basic_info_logs: [],
  activity_logs: [],
  diagnosis_logs: [],
  self_analysis_logs: ['created_at DESC', 'id DESC'],
  statement_review_history: ['created_at DESC', 'id DESC'],
  interview_practice_records: ['created_at DESC', 'id DESC'],
  essay_workspaces: ['updated_at DESC', 'created_at DESC', 'id DESC'],
  self_prs: ['updated_at DESC', 'created_at DESC', 'id DESC'],
  interview_ai_results: ['created_at DESC', 'id DESC'],
  presentation_results: ['created_at DESC', 'id DESC'],
};

async function s9Ordering(): Promise<void> {
  const rec = createRecordingExecutor(fullDb());
  await readExamSources({ userId: USER_A, kinds: ALL, executor: rec.executor });

  for (const [table, expected] of Object.entries(EXPECTED_ORDER)) {
    const entry = rec.trace.find((t) => t.table === table && t.role === 'core');
    check(`S9 ${table} の core query が存在`, Boolean(entry));
    if (entry) eq(`S9 ${table} ordering`, entry.order, expected);
  }

  // maybeSingle の 3 kind は user_id UNIQUE なので ordering 不要
  for (const table of ['basic_info_logs', 'activity_logs', 'diagnosis_logs']) {
    const entry = rec.trace.find((t) => t.table === table);
    check(`S9 ${table} は maybeSingle`, entry?.mode === 'maybeSingle');
    check(`S9 ${table} は limit を持たない`, entry?.limit === null);
  }

  // 全 query が owner scope を持つ
  const noOwner = rec.trace.filter((t) => !t.filters.some((f) => f === 'eq:user_id'));
  check('S9 全 query が eq:user_id を持つ', noOwner.length === 0,
    noOwner.map((t) => t.table).join(', '));

  // many query は必ず explicit limit を持つ（implicit unlimited が無い）
  const noLimit = rec.trace.filter((t) => t.mode === 'many' && t.limit === null);
  check('S9 many query は必ず limit を持つ', noLimit.length === 0, noLimit.map((t) => t.table).join(', '));
}

async function s10TimestampTie(): Promise<void> {
  // created_at / updated_at が同値の 3 行。id DESC だけが順序を決める。
  const tie = '2020-05-05T00:00:00.000Z';
  const rows: FakeRow[] = ['sa-001', 'sa-003', 'sa-002'].map((id) => ({
    id, user_id: USER_A, analysis: {}, summary: {},
    displayed_questions: [], answers: [], deep_answers: [], free_memo: '', created_at: tie,
  }));
  const db = emptyDb();
  db.tables.self_analysis_logs = rows;
  const rec = createRecordingExecutor(db);
  const r = await readExamSources({ userId: USER_A, kinds: ['self_analysis'], executor: rec.executor });

  const ids = (r.bundle.selfAnalysisLogs as { id: string }[]).map((x) => x.id);
  eq('S10 created_at 同値は id DESC で決定的に並ぶ', ids, ['sa-003', 'sa-002', 'sa-001']);

  // essay は updated_at 同値 → created_at → id
  const eTie = essayRows(3).map((row) => ({ ...row, updated_at: tie }));
  const db2 = emptyDb();
  db2.tables.essay_workspaces = eTie;
  const rec2 = createRecordingExecutor(db2);
  const r2 = await readExamSources({ userId: USER_A, kinds: ['essay'], executor: rec2.executor });
  const eIds = (r2.bundle.essayWorkspaces as { id: string }[]).map((x) => x.id);
  eq('S10 essay は updated_at 同値でも created_at → id で決定的', eIds, ['ws-003', 'ws-002', 'ws-001']);
}

async function s10bRecencyColumns(): Promise<void> {
  // self_pr: pr_index は updated_at と逆順に置いてある。recency に使っていれば順序が反転する。
  const db = emptyDb();
  db.tables.self_prs = selfPrRows(3);
  const rec = createRecordingExecutor(db);
  const r = await readExamSources({ userId: USER_A, kinds: ['self_pr'], executor: rec.executor });
  const prIds = (r.bundle.selfPrs as { id: string; prIndex: number }[]).map((x) => x.id);
  eq('S10b self_pr は pr_index ではなく updated_at DESC で並ぶ', prIds, ['pr-003', 'pr-002', 'pr-001']);

  // essay: workspace->>'updatedAt' は column と逆順。ORDER BY に使っていれば反転する。
  const db2 = emptyDb();
  db2.tables.essay_workspaces = essayRows(3);
  const rec2 = createRecordingExecutor(db2);
  const r2 = await readExamSources({ userId: USER_A, kinds: ['essay'], executor: rec2.executor });
  const eIds = (r2.bundle.essayWorkspaces as { id: string }[]).map((x) => x.id);
  eq('S10b essay は workspace->>updatedAt ではなく column updated_at で並ぶ', eIds, ['ws-003', 'ws-002', 'ws-001']);

  // statement_review が updated_at を order に持たないこと（recency に使わない）
  const entry = rec2.trace.find((t) => t.table === 'essay_workspaces');
  check('S10b essay の order に jsonb path が現れない',
    (entry?.order ?? []).every((o) => !o.includes('->')));
}

// ── 7. S11–S12 interview_ai ───────────────────────────────────────

async function s11ResultsDriven(): Promise<void> {
  // 最新 session（ses-009）は completed だが result が無い。
  // 旧方式（最新 completed session → その result）なら何も返らない。
  const db = emptyDb();
  db.tables.interview_ai_results = interviewAiResultRows(2); // res-001 / res-002
  db.tables.interview_ai_sessions = [
    { id: 'ses-009', user_id: USER_A, status: 'completed', created_at: isoAt(9) },
  ];
  const rec = createRecordingExecutor(db);
  const r = await readExamSources({ userId: USER_A, kinds: ['interview_ai'], executor: rec.executor });

  const rows = r.bundle.interviewAi as { id: string }[];
  check('S11 result 不在の最新 session があっても結果が返る', rows.length === 2, `len=${rows.length}`);
  eq('S11 driver は最新の result', rows[0]?.id, 'res-002');
  eq('S11 driver table は interview_ai_results', rec.trace[0].table, 'interview_ai_results');
  check('S11 interview_ai_sessions を driver として SELECT しない',
    rec.countFor('interview_ai_sessions') === 0);
  eq('S11 session は embed で解決する', rec.trace[0].embedTable, 'interview_ai_sessions');
  check('S11 ownership は session 側でも filter する',
    rec.trace[0].filters.includes('eq:session.user_id'), rec.trace[0].filters.join(', '));
}

async function s12EmbeddedShapes(): Promise<void> {
  // object 形
  const dbObj = emptyDb();
  dbObj.tables.interview_ai_results = interviewAiResultRows(1, { embedAs: 'object' });
  const rObj = await readExamSources({
    userId: USER_A, kinds: ['interview_ai'], executor: createRecordingExecutor(dbObj).executor,
  });
  eq('S12 embedded object を解決できる', (rObj.bundle.interviewAi as unknown[]).length, 1);

  // 配列形（PostgREST が to-many と推論した場合）
  const dbArr = emptyDb();
  dbArr.tables.interview_ai_results = interviewAiResultRows(1, { embedAs: 'array' });
  const rArr = await readExamSources({
    userId: USER_A, kinds: ['interview_ai'], executor: createRecordingExecutor(dbArr).executor,
  });
  eq('S12 embedded array を解決できる', (rArr.bundle.interviewAi as unknown[]).length, 1);

  // guard 単体: object / array / null / scalar すべてで throw しない
  check('S12 unwrapEmbedded(null) は null', unwrapEmbedded(null) === null);
  check('S12 unwrapEmbedded([]) は null', unwrapEmbedded([]) === null);
  check('S12 unwrapEmbedded("x") は null', unwrapEmbedded('x') === null);
  const limits = { shortText: 10, longText: 10, arrayItems: 2, arrayItemLength: 5, recordItems: 2 };
  const mappedNull = mapInterviewAiRow({ id: 'r', session: null }, limits);
  check('S12 embed が null でも mapper は throw せず session=null', mappedNull?.session === null);

  // reader は session を解決できない row を採用しない（所有未確認）
  const raw = createRawExecutor({
    interview_ai_results: [{ id: 'res-x', user_id: USER_A, session_id: 's', created_at: isoAt(1), session: null }],
  });
  const rDrop = await readExamSources({ userId: USER_A, kinds: ['interview_ai'], executor: raw });
  eq('S12 session 未解決の row は採用しない', (rDrop.bundle.interviewAi as unknown[]).length, 0);
  check('S12 その場合も status は ok（fail-open で減らすだけ）', rDrop.statuses.interview_ai === 'ok');
}

// ── 8. S13–S14 presentation enrichment ────────────────────────────

async function s13EnrichmentFailure(): Promise<void> {
  const db = emptyDb();
  db.tables.presentation_results = presentationResultRows(2);
  db.tables.presentation_attempts = presentationAttemptRows(2);
  db.tables.presentation_sessions = presentationSessionRows(2);
  db.errors = { presentation_sessions: { code: '42501', message: 'permission denied' } };

  const rec = createRecordingExecutor(db);
  const r = await readExamSources({ userId: USER_A, kinds: ['presentation'], executor: rec.executor });

  check('S13 enrichment 失敗でも core は成功', r.statuses.presentation === 'ok');
  check('S13 core の slot は null にならない', r.bundle.presentation !== null);
  check('S13 enrichmentFailed が立つ', r.outcomes.presentation.enrichmentFailed === true);
  const rows = r.bundle.presentation as { result: unknown; attempt: unknown; session: unknown }[];
  eq('S13 core 件数は維持', rows.length, 2);
  check('S13 attempt は取れている', rows[0].attempt !== null);
  check('S13 失敗した session は null', rows[0].session === null);
}

async function s14CoreAbsentNoEnrichment(): Promise<void> {
  const db = emptyDb(); // presentation_results = []
  const rec = createRecordingExecutor(db);
  const r = await readExamSources({ userId: USER_A, kinds: ['presentation'], executor: rec.executor });

  eq('S14 core 不在なら presentation は []', r.bundle.presentation, []);
  check('S14 status は ok', r.statuses.presentation === 'ok');
  eq('S14 enrichment query は 0 本（attempts）', rec.countFor('presentation_attempts'), 0);
  eq('S14 enrichment query は 0 本（sessions）', rec.countFor('presentation_sessions'), 0);
  eq('S14 発行 query は core の 1 本のみ', rec.trace.length, 1);
  eq('S14 outcome.queryCount も 1', r.outcomes.presentation.queryCount, 1);

  // core が取れれば enrichment は 2 本になる（対照）
  const db2 = emptyDb();
  db2.tables.presentation_results = presentationResultRows(1);
  db2.tables.presentation_attempts = presentationAttemptRows(1);
  db2.tables.presentation_sessions = presentationSessionRows(1);
  const rec2 = createRecordingExecutor(db2);
  const r2 = await readExamSources({ userId: USER_A, kinds: ['presentation'], executor: rec2.executor });
  eq('S14 core 存在時は enrichment 2 本', r2.outcomes.presentation.queryCount, 3);
  eq('S14 read graph は results → attempts → sessions',
    rec2.trace.map((t) => t.table),
    ['presentation_results', 'presentation_attempts', 'presentation_sessions']);
}

// ── 9. S15–S16 basicInfo.name / subset ────────────────────────────

async function s15NoName(): Promise<void> {
  const rec = createRecordingExecutor(fullDb());
  const r = await readExamSources({ userId: USER_A, kinds: ['basic_info'], executor: rec.executor });
  const row = presentRow(r.bundle.basicInfo) as Record<string, unknown>;

  check('S15 server row projection に name key が無い',
    !Object.prototype.hasOwnProperty.call(row, 'name'), Object.keys(row).join(', '));
  check('S15 nameOnServer は false リテラル', row.nameOnServer === false);
  check('S15 name を空文字で捏造していない',
    !JSON.stringify(row).includes('"name"'), JSON.stringify(row).slice(0, 200));
  // 読める field は読めている（name が無いだけで projection 自体は機能する）
  eq('S15 grade は読める', row.grade, '高校3年');
  eq('S15 preferences は読める', (row.preferences as unknown[]).length, 2);

  // query の列にも name が現れない（payload 丸ごとなので構造で確認）
  const cols = rec.trace[0].columns;
  check('S15 basic_info の SELECT に name 列が無い', !cols.includes('name'), cols.join(', '));
}

async function s16Subset(): Promise<void> {
  const rec = createRecordingExecutor(fullDb());
  const subset: ExamSourceKind[] = ['basic_info', 'activity'];
  const r = await readExamSources({ userId: USER_A, kinds: subset, executor: rec.executor });

  check('S16 要求した kind は ok', subset.every((k) => r.statuses[k] === 'ok'));
  const rest = ALL.filter((k) => !subset.includes(k));
  check('S16 要求しなかった kind は skipped', rest.every((k) => r.statuses[k] === 'skipped'),
    rest.filter((k) => r.statuses[k] !== 'skipped').join(', '));
  check('S16 skipped kind の slot は null', rest.every((k) => r.bundle[slotOf(k)] === null));
  eq('S16 skipped kind の queryCount は 0', r.outcomes.self_pr.queryCount, 0);
  eq('S16 発行 query は要求分だけ', rec.trace.length, 2);
  check('S16 10 kind 分の status を必ず返す', Object.keys(r.statuses).length === 10);
}

// ── 10. S17–S19 request snapshot ──────────────────────────────────

function authOk(userId: string) {
  let calls = 0;
  return {
    authorize: async (): Promise<ExamRequestAuthorization> => {
      calls += 1;
      return { ok: true, userId };
    },
    get calls() { return calls; },
  };
}

async function s17OverlappingConsumers(): Promise<void> {
  const rec = createRecordingExecutor(fullDb());
  const request = new Request('https://example.test/stage3');
  const auth = authOk(USER_A);

  const first = await readExamSourcesForRequest({
    request, authorize: auth.authorize, kinds: ['basic_info', 'activity'], executor: rec.executor,
  });
  check('S17 1 人目は ok', first.ok === true);
  eq('S17 1 人目は 2 kind を read', rec.trace.length, 2);

  const second = await readExamSourcesForRequest({
    request, authorize: auth.authorize, kinds: ['activity', 'self_analysis'], executor: rec.executor,
  });
  check('S17 2 人目も ok', second.ok === true);
  if (second.ok) {
    eq('S17 重複 kind は snapshot から返る', [...second.servedFromSnapshot], ['activity']);
    eq('S17 未取得 kind だけ追加 read', [...second.freshlyRead], ['self_analysis']);
    check('S17 2 人目にも両 kind の値が入る',
      second.result.statuses.activity === 'ok' && second.result.statuses.self_analysis === 'ok');
  }
  eq('S17 activity は 1 度しか読まれない（per-kind read-once）', rec.countFor('activity_logs'), 1);
  eq('S17 合計 query は 3 本', rec.trace.length, 3);
}

async function s18DifferentRequestNoReuse(): Promise<void> {
  const rec = createRecordingExecutor(fullDb());
  const auth = authOk(USER_A);
  const reqA = new Request('https://example.test/a');
  const reqB = new Request('https://example.test/b');

  await readExamSourcesForRequest({ request: reqA, authorize: auth.authorize, kinds: ['basic_info'], executor: rec.executor });
  await readExamSourcesForRequest({ request: reqB, authorize: auth.authorize, kinds: ['basic_info'], executor: rec.executor });

  eq('S18 別 Request では reuse せず再 read', rec.countFor('basic_info_logs'), 2);

  // 同一 Request なら 2 回目は読まない（対照）
  const rec2 = createRecordingExecutor(fullDb());
  const reqC = new Request('https://example.test/c');
  await readExamSourcesForRequest({ request: reqC, authorize: auth.authorize, kinds: ['basic_info'], executor: rec2.executor });
  await readExamSourcesForRequest({ request: reqC, authorize: auth.authorize, kinds: ['basic_info'], executor: rec2.executor });
  eq('S18 同一 Request では read 1 回', rec2.countFor('basic_info_logs'), 1);
}

async function s19AuthorizeOnCacheHit(): Promise<void> {
  const rec = createRecordingExecutor(fullDb());
  const request = new Request('https://example.test/auth');

  let mode: 'ok' | 'deny' = 'ok';
  let calls = 0;
  const authorize = async (): Promise<ExamRequestAuthorization> => {
    calls += 1;
    return mode === 'ok' ? { ok: true, userId: USER_A } : { ok: false, reason: 'unauthorized' };
  };

  const first = await readExamSourcesForRequest({ request, authorize, kinds: ['basic_info'], executor: rec.executor });
  check('S19 認可済みなら値が返る', first.ok === true);
  eq('S19 authorize は 1 回目で呼ばれる', calls, 1);

  // cache hit になるはずの 2 回目で認可を落とす
  mode = 'deny';
  const second = await readExamSourcesForRequest({ request, authorize, kinds: ['basic_info'], executor: rec.executor });
  eq('S19 cache hit でも authorize を再評価する', calls, 2);
  check('S19 認可失敗なら ok:false', second.ok === false);
  if (!second.ok) eq('S19 reason が伝わる', second.reason, 'unauthorized');
  check('S19 認可失敗時にデータを返さない', !('result' in second));
  eq('S19 認可失敗で追加 read をしない', rec.countFor('basic_info_logs'), 1);

  // 別 identity で認可された場合、前の entry を再利用しない
  const rec3 = createRecordingExecutor(fullDb());
  const reqD = new Request('https://example.test/d');
  let uid = USER_A;
  const authSwitch = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: uid });
  await readExamSourcesForRequest({ request: reqD, authorize: authSwitch, kinds: ['basic_info'], executor: rec3.executor });
  uid = USER_B;
  await readExamSourcesForRequest({ request: reqD, authorize: authSwitch, kinds: ['basic_info'], executor: rec3.executor });
  eq('S19 userId が変われば snapshot を再利用しない', rec3.countFor('basic_info_logs'), 2);
}

// ── 11. S20–S26 静的境界 ──────────────────────────────────────────

const REPO_ROOT = join(__dirname, '..');
const READ_DIR = join(REPO_ROOT, 'lib', 'examSpine', 'read');

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** コメント行を除いた実コード行だけを返す（文言中の語で誤検出しないため）。 */
function codeLines(file: string): string[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out: string[] = [];
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('*')) continue;
    out.push(raw);
  }
  return out;
}

function grepRead(patterns: readonly string[]): string[] {
  const hits: string[] = [];
  for (const file of listFiles(READ_DIR)) {
    for (const line of codeLines(file)) {
      for (const p of patterns) {
        if (line.includes(p)) hits.push(`${relative(REPO_ROOT, file)}: ${line.trim().slice(0, 100)}`);
      }
    }
  }
  return hits;
}

function staticBoundaries(): void {
  // S20 service_role
  const svc = grepRead(['SUPABASE_SERVICE_ROLE_KEY', 'serviceRoleClient', 'service_role', 'createClient(']);
  check('S20 service_role / privileged client を参照しない', svc.length === 0, svc.join(' | '));

  // S21 mutation
  //   DB を書き換える動詞は read layer のどこにも現れてはいけない。
  const mut = grepRead(['.insert(', '.update(', '.upsert(', '.rpc(']);
  check('S21 read layer に insert / update / upsert / rpc が 0 本', mut.length === 0, mut.join(' | '));

  //   `.delete(` は WeakMap / Map / Set にも存在するため、**受け手**を見て判定する。
  //   同じ file 内で `new WeakMap` / `new Map` / `new Set` として宣言された識別子に対する
  //   delete だけを許し、それ以外（= Supabase builder に対する delete）は落とす。
  const deleteHits: string[] = [];
  for (const file of listFiles(READ_DIR)) {
    const text = readFileSync(file, 'utf8');
    const collections = new Set(
      [...text.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)[^\n=]*=\s*new\s+(?:WeakMap|Map|Set|WeakSet)\b/g)]
        .map((m) => m[1]),
    );
    for (const line of codeLines(file)) {
      for (const m of line.matchAll(/([A-Za-z0-9_$.]+)\.delete\(/g)) {
        const receiver = m[1].split('.').pop() ?? m[1];
        if (!collections.has(m[1]) && !collections.has(receiver)) {
          deleteHits.push(`${relative(REPO_ROOT, file)}: ${line.trim().slice(0, 100)}`);
        }
      }
    }
  }
  check('S21 delete は in-memory collection に対するものだけ', deleteHits.length === 0, deleteHits.join(' | '));

  //   Supabase client に触れる file は executor 1 本だけで、使う動詞も read 系に限る。
  const clientFiles = listFiles(READ_DIR).filter((f) =>
    codeLines(f).some((l) => l.includes('.from(')));
  check('S21 Supabase client を触る file は 1 本のみ', clientFiles.length === 1,
    clientFiles.map((f) => relative(REPO_ROOT, f)).join(', '));
  if (clientFiles.length === 1) {
    const ALLOWED_VERBS = new Set(['from', 'select', 'eq', 'in', 'order', 'limit', 'maybeSingle']);
    const used = new Set<string>();
    for (const line of codeLines(clientFiles[0])) {
      for (const m of line.matchAll(/\b(?:client|builder)\.([A-Za-z0-9_$]+)\(/g)) used.add(m[1]);
    }
    const disallowed = [...used].filter((v) => !ALLOWED_VERBS.has(v));
    check('S21 executor が使う PostgREST 動詞は read 系のみ', disallowed.length === 0,
      `used=${[...used].join(', ')} disallowed=${disallowed.join(', ')}`);
  }

  // S22 mirror table
  const mirror = grepRead(['_mirrors', 'mirror_events']);
  check('S22 *_mirrors を参照しない', mirror.length === 0, mirror.join(' | '));

  // S25 Date / random
  const nondet = grepRead(['new Date(', 'Date.now(', 'Math.random(', 'crypto.randomUUID(']);
  check('S25 read layer に Date / random が無い', nondet.length === 0, nondet.join(' | '));

  // S26 production runtime import = 0
  const offenders: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const file of listFiles(join(REPO_ROOT, dir))) {
      const rel = relative(REPO_ROOT, file);
      if (rel.startsWith(join('lib', 'examSpine'))) continue;
      const src = readFileSync(file, 'utf8');
      if (/^\s*import[^\n]*examSpine/m.test(src) || /require\(['"][^'"]*examSpine/.test(src)) {
        offenders.push(rel);
      }
    }
  }
  check('S26 production runtime からの examSpine import = 0', offenders.length === 0, offenders.join(', '));

  // read layer の import 境界（Stage 1 QA は read/** を Stage 3 に委譲している）
  const badImports: string[] = [];
  for (const file of listFiles(READ_DIR)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)) {
      const spec = m[1];
      const typeOnly = /^\s*import\s+type\s/.test(m[0]);
      const local = spec.startsWith('.') || spec.startsWith('@/lib/examSpine');
      if (local || typeOnly) continue;
      badImports.push(`${relative(REPO_ROOT, file)}: ${spec}`);
    }
  }
  check('S26 read layer の runtime import は Spine 内部のみ（外部は type-only）',
    badImports.length === 0, badImports.join(' | '));
}

/** S23 / S24: query builder を全部起こして table / 列を構造的に検査する。 */
function queryShapeBoundaries(): void {
  const ids = ['id-1', 'id-2'];
  const queries: ExamReadQuery[] = [
    Q.basicInfoQuery(USER_A), Q.activityQuery(USER_A), Q.diagnosisQuery(USER_A),
    Q.selfAnalysisQuery(USER_A), Q.statementReviewQuery(USER_A), Q.selfPrQuery(USER_A),
    Q.essayQuery(USER_A), Q.interviewRecordQuery(USER_A), Q.interviewAiQuery(USER_A),
    Q.presentationCoreQuery(USER_A), Q.presentationAttemptsQuery(USER_A, ids),
    Q.presentationSessionsQuery(USER_A, ids),
  ];

  // registry 外 table を読んでいない
  const registered = new Set(EXAM_SOURCE_KINDS.flatMap((k) => [...EXAM_SOURCE_TABLES[k]]));
  const outside = queries.filter((q) => !registered.has(q.table)).map((q) => q.table);
  check('S23 registry 外 table を SELECT しない', outside.length === 0, outside.join(', '));

  // 各 query の table が「その kind の registry」に属する
  const wrongKind = queries.filter((q) => !EXAM_SOURCE_TABLES[q.kind].includes(q.table));
  check('S23 query の table が kind の registry と一致',
    wrongKind.length === 0, wrongKind.map((q) => `${q.kind}:${q.table}`).join(', '));

  // dormant table を読まない
  const dormant = queries.filter((q) => q.table === 'presentation_practice_records');
  check('S23 presentation_practice_records を SELECT しない', dormant.length === 0);
  check('S23 dormant table が registry にも入っていない', !registered.has('presentation_practice_records'));

  // embed 先も registry 内
  const badEmbed = queries.filter((q) => q.embed && !registered.has(q.embed.table));
  check('S23 embed 先も registry 内', badEmbed.length === 0);

  // S24 センシティブ列を SELECT しない
  const FORBIDDEN_COLUMNS = [
    'transcript', 'storage_path', 'script', 'material_path', 'material_file_name',
    'questions_asked', 'my_answers', 'essay',
  ];
  const leaked: string[] = [];
  for (const q of queries) {
    const cols = [...q.columns, ...(q.embed?.columns ?? [])];
    for (const c of cols) {
      if (FORBIDDEN_COLUMNS.includes(c)) leaked.push(`${q.table}.${c}`);
    }
  }
  check('S24 逐語 / Storage path / 本文列を SELECT しない', leaked.length === 0, leaked.join(', '));

  // interview_ai_turns / presentation_qa_turns を読まない
  const turnTables = queries.filter((q) =>
    q.table.endsWith('_turns') || q.embed?.table.endsWith('_turns'));
  check('S24 *_turns（逐語 table）を SELECT しない', turnTables.length === 0);

  // select 文字列が列配列から決定的に組み立てられる
  const sel = formatSelect(Q.interviewAiQuery(USER_A));
  check('S24 embed 付き select が !inner を含む', sel.includes('interview_ai_sessions!inner'), sel);
}

// ── 12. S27 観測ログ ──────────────────────────────────────────────

async function s27PiiFreeLogs(): Promise<void> {
  const rec = createRecordingExecutor(fullDb());
  let t = 0;
  const r = await readExamSources({
    userId: USER_A, kinds: ALL, executor: rec.executor, clock: () => (t += 5),
  });

  const ALLOWED_KEYS = new Set([
    'kind', 'status', 'queryCount', 'rowCount', 'truncated', 'enrichmentFailed', 'durationMs',
  ]);
  const STATUSES = new Set(['ok', 'truncated', 'error', 'skipped']);
  const KINDS = new Set<string>(EXAM_SOURCE_KINDS);

  const badKeys: string[] = [];
  const badValues: string[] = [];
  for (const entry of r.log) {
    for (const [k, v] of Object.entries(entry)) {
      if (!ALLOWED_KEYS.has(k)) badKeys.push(k);
      if (k === 'kind' && !KINDS.has(String(v))) badValues.push(`kind=${String(v)}`);
      else if (k === 'status' && !STATUSES.has(String(v))) badValues.push(`status=${String(v)}`);
      else if (k !== 'kind' && k !== 'status' && typeof v !== 'number' && typeof v !== 'boolean') {
        badValues.push(`${k}=${typeof v}`);
      }
    }
  }
  check('S27 log の key が閉じた集合のみ', badKeys.length === 0, [...new Set(badKeys)].join(', '));
  check('S27 log の値は closed enum / number / boolean のみ', badValues.length === 0, badValues.join(', '));

  const serialized = JSON.stringify(r.log);
  check('S27 log に userId が出ない', !serialized.includes(USER_A));
  check('S27 log に大学名 / 本文が出ない',
    !serialized.includes('サンプル大学') && !serialized.includes('本文'));
  check('S27 log に UUID 風 id が出ない', !/[0-9a-f]{8}-[0-9a-f]{4}/.test(serialized));
  check('S27 clock 注入時のみ durationMs が入る', r.log.every((l) => typeof l.durationMs === 'number'));

  const noClock = await readExamSources({ userId: USER_A, kinds: ['basic_info'], executor: rec.executor });
  check('S27 clock 未注入なら durationMs を持たない', noClock.log[0].durationMs === undefined);
}

// ── 13. 追加: bundle / status の不変条件 ──────────────────────────

async function invariants(): Promise<void> {
  const cases: { label: string; db: FakeDb }[] = [
    { label: 'full', db: fullDb() },
    { label: 'empty', db: emptyDb() },
  ];
  const errDb = fullDb();
  errDb.errors = { self_prs: { code: 'X', message: 'y' } };
  cases.push({ label: 'error', db: errDb });

  for (const c of cases) {
    const r = await readExamSources({
      userId: USER_A, kinds: ALL, executor: createRecordingExecutor(c.db).executor,
    });
    for (const kind of ALL) {
      const slot = r.bundle[slotOf(kind)];
      const status = r.statuses[kind];
      const isNull = slot === null;
      const failed = status === 'error' || status === 'skipped';
      check(`INV ${c.label}/${kind} null ⇔ error|skipped`, isNull === failed,
        `slot=${isNull ? 'null' : 'value'} status=${status}`);
    }
  }
}

// ── 14. run ───────────────────────────────────────────────────────

function slotOf(kind: ExamSourceKind): keyof import('@/lib/examSpine/sourceData/types').ExamSourceBundle {
  const map = {
    basic_info: 'basicInfo', activity: 'activity', diagnosis: 'diagnosis',
    self_analysis: 'selfAnalysisLogs', statement_review: 'statementReviews', self_pr: 'selfPrs',
    essay: 'essayWorkspaces', interview_record: 'interviewRecords', interview_ai: 'interviewAi',
    presentation: 'presentation',
  } as const;
  return map[kind];
}

function valueState(slot: unknown): string {
  if (slot === null) return 'null';
  const rec = slot as { state?: string };
  return rec?.state ?? 'unknown';
}

function presentRow(slot: unknown): unknown {
  const rec = slot as { state?: string; row?: unknown };
  return rec?.state === 'present' ? rec.row : null;
}

function aiSdkLoaded(): boolean {
  const cache =
    (globalThis as { require?: { cache?: Record<string, unknown> } }).require?.cache ??
    (typeof require !== 'undefined' ? require.cache : undefined);
  if (!cache) return false;
  return Object.keys(cache).some(
    (p) => p.includes('@anthropic-ai') || p.includes('/openai/') || p.includes('@google/genai'),
  );
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage3] Stage 3 canonical reader contract check');
  console.log(`[exam-spine-stage3] kinds=${EXAM_SOURCE_KINDS.length} caps=${JSON.stringify(EXAM_READ_CAPS)}`);

  await s1AllSuccess();
  await s2EmptyUser();
  await s3Partial();
  await s4PostgrestError();
  await s5ThrownError();
  await s6AdversarialJsonb();
  await s7CapExactly();
  await s8CapPlusOne();
  await s9Ordering();
  await s10TimestampTie();
  await s10bRecencyColumns();
  await s11ResultsDriven();
  await s12EmbeddedShapes();
  await s13EnrichmentFailure();
  await s14CoreAbsentNoEnrichment();
  await s15NoName();
  await s16Subset();
  await s17OverlappingConsumers();
  await s18DifferentRequestNoReuse();
  await s19AuthorizeOnCacheHit();
  staticBoundaries();
  queryShapeBoundaries();
  await s27PiiFreeLogs();
  await invariants();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage3] FAIL: 外部通信が ${fetchCallCount} 回発生しました`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[exam-spine-stage3] network calls = ${fetchCallCount}（実 Supabase / AI 呼び出しゼロ）`);
  console.log(`[exam-spine-stage3] AI SDK loaded  = ${aiSdkLoaded() ? 'YES' : 'NO'}`);
  if (aiSdkLoaded()) {
    console.error('[exam-spine-stage3] FAIL: AI SDK が module graph に載っています');
    process.exitCode = 1;
    return;
  }

  console.log(`[exam-spine-stage3] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`\n[exam-spine-stage3] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 25)) console.error(`  - ${f}`);
    if (failures.length > 25) console.error(`  … 他 ${failures.length - 25} 件`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-stage3] PASS');
}

void main();
