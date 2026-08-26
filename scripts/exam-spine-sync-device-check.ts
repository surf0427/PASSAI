// Exam Spine — Stage 4 Wave 3 / device ↔ mirror round-trip parity check。
//
// 本 script の主眼は 1 つだけ:
//
//   同じ論理内容を持つ device domain object と、それを writer が書き DB を往復して
//   reader が読んだ mirror row とが、**最終 fingerprint で完全に一致すること**。
//
//   domain fixture
//     ├─ device path : deviceViews.ts → rowMappers → views → fingerprint A
//     └─ mirror path : writer row（本 script が実 writer を写した独立実装）
//                       → DB 往復 simulation（JSON / jsonb key 順 / timestamptz /
//                          trigger updated_at / uuid PK / DEFAULT now()）
//                       → query projection（queries.ts の columns をそのまま使用）
//                       → rowMappers → views → fingerprint B
//   assert A === B
//
// ここが崩れると Source-Sync は **永久 mismatch** を出し続け、機能が黙って無効化される。
// したがって mirror path は device 実装を再利用せず、`lib/supabase/*.ts` の row builder を
// 本 script 側で独立に写して作る（同じ関数を 2 回呼んで「一致した」にしない）。
//
// 厳守: 実ネットワーク 0 / 実 DB 0 / AI 0 / clock 0 / random 0 / production 変更 0
//
// 使い方: npm run qa:examSpine:syncDevice

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let fetchCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCallCount += 1;
  const target = typeof args[0] === 'string' ? args[0] : '(non-string input)';
  throw new Error(`[exam-spine-sync-device] 外部通信が発生しました: ${target}`);
}) as typeof globalThis.fetch;
void originalFetch;

import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { DiagnosisResult } from '@/lib/diagnosisStorage';
import type { SelfAnalysisLog } from '@/types/selfAnalysisLog';
import type { ReviewHistoryItem } from '@/lib/statement/review/statementStorage';
import type { SelfPR } from '@/types/selfPR';
import type { StoredInterviewRecord } from '@/lib/interviewRecordStorage';
import type { EssayWorkspace, ReviewEntry } from '@/types/essay';

import { EXAM_READ_FIELD_LIMITS } from '@/lib/examSpine/read/readSources';
import * as Q from '@/lib/examSpine/read/queries';
import {
  mapActivityRow,
  mapBasicInfoRow,
  mapDiagnosisRow,
  mapEssayRow,
  mapInterviewRecordRow,
  mapSelfAnalysisRow,
  mapSelfPrRow,
  mapStatementReviewRow,
} from '@/lib/examSpine/read/rowMappers';
import {
  activitySyncView,
  basicInfoSyncView,
  diagnosisSyncView,
  essaySyncView,
  examSyncObservation,
  interviewRecordItemView,
  listSyncView,
  selfAnalysisItemView,
  selfPrItemView,
  statementReviewItemView,
} from '@/lib/examSpine/sync/adapters/views';
import {
  EXAM_SYNC_ADAPTER_CONTRACTS,
  EXAM_SYNC_RUNTIME_ENABLE_BLOCKED,
  EXAM_SYNC_SUPPORTED_KINDS,
} from '@/lib/examSpine/sync/adapters/registry';
import type { ExamSyncSupportedKind } from '@/lib/examSpine/sync/adapters/registry';
import {
  EXAM_DEVICE_SCHEMA_VERSIONS,
  deviceActivityView,
  deviceBasicInfoRow,
  deviceEssayRow,
  deviceInterviewRecordRow,
  deviceStatementReviewRow,
  deviceBasicInfoView,
  deviceDiagnosisView,
  deviceEssayView,
  deviceInterviewRecordItemView,
  deviceInterviewRecordView,
  deviceSelfAnalysisView,
  deviceSelfPrView,
  deviceStatementReviewView,
} from '@/lib/examSpine/sync/adapters/deviceViews';
import type { ExamDeviceViewResult } from '@/lib/examSpine/sync/adapters/deviceViews';
import {
  buildDeviceClaim,
  deviceClaimToCandidate,
  readDeviceCandidate,
} from '@/lib/examSpine/sync/adapters/deviceSources';
import type { ExamDeviceSourceReaders } from '@/lib/examSpine/sync/adapters/deviceSources';
import { serverMirrorCandidate } from '@/lib/examSpine/sync/adapters/types';
import { verifyExamSourcePair } from '@/lib/examSpine/sync/verification';

// ── assertion helper ──────────────────────────────────────────────
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

const REPO_ROOT = process.cwd();
const ADAPTERS_DIR = join(REPO_ROOT, 'lib', 'examSpine', 'sync', 'adapters');
const L = EXAM_READ_FIELD_LIMITS;

// ── 非決定性 trap ─────────────────────────────────────────────────
function withNondeterminismTrap(run: () => void): { dateCalls: number; randomCalls: number } {
  const realDate = globalThis.Date;
  const realRandom = Math.random;
  let dateCalls = 0;
  let randomCalls = 0;
  const trapped = new Proxy(realDate, {
    construct(target, args, newTarget) {
      dateCalls += 1;
      return Reflect.construct(target as never, args, newTarget as never) as object;
    },
    apply(target, thisArg, args) {
      dateCalls += 1;
      return Reflect.apply(target as never, thisArg, args) as unknown;
    },
    get(target, prop, receiver) {
      if (prop === 'now' || prop === 'parse' || prop === 'UTC') {
        const fn = Reflect.get(target, prop, receiver) as (...a: unknown[]) => unknown;
        return (...a: unknown[]) => {
          dateCalls += 1;
          return fn.apply(target, a);
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
  (globalThis as { Date: unknown }).Date = trapped;
  Math.random = () => {
    randomCalls += 1;
    return realRandom();
  };
  try {
    run();
  } finally {
    (globalThis as { Date: unknown }).Date = realDate;
    Math.random = realRandom;
  }
  return { dateCalls, randomCalls };
}

// ══════════════════════════════════════════════════════════════════
// 1. writer の row builder を **独立に写す**
//    （device 実装を再利用しない。同じ関数を 2 回呼んで一致させない）
// ══════════════════════════════════════════════════════════════════

/** lib/supabase/basicInfoLogs.ts:48 stripName + :80 upsert payload */
function writerBasicInfoRow(info: BasicInfo): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...(info as unknown as Record<string, unknown>) };
  delete payload.name;
  return { payload, schema_version: '1', source_hash: 'sha256-from-client' };
}

/** lib/supabase/activityLogs.ts:67 */
function writerActivityRow(data: ActivityData): Record<string, unknown> {
  return {
    payload: data as unknown as Record<string, unknown>,
    schema_version: '1',
    source_hash: 'sha256-from-client',
  };
}

/** lib/supabase/diagnosisLogs.ts:72（SCHEMA_VERSION = "3"） */
function writerDiagnosisRow(result: DiagnosisResult): Record<string, unknown> {
  return {
    payload: result as unknown as Record<string, unknown>,
    schema_version: '3',
    source_hash: 'sha256-from-client',
  };
}

/** lib/supabase/selfAnalysisLogs.ts:105 upsert */
function writerSelfAnalysisRow(log: SelfAnalysisLog): Record<string, unknown> {
  return {
    local_log_id: log.id,
    summary_input_hash: log.summaryInputHash,
    analysis: log.analysis,
    displayed_questions: log.displayedQuestions,
    answers: log.answers,
    deep_answers: log.deepAnswers,
    free_memo: log.freeMemo,
    summary: log.summary,
    created_at: log.createdAt,
    metadata: {},
  };
}

/** lib/supabase/statementReviewHistory.ts:70 itemToRow（created_at は条件付き） */
function writerStatementReviewRow(item: ReviewHistoryItem): Record<string, unknown> {
  const row: Record<string, unknown> = {
    local_review_id: item.id,
    university: item.university,
    faculty: item.faculty,
    department: item.department,
    essay: item.essay,
    result: item.result,
  };
  if (item.createdAt) row.created_at = item.createdAt;
  return row;
}

/** lib/supabase/selfPRs.ts:67 prToRow（created_at は条件付き / updated_at は送るが trigger 上書き） */
function writerSelfPrRow(pr: SelfPR): Record<string, unknown> {
  const row: Record<string, unknown> = {
    local_pr_id: pr.id,
    pr_index: pr.index,
    title: pr.title ?? '',
    body: pr.text,
    latest_result: pr.latestResult,
    seed_input_hash: pr.seedInputHash ?? null,
    updated_at: pr.updatedAt,
  };
  if (pr.createdAt) row.created_at = pr.createdAt;
  return row;
}

/** lib/supabase/interviewPracticeRecords.ts:94 recordToRow（feedback_json は JSON.parse） */
function writerInterviewRecordRow(record: StoredInterviewRecord): Record<string, unknown> {
  let feedback: unknown = null;
  if (record.feedbackJson) {
    try {
      feedback = JSON.parse(record.feedbackJson) as unknown;
    } catch {
      feedback = null; // writer は devWarn して null を書く
    }
  }
  const row: Record<string, unknown> = {
    local_record_id: record.id,
    practice_date: record.practiceDate ?? '',
    university_name: record.universityName ?? '',
    faculty_name: record.facultyName ?? '',
    exam_type: record.examType ?? '',
    partner: record.partner ?? '',
    main_question: record.mainQuestion ?? '',
    improvement_summary: record.improvementSummary ?? '',
    questions_asked: record.questionsAsked ?? '',
    my_answers: record.myAnswers ?? '',
    what_went_wrong: record.whatWentWrong ?? '',
    feedback_received: record.feedbackReceived ?? '',
    self_noted: record.selfNoted ?? '',
    feedback_json: feedback,
    updated_at: record.updatedAt,
  };
  if (record.createdAt) row.created_at = record.createdAt;
  return row;
}

/** lib/supabase/essayWorkspaces.ts:88 upsert（workspace 全体を jsonb で書く） */
function writerEssayRow(workspace: EssayWorkspace): Record<string, unknown> {
  return {
    local_workspace_id: workspace.id,
    workspace,
    created_at: workspace.createdAt,
  };
}

// ══════════════════════════════════════════════════════════════════
// 2. DB 往復 simulation
// ══════════════════════════════════════════════════════════════════

/** trigger / DEFAULT が入れる値（device には存在しない）。 */
const DB_UUID = '11111111-2222-4333-8444-555555555555';
const TRIGGER_NOW = '2030-01-01T00:00:00.000000+00:00';
const DEFAULT_NOW = '2029-12-31T23:59:59.000000+00:00';

/** client の `…Z` を PostgREST の `…+00:00`（microsecond 6 桁）へ。純粋な文字列変換。 */
function asPostgrestTimestamptz(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!m) return value;
  const frac = (m[2] ?? '').padEnd(6, '0').slice(0, 6);
  return `${m[1]}.${frac}+00:00`;
}

/** jsonb は key 順を保持しない。順序に依存していないことを示すため再帰的に反転する。 */
function shuffleKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shuffleKeys);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).reverse()) {
      out[key] = shuffleKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** wire（JSON）を通す。undefined property の脱落 / NaN・Infinity → null を再現する。 */
function throughWire(row: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

/**
 * writer row → DB に入った後の row。
 *   - id は uuid PK（DB 生成）
 *   - updated_at は BEFORE UPDATE trigger が now() で上書き（schema.sql:47）
 *   - created_at は writer が送っていなければ DEFAULT now()
 *   - 送られた timestamptz は PostgREST 表記へ
 */
function applyDbSideEffects(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  out.id = DB_UUID;
  out.updated_at = TRIGGER_NOW;
  out.created_at =
    typeof row.created_at === 'string' && row.created_at !== ''
      ? asPostgrestTimestamptz(row.created_at)
      : DEFAULT_NOW;
  return out;
}

/** queries.ts の columns をそのまま使って PostgREST の返却 shape を作る。 */
function projectColumns(
  row: Record<string, unknown>,
  columns: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    const aliasSplit = col.indexOf(':');
    if (aliasSplit < 0) {
      out[col] = col in row ? row[col] : null;
      continue;
    }
    const alias = col.slice(0, aliasSplit);
    const path = col.slice(aliasSplit + 1);
    const [base, ...rest] = path.split('->');
    let cursor: unknown = base in row ? row[base] : null;
    for (const seg of rest) {
      const key = seg.replace(/^>/, '');
      cursor =
        cursor && typeof cursor === 'object'
          ? (cursor as Record<string, unknown>)[key] ?? null
          : null;
    }
    out[alias] = cursor;
  }
  return out;
}

const U = '00000000-0000-4000-8000-000000000000';

/** 1 kind の mirror row（writer → DB → PostgREST）を作る。 */
function mirrorRow(
  writerRow: Record<string, unknown>,
  columns: readonly string[],
): Record<string, unknown> {
  return projectColumns(shuffleKeys(applyDbSideEffects(throughWire(writerRow))) as Record<string, unknown>, columns);
}

// ══════════════════════════════════════════════════════════════════
// 3. fixtures
// ══════════════════════════════════════════════════════════════════

function text(n: number, seed = 'あ'): string {
  return seed.repeat(n);
}

function basicInfoFixture(over: Partial<BasicInfo> = {}): BasicInfo {
  return {
    name: '山田太郎',
    grade: '3',
    track: '文系',
    preferences: [
      { university: 'A大学', faculty: '法学部', department: '法律学科' },
      { university: 'B大学', faculty: '経済学部' },
    ],
    overallGpa: '4.2',
    examTypes: ['総合型', '学校推薦型'],
    subjectGrades: { english: '5', japanese: '4' },
    ...over,
  };
}

function activityFixture(over: Record<string, unknown> = {}): ActivityData {
  return {
    club: [{ title: '吹奏楽', detail: 'パートリーダー' }],
    volunteer: [],
    nested: { a: 1, b: { c: [1, 2, 3] } },
    ...over,
  } as unknown as ActivityData;
}

function diagnosisFixture(over: Record<string, unknown> = {}): DiagnosisResult {
  return { type: 'X', scores: [1, 2, 3], detail: { note: '' }, ...over } as unknown as DiagnosisResult;
}

function selfAnalysisFixture(over: Partial<SelfAnalysisLog> = {}): SelfAnalysisLog {
  return {
    id: 'log-1',
    createdAt: '2026-08-26T09:12:33.123Z',
    updatedAt: '2026-08-26T09:12:33.123Z',
    summaryInputHash: 'hash-1',
    analysis: { walls: ['w1'], meta: { depth: 2 } },
    displayedQuestions: ['Q1', 'Q2'],
    answers: ['A1', 'A2'],
    deepAnswers: ['D1'],
    freeMemo: 'メモ',
    summary: { text: 'まとめ' },
    ...over,
  } as unknown as SelfAnalysisLog;
}

function statementReviewFixture(over: Partial<ReviewHistoryItem> = {}): ReviewHistoryItem {
  return {
    id: 'rev-1',
    createdAt: '2026-08-20T10:00:00.000Z',
    university: 'A大学',
    faculty: '法学部',
    department: '法律学科',
    essay: '志望理由書の本文（server projection には載らない）',
    result: { score: 80, notes: ['n1'] },
    ...over,
  } as unknown as ReviewHistoryItem;
}

function selfPrFixture(over: Partial<SelfPR> = {}): SelfPR {
  return {
    id: 'pr-1',
    index: 0,
    title: '自己PR',
    text: '本文です',
    latestResult: '講評です',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-26T09:12:33.000Z',
    seedInputHash: 'seed-1',
    ...over,
  };
}

function interviewRecordFixture(over: Partial<StoredInterviewRecord> = {}): StoredInterviewRecord {
  return {
    id: 'ir-1',
    practiceDate: '2026-08-20',
    universityName: 'A大学',
    facultyName: '法学部',
    examType: '総合型',
    partner: '先生',
    mainQuestion: '志望理由を教えてください',
    improvementSummary: '結論を先に',
    questionsAsked: '逐語（読まない）',
    myAnswers: '逐語（読まない）',
    whatWentWrong: '緊張した',
    feedbackReceived: '良い',
    selfNoted: '練習する',
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    feedbackJson: JSON.stringify({ strengths: ['s1'], levels: { logical: 'strong' } }),
    ...over,
  };
}

function reviewEntryFixture(over: Partial<ReviewEntry> = {}): ReviewEntry {
  return {
    totalScore: 82,
    verdict: 'B',
    breakdown: [{ label: '構成', score: 4 }],
    improvement: '結論を先に書く',
    goodPoints: ['構成が明確'],
    weakPoints: ['具体例が薄い'],
    createdAt: '2026-08-20T10:00:00.000Z',
    essayBodySnapshot: '小論文の本文（E-S27 で除外）',
    source: 'ai',
    parseError: false,
    ...over,
  } as unknown as ReviewEntry;
}

function essayFixture(over: Partial<EssayWorkspace> = {}): EssayWorkspace {
  return {
    id: 'ws-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-26T09:12:33.000Z',
    target: { university: 'A大学', faculty: '法学部', department: '法律学科', examType: '総合型' },
    theme: { text: 'テーマ', type: 't', source: 'admission_policy', reason: 'r' },
    mini: { conclusion: 'c', reasonOne: 'r1', reasonTwo: 'r2' },
    body: '小論文の本文（server projection には載らない）',
    reviews: [reviewEntryFixture(), reviewEntryFixture({ totalScore: 70, verdict: 'C' })],
    ...over,
  } as unknown as EssayWorkspace;
}

// ══════════════════════════════════════════════════════════════════
// 4. 2 経路の fingerprint
// ══════════════════════════════════════════════════════════════════

function fp(kind: ExamSyncSupportedKind, view: unknown): string {
  return examSyncObservation({ kind, source: 'server_mirror', view }).fingerprint;
}

function deviceFp(kind: ExamSyncSupportedKind, result: ExamDeviceViewResult): string | null {
  return result.ok ? fp(kind, result.view) : null;
}

/** kind ごとの mirror path（writer → DB → projection → mapper → view → fingerprint）。 */
const MIRROR_PATH: {
  basic_info: (v: BasicInfo) => string;
  activity: (v: ActivityData) => string;
  diagnosis: (v: DiagnosisResult) => string;
  self_analysis: (v: readonly SelfAnalysisLog[]) => string;
  statement_review: (v: readonly ReviewHistoryItem[]) => string;
  self_pr: (v: readonly SelfPR[]) => string;
  interview_record: (v: readonly StoredInterviewRecord[]) => string;
  essay: (v: readonly EssayWorkspace[]) => string;
} = {
  basic_info: (v) => {
    const row = mirrorRow(writerBasicInfoRow(v), Q.basicInfoQuery(U).columns);
    const mapped = mapBasicInfoRow(row, L);
    return fp('basic_info', basicInfoSyncView(mapped!));
  },
  activity: (v) => {
    const row = mirrorRow(writerActivityRow(v), Q.activityQuery(U).columns);
    return fp('activity', activitySyncView(mapActivityRow(row)!));
  },
  diagnosis: (v) => {
    const row = mirrorRow(writerDiagnosisRow(v), Q.diagnosisQuery(U).columns);
    return fp('diagnosis', diagnosisSyncView(mapDiagnosisRow(row)!));
  },
  self_analysis: (v) => {
    const cols = Q.selfAnalysisQuery(U).columns;
    const views = v.map((log) => selfAnalysisItemView(mapSelfAnalysisRow(mirrorRow(writerSelfAnalysisRow(log), cols), L)!));
    return fp('self_analysis', listSyncView(views, (x) => x));
  },
  statement_review: (v) => {
    const cols = Q.statementReviewQuery(U).columns;
    const views = v.map((item) => statementReviewItemView(mapStatementReviewRow(mirrorRow(writerStatementReviewRow(item), cols), L)!));
    return fp('statement_review', listSyncView(views, (x) => x));
  },
  self_pr: (v) => {
    const cols = Q.selfPrQuery(U).columns;
    const views = v.map((pr) => selfPrItemView(mapSelfPrRow(mirrorRow(writerSelfPrRow(pr), cols), L)!));
    return fp('self_pr', listSyncView(views, (x) => x));
  },
  interview_record: (v) => {
    const cols = Q.interviewRecordQuery(U).columns;
    const views = v.map((r) => interviewRecordItemView(mapInterviewRecordRow(mirrorRow(writerInterviewRecordRow(r), cols), L)!));
    return fp('interview_record', listSyncView(views, (x) => x));
  },
  essay: (v) => {
    const cols = Q.essayQuery(U).columns;
    const views = v.map((ws) => essaySyncView(mapEssayRow(mirrorRow(writerEssayRow(ws), cols), L)!));
    return fp('essay', listSyncView(views, (x) => x));
  },
};

const DEVICE_PATH = {
  basic_info: (v: BasicInfo) => deviceFp('basic_info', deviceBasicInfoView(v)),
  activity: (v: ActivityData) => deviceFp('activity', deviceActivityView(v)),
  diagnosis: (v: DiagnosisResult) => deviceFp('diagnosis', deviceDiagnosisView(v)),
  self_analysis: (v: readonly SelfAnalysisLog[]) => deviceFp('self_analysis', deviceSelfAnalysisView(v)),
  statement_review: (v: readonly ReviewHistoryItem[]) => deviceFp('statement_review', deviceStatementReviewView(v)),
  self_pr: (v: readonly SelfPR[]) => deviceFp('self_pr', deviceSelfPrView(v)),
  interview_record: (v: readonly StoredInterviewRecord[]) => deviceFp('interview_record', deviceInterviewRecordView(v)),
  essay: (v: readonly EssayWorkspace[]) => deviceFp('essay', deviceEssayView(v)),
};

/** 1 fixture について device / mirror の 2 経路を比較する。 */
function parity(label: string, kind: ExamSyncSupportedKind, domain: unknown): boolean {
  const d = (DEVICE_PATH[kind] as (v: unknown) => string | null)(domain);
  const m = (MIRROR_PATH[kind] as (v: unknown) => string)(domain);
  const ok = d !== null && d === m;
  check(`parity ${kind}: ${label}`, ok, `device=${d ?? 'UNCLAIMABLE'}\n      mirror=${m}`);
  return ok;
}

// ══════════════════════════════════════════════════════════════════
// 5. checks
// ══════════════════════════════════════════════════════════════════

function baselineParity(): void {
  parity('baseline', 'basic_info', basicInfoFixture());
  parity('baseline', 'activity', activityFixture());
  parity('baseline', 'diagnosis', diagnosisFixture());
  parity('baseline', 'self_analysis', [selfAnalysisFixture(), selfAnalysisFixture({ id: 'log-2', freeMemo: 'x' })]);
  parity('baseline', 'statement_review', [statementReviewFixture(), statementReviewFixture({ id: 'rev-2' })]);
  parity('baseline', 'self_pr', [selfPrFixture(), selfPrFixture({ id: 'pr-2', index: 1 })]);
  parity('baseline', 'interview_record', [interviewRecordFixture(), interviewRecordFixture({ id: 'ir-2' })]);
  parity('baseline', 'essay', [essayFixture(), essayFixture({ id: 'ws-2' })]);

  // 空 collection
  parity('empty list', 'self_analysis', []);
  parity('empty list', 'statement_review', []);
  parity('empty list', 'self_pr', []);
  parity('empty list', 'interview_record', []);
  parity('empty list', 'essay', []);
}

function fieldSetFreeze(): void {
  const views: Array<[ExamSyncSupportedKind, ExamDeviceViewResult]> = [
    ['basic_info', deviceBasicInfoView(basicInfoFixture())],
    ['activity', deviceActivityView(activityFixture())],
    ['diagnosis', deviceDiagnosisView(diagnosisFixture())],
  ];
  for (const [kind, r] of views) {
    check(`field-set ${kind}: device view が生成できる`, r.ok);
    if (!r.ok) continue;
    eq(`field-set ${kind}: device view key == registry.contentFields`,
      Object.keys(r.view as Record<string, unknown>).sort(),
      [...EXAM_SYNC_ADAPTER_CONTRACTS[kind].contentFields].sort());
  }

  // history kind は item の key 集合を見る
  const items: Array<[ExamSyncSupportedKind, ExamDeviceViewResult]> = [
    ['self_analysis', deviceSelfAnalysisView([selfAnalysisFixture()])],
    ['statement_review', deviceStatementReviewView([statementReviewFixture()])],
    ['self_pr', deviceSelfPrView([selfPrFixture()])],
    ['interview_record', deviceInterviewRecordView([interviewRecordFixture()])],
    ['essay', deviceEssayView([essayFixture()])],
  ];
  for (const [kind, r] of items) {
    check(`field-set ${kind}: device list view が生成できる`, r.ok);
    if (!r.ok) continue;
    const arr = r.view as Record<string, unknown>[];
    eq(`field-set ${kind}: item key == registry.contentFields`,
      Object.keys(arr[0]).sort(),
      [...EXAM_SYNC_ADAPTER_CONTRACTS[kind].contentFields].sort());
  }

  // 8 kind すべてに device builder があること / class 2 に無いこと
  eq('device builder が supported 8 kind をちょうど覆う',
    Object.keys(DEVICE_PATH).sort(), [...EXAM_SYNC_SUPPORTED_KINDS].sort());
  check('class 2 に device builder が存在しない',
    !('interview_ai' in DEVICE_PATH) && !('presentation' in DEVICE_PATH));
}

function schemaVersionPin(): void {
  // writer の module private 定数と device 側の宣言が一致すること（ずれると全ユーザー永久 mismatch）
  // ★ 3 kind とも regex pin で writer と突き合わせる（Stage 5.1 stabilization）★
  //   adapter が writer module を import すると layer inversion になり
  //   sync-adapters の import 不変条件を破るため、deviceViews は値を宣言する。
  //   そのぶん drift 検出はここが唯一の防壁なので、3 kind すべてを対象にする。
  //   basic_info の writer は `SCHEMA_VERSION` を export 定数から導出しているため、
  //   宣言側（`BASIC_INFO_SCHEMA_VERSION = "1"`）を読む。
  const deviceViewsSrc = readFileSync(
    join(REPO_ROOT, 'lib/examSpine/sync/adapters/deviceViews.ts'), 'utf8');
  check('schema_version pin basic_info: adapter が writer module を import していない',
    !deviceViewsSrc.includes("from '@/lib/supabase/"));

  const pins: Array<[keyof typeof EXAM_DEVICE_SCHEMA_VERSIONS, string, RegExp]> = [
    ['basic_info', 'lib/supabase/basicInfoLogs.ts', /BASIC_INFO_SCHEMA_VERSION = "([^"]+)"/],
    ['activity', 'lib/supabase/activityLogs.ts', /const SCHEMA_VERSION = "([^"]+)"/],
    ['diagnosis', 'lib/supabase/diagnosisLogs.ts', /const SCHEMA_VERSION = "([^"]+)"/],
  ];
  for (const [kind, file, re] of pins) {
    const src = readFileSync(join(REPO_ROOT, file), 'utf8');
    const m = re.exec(src);
    check(`schema_version pin ${kind}: writer から読める`, m !== null, file);
    if (!m) continue;
    eq(`schema_version pin ${kind}: device 宣言と writer が一致`,
      EXAM_DEVICE_SCHEMA_VERSIONS[kind], m[1]);
  }
}

function truncationParity(): void {
  // shortText = 200
  for (const n of [L.shortText - 1, L.shortText, L.shortText + 1]) {
    parity(`shortText ${n}`, 'basic_info', basicInfoFixture({ grade: text(n) }));
    parity(`shortText ${n}`, 'statement_review', [statementReviewFixture({ university: text(n) })]);
  }
  // longText = 4000
  for (const n of [L.longText - 1, L.longText, L.longText + 1]) {
    parity(`longText ${n}`, 'self_pr', [selfPrFixture({ text: text(n) })]);
    parity(`longText ${n}`, 'interview_record', [interviewRecordFixture({ selfNoted: text(n) })]);
    parity(`longText ${n}`, 'self_analysis', [selfAnalysisFixture({ freeMemo: text(n) })]);
  }
  // arrayItems = 20 / arrayItemLength = 400
  for (const n of [L.arrayItems - 1, L.arrayItems, L.arrayItems + 1]) {
    const answers = Array.from({ length: n }, (_, i) => `A${i}`);
    parity(`arrayItems ${n}`, 'self_analysis', [selfAnalysisFixture({ answers })]);
    const examTypes = Array.from({ length: n }, (_, i) => `T${i}`);
    parity(`arrayItems ${n}`, 'basic_info', basicInfoFixture({ examTypes }));
  }
  for (const n of [L.arrayItemLength - 1, L.arrayItemLength, L.arrayItemLength + 1]) {
    parity(`arrayItemLength ${n}`, 'basic_info', basicInfoFixture({ examTypes: [text(n)] }));
  }
  // recordItems = 10
  for (const n of [L.recordItems - 1, L.recordItems, L.recordItems + 1]) {
    const preferences = Array.from({ length: n }, (_, i) => ({
      university: `U${i}`,
      faculty: `F${i}`,
      department: `D${i}`,
    }));
    parity(`recordItems ${n}`, 'basic_info', basicInfoFixture({ preferences }));
    const reviews = Array.from({ length: n }, (_, i) => reviewEntryFixture({ totalScore: i }));
    parity(`recordItems(reviews) ${n}`, 'essay', [essayFixture({ reviews })]);
  }
  // ★ 打ち切られた内容が両側で同じであること（片側だけ full text だと必ず落ちる）
  const long = text(L.longText + 500);
  const a = DEVICE_PATH.self_pr([selfPrFixture({ text: long })]);
  const b = DEVICE_PATH.self_pr([selfPrFixture({ text: long.slice(0, L.longText) })]);
  check('truncation: 打ち切り後が同一なら device fingerprint も同一', a !== null && a === b);
}

function nullabilityParity(): void {
  // optional property の不在 / undefined / null / '' / [] / {}
  parity('optional 不在（subjectGrades / overallGpa）', 'basic_info',
    basicInfoFixture({ subjectGrades: undefined, overallGpa: undefined }));
  parity('optional 空文字', 'basic_info', basicInfoFixture({ overallGpa: '' }));
  parity('空配列', 'basic_info', basicInfoFixture({ examTypes: [], preferences: [] }));
  parity('空 object', 'activity', activityFixture({ nested: {} }));
  parity('null 値', 'activity', activityFixture({ nested: { a: null } }));
  parity('undefined 値（JSON で脱落）', 'activity', activityFixture({ nested: { a: undefined, b: 1 } }));
  parity('NaN / Infinity', 'activity', activityFixture({ nested: { a: Number.NaN, b: Number.POSITIVE_INFINITY } }));
  parity('配列内 undefined', 'activity', activityFixture({ nested: { a: [1, undefined, 3] } }));
  parity('深い入れ子', 'diagnosis', diagnosisFixture({ detail: { a: { b: { c: { d: [1, { e: null }] } } } } }));
  parity('optional createdAt 不在（self_pr）', 'self_pr', [selfPrFixture({ createdAt: undefined })]);
  parity('optional title 不在（self_pr）', 'self_pr', [selfPrFixture({ title: undefined })]);
  parity('optional seedInputHash 不在', 'self_pr', [selfPrFixture({ seedInputHash: undefined })]);
  parity('optional feedbackJson 不在', 'interview_record', [interviewRecordFixture({ feedbackJson: undefined })]);
  parity('review の optional 不在', 'essay',
    [essayFixture({ reviews: [reviewEntryFixture({ source: undefined, parseError: undefined })] })]);

  // ★ generic の区別は変えていない（adapter normalization の責務内で処理している）
  const withUndef = DEVICE_PATH.activity(activityFixture({ nested: { a: undefined } }));
  const withoutKey = DEVICE_PATH.activity(activityFixture({ nested: {} }));
  check('nullability: {a:undefined} と {} は adapter 正規化後に同一（JSON 往復と一致）',
    withUndef !== null && withUndef === withoutKey);
  const withNull = DEVICE_PATH.activity(activityFixture({ nested: { a: null } }));
  check('nullability: null は欠損と区別される', withNull !== withoutKey);
}

function timestampParity(): void {
  // 同一 instant の 3 表記（device 側）
  const z = DEVICE_PATH.self_analysis([selfAnalysisFixture({ createdAt: '2026-08-26T09:12:33.123456Z' })]);
  const utc = DEVICE_PATH.self_analysis([selfAnalysisFixture({ createdAt: '2026-08-26T09:12:33.123456+00:00' })]);
  const jst = DEVICE_PATH.self_analysis([selfAnalysisFixture({ createdAt: '2026-08-26T18:12:33.123456+09:00' })]);
  check('timestamp: Z / +00:00 / +09:00 が同一 instant として一致', z !== null && z === utc && utc === jst);

  // offset 無しは UTC と仮定しない
  const naive = DEVICE_PATH.self_analysis([selfAnalysisFixture({ createdAt: '2026-08-26T09:12:33.123456' })]);
  check('timestamp: offset 無しを UTC と同一視しない', naive !== null && naive !== utc);

  // device の toISOString（Z）と PostgREST（+00:00）の往復 parity
  parity('timestamptz 表記差', 'self_analysis', [selfAnalysisFixture({ createdAt: '2026-08-26T09:12:33.123Z' })]);
  parity('timestamptz 表記差（essay）', 'essay', [essayFixture({ createdAt: '2026-08-01T00:00:00.000Z' })]);

  // ★ 学生入力に timestamp 風文字列があっても deep scan で変換しない
  const looksLikeTs = '2026-07-02T09:00:00+00:00';
  parity('本文中の timestamp 風文字列', 'self_pr', [selfPrFixture({ text: looksLikeTs })]);
  const raw = DEVICE_PATH.self_pr([selfPrFixture({ text: looksLikeTs })]);
  const shifted = DEVICE_PATH.self_pr([selfPrFixture({ text: '2026-07-02T18:00:00+09:00' })]);
  check('timestamp: 本文中の同一 instant 表記は正規化しない（別 fingerprint）',
    raw !== null && raw !== shifted);
}

function orderingParity(): void {
  // multiset: device の list 順を反転しても一致
  const sa = [selfAnalysisFixture(), selfAnalysisFixture({ id: 'log-2', freeMemo: 'x' })];
  check('ordering multiset: self_analysis',
    DEVICE_PATH.self_analysis(sa) === DEVICE_PATH.self_analysis([...sa].reverse()));
  const sr = [statementReviewFixture(), statementReviewFixture({ id: 'rev-2' })];
  check('ordering multiset: statement_review',
    DEVICE_PATH.statement_review(sr) === DEVICE_PATH.statement_review([...sr].reverse()));
  const pr = [selfPrFixture(), selfPrFixture({ id: 'pr-2', index: 1 })];
  check('ordering multiset: self_pr（表示順 pr_index を order に昇格させない）',
    DEVICE_PATH.self_pr(pr) === DEVICE_PATH.self_pr([...pr].reverse()));
  const ir = [interviewRecordFixture(), interviewRecordFixture({ id: 'ir-2' })];
  check('ordering multiset: interview_record',
    DEVICE_PATH.interview_record(ir) === DEVICE_PATH.interview_record([...ir].reverse()));
  const ws = [essayFixture(), essayFixture({ id: 'ws-2' })];
  check('ordering multiset: essay workspace list',
    DEVICE_PATH.essay(ws) === DEVICE_PATH.essay([...ws].reverse()));

  // sequence: item 内部の配列順は情報
  const seqA = DEVICE_PATH.self_analysis([selfAnalysisFixture({ answers: ['A1', 'A2'] })]);
  const seqB = DEVICE_PATH.self_analysis([selfAnalysisFixture({ answers: ['A2', 'A1'] })]);
  check('ordering sequence: self_analysis.answers の順序を検出', seqA !== seqB);
  const prefA = DEVICE_PATH.basic_info(basicInfoFixture());
  const prefB = DEVICE_PATH.basic_info(basicInfoFixture({ preferences: [...basicInfoFixture().preferences].reverse() }));
  check('ordering sequence: basic_info.preferences の順序を検出', prefA !== prefB);
  const revs = essayFixture().reviews;
  const revA = DEVICE_PATH.essay([essayFixture()]);
  const revB = DEVICE_PATH.essay([essayFixture({ reviews: [...revs].reverse() })]);
  check('ordering sequence: essay.reviews の順序を検出（位置反転を時刻で再ソートしない）', revA !== revB);

  // 反転した list でも mirror path と一致すること（順序正規化が両側で効く）
  parity('reversed list', 'self_pr', [...pr].reverse());
  parity('reversed list', 'essay', [...ws].reverse());
}

function essayContract(): void {
  const CANARY = 'CANARY_ESSAY_BODY_9c1f';
  const ws = essayFixture({
    body: CANARY,
    reviews: [reviewEntryFixture({ essayBodySnapshot: CANARY })],
  });
  const r = deviceEssayView([ws]);
  check('essay: device view を生成できる', r.ok);
  if (r.ok) {
    check('essay: device view に本文 / snapshot が現れない',
      !JSON.stringify(r.view).includes(CANARY));
  }
  // device row にも本文を持ち込まない（adapter 層へ本文が入らないこと）
  parity('本文入り fixture', 'essay', [ws]);

  // cap（recordItems）を跨いだときの reviewCount / 反転位置
  const many = Array.from({ length: L.recordItems + 5 }, (_, i) => reviewEntryFixture({ totalScore: i }));
  parity(`reviews ${many.length} 件（cap 超過）`, 'essay', [essayFixture({ reviews: many })]);
  const capped = deviceEssayView([essayFixture({ reviews: many })]);
  if (capped.ok) {
    const first = (capped.view as Record<string, unknown>[])[0];
    eq('essay: reviewCount は cap 前の件数', first.reviewCount, many.length);
    eq('essay: reviews は recordItems 件', (first.reviews as unknown[]).length, L.recordItems);
    const scores = (first.reviews as Record<string, unknown>[]).map((x) => x.totalScore);
    eq('essay: 新しい順（末尾が最新の配列を位置反転）', scores[0], many.length - 1);
  }
}

/**
 * ★ device row に本文 / PII を持ち込まない ★
 *   mapper が読まない field は fingerprint に出ないため parity では検出できない。
 *   しかし adapter 層へ本文が入ること自体が E-P5 / E-P8 / Canon §55 の違反であり、
 *   将来 view に足された瞬間に漏れる。row の段階で構造的に落とす。
 *
 *   row 形は writer ではなく **reader の projection** に合わせるという Wave 3 の契約が、
 *   ここで機械的に固定される。
 */
function devicePiiContainment(): void {
  const NAME = 'CANARY_STUDENT_NAME_4a7b';
  const infoRow = deviceBasicInfoRow(basicInfoFixture({ name: NAME }));
  check('PII: device basic_info row に name key が無い（E-P8 / stripName）',
    !('name' in (infoRow.payload as Record<string, unknown>)));
  check('PII: device basic_info row に氏名が現れない',
    !JSON.stringify(infoRow).includes(NAME));

  const ESSAY_BODY = 'CANARY_STATEMENT_ESSAY_4a7b';
  const srRow = deviceStatementReviewRow(statementReviewFixture({ essay: ESSAY_BODY }));
  check('PII: device statement_review row に essay（志望理由書本文）が無い',
    !('essay' in srRow) && !JSON.stringify(srRow).includes(ESSAY_BODY));

  const VERBATIM = 'CANARY_INTERVIEW_VERBATIM_4a7b';
  const irRow = deviceInterviewRecordRow(interviewRecordFixture({
    questionsAsked: VERBATIM,
    myAnswers: VERBATIM,
    partner: VERBATIM,
  }));
  check('PII: device interview_record row が生成できる', irRow.ok);
  if (irRow.ok) {
    check('PII: device interview_record row に逐語 / partner が無い（E-P5）',
      !('questions_asked' in irRow.row) && !('my_answers' in irRow.row) &&
      !('partner' in irRow.row) && !JSON.stringify(irRow.row).includes(VERBATIM));
  }

  const ESSAY_TEXT = 'CANARY_ESSAY_WORKSPACE_BODY_4a7b';
  const wsRow = deviceEssayRow(essayFixture({ body: ESSAY_TEXT }));
  check('PII: device essay row に workspace 本体（body 等）が無い（E-S27）',
    !('workspace' in wsRow) && !JSON.stringify(wsRow).includes(ESSAY_TEXT));
}

/**
 * essay: R5 closure 後の状態を固定する。
 *
 * ★ evidence と gate の drift を防ぐ（Wave 4.5 §61）★
 *   「runtime block を外した」ことと「その根拠が Register に残っている」ことは
 *   **必ず一緒に成立していなければならない**。片方だけが revert されると
 *   「根拠が消えたのに有効化されたまま」という最悪の状態になり、しかも
 *   fail-open が吸収するため runtime では気付けない。両方向を検査する。
 */
function essayEnableInvariant(): void {
  check('essay: capability は possible（contract 確定済み）',
    EXAM_SYNC_ADAPTER_CONTRACTS.essay.capability === 'possible');
  check('essay: device mapper が存在し pure parity が成立する',
    DEVICE_PATH.essay([essayFixture()]) !== null);

  // R5 closure evidence が Register と SQL の両方に実在すること
  const decisions = readFileSync(
    join(REPO_ROOT, 'docs', 'principles', 'exam_spine', 'EXAM_SPINE_DECISIONS.md'), 'utf8');
  const sql = readFileSync(
    join(REPO_ROOT, 'supabase', 'exam_spine_rls_verification.sql'), 'utf8');
  const r5Recorded =
    /rows_reviews_is_array\s*=\s*10/.test(decisions) &&
    /rows_reviews_wrong_type\s*=\s*\s*0/.test(decisions) &&
    /rows_bogus_path\s*=\s*\s*0/.test(decisions);
  const r5Reproducible =
    sql.includes('jsonb_typeof') && sql.includes("workspace->'reviews'") &&
    sql.includes('zzz_not_a_field');
  check('essay: R5 の production evidence が Register に記録されている', r5Recorded);
  check('essay: R5 を再検証できる read-only SQL が保持されている', r5Reproducible);
  check('essay: E-H1 が RESOLVED である', /^## E-H1[\s\S]{0,200}RESOLVED/m.test(decisions));

  // ★ drift guard: evidence が揃っている **から** block を外せている
  const essayBlocked = typeof EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.essay === 'string';
  check('★ essay: R5 evidence が揃っているなら runtime block は外れている',
    !(r5Recorded && r5Reproducible) || !essayBlocked);
  check('★ essay: R5 evidence が欠けているなら runtime block が必要',
    (r5Recorded && r5Reproducible) || essayBlocked);
  eq('runtime block は現在 0 kind（機構は残す）',
    Object.keys(EXAM_SYNC_RUNTIME_ENABLE_BLOCKED).sort(), []);

  // ★ 宣言を読んでよいのは「宣言元」と「pure な decision layer」だけ ★
  //   Wave 3 時点では consumer 0 本を要求していたが、Wave 4 で pure decision layer
  //   （lib/examSpine/sync/enable.ts）が宣言を参照するようになった。これは Wave 3 が
  //   「有効化 gate を実装する Wave 4 が、この宣言を必ず参照すること」と書いた予定どおりであり、
  //   守るべき不変条件は「consumer が 0」ではなく **production runtime が gate を持たない**こと。
  //   したがって allowlist を 2 file に固定し、それ以外を落とす（強度は下げていない）。
  const DECLARATION_CONSUMERS = [
    join('lib', 'examSpine', 'sync', 'adapters', 'registry.ts'),
    join('lib', 'examSpine', 'sync', 'enable.ts'),
  ];
  const consumers: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const file of listFiles(join(REPO_ROOT, dir))) {
      const rel = relative(REPO_ROOT, file);
      if (DECLARATION_CONSUMERS.includes(rel)) continue;
      if (readFileSync(file, 'utf8').includes('EXAM_SYNC_RUNTIME_ENABLE_BLOCKED')) consumers.push(rel);
    }
  }
  check('essay: 禁止宣言を読むのは宣言元と pure decision layer だけ',
    consumers.length === 0, consumers.join(', '));

  // decision layer 自体が production から呼ばれていないこと（= runtime gate が存在しない）
  const enableConsumers: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const file of listFiles(join(REPO_ROOT, dir))) {
      const rel = relative(REPO_ROOT, file);
      if (rel.startsWith(join('lib', 'examSpine'))) continue;
      if (/examSpine\/sync\/enable/.test(readFileSync(file, 'utf8'))) enableConsumers.push(rel);
    }
  }
  check('essay: decision layer が production から呼ばれていない（runtime gate 0）',
    enableConsumers.length === 0, enableConsumers.join(', '));
}

function failClosed(): void {
  // ★ 壊れた serialized field を null へ丸めない（unclaimed へ倒す）
  const broken = interviewRecordFixture({ feedbackJson: '{not json' });
  const r = deviceInterviewRecordItemView(broken);
  check('fail-closed: 壊れた feedbackJson は claim を作らない', !r.ok);
  if (!r.ok) eq('fail-closed: 理由が enum で返る', r.reason, 'unparseable_serialized_field');

  const listResult = deviceInterviewRecordView([interviewRecordFixture(), broken]);
  check('fail-closed: 1 件でも壊れていれば kind 全体を unclaimable にする', !listResult.ok);

  // writer は devWarn して null を書くので mirror 側には fingerprint が立つ。
  // device が同じく null へ丸めると「feedback 無しの端末」と区別できなくなるため、
  // device 側は fingerprint を出さない（＝ claim しない）ことを固定する。
  check('fail-closed: 壊れた record の mirror 側には fingerprint が立つ',
    typeof MIRROR_PATH.interview_record([broken]) === 'string');
  check('fail-closed: 壊れた record の device 側は fingerprint を出さない',
    DEVICE_PATH.interview_record([broken]) === null);
  check('fail-closed: feedbackJson 未設定は正常に claim できる（壊れと区別する）',
    DEVICE_PATH.interview_record([interviewRecordFixture({ feedbackJson: undefined })]) !== null);

  // claim → candidate（unclaimed になること）
  const claim = buildDeviceClaim('interview_record', { state: 'present', value: [broken] });
  eq('fail-closed: claim は unclaimed', claim.state, 'unclaimed');
  eq('fail-closed: candidate は unclaimed', deviceClaimToCandidate(claim).state, 'unclaimed');

  // read 失敗も unclaimed（empty と区別する）
  const unreadable = buildDeviceClaim('self_pr', { state: 'unreadable', reason: 'storage_unavailable' });
  eq('fail-closed: read 不能は unclaimed', unreadable.state, 'unclaimed');
  const absent = buildDeviceClaim('self_pr', { state: 'absent' });
  eq('fail-closed: absent は empty（unclaimed と区別）', absent.state, 'empty');
  eq('fail-closed: absent candidate は empty', deviceClaimToCandidate(absent).state, 'empty');
}

function verificationEndToEnd(): void {
  const prs = [selfPrFixture()];
  const deviceClaim = buildDeviceClaim('self_pr', { state: 'present', value: prs });
  check('e2e: device claim が claimed', deviceClaim.state === 'claimed');
  if (deviceClaim.state !== 'claimed') return;

  const mirrorView = listSyncView(
    prs.map((pr) => selfPrItemView(mapSelfPrRow(mirrorRow(writerSelfPrRow(pr), Q.selfPrQuery(U).columns), L)!)),
    (x) => x,
  );
  const mirrorObs = examSyncObservation({ kind: 'self_pr', source: 'server_mirror', view: mirrorView });

  const verified = verifyExamSourcePair({
    canonical: deviceClaimToCandidate(deviceClaim),
    mirror: serverMirrorCandidate({ status: 'ok', observation: mirrorObs }),
  });
  check('e2e: 同一内容 → verified',
    verified.status === 'verified' && verified.agreement === 'fingerprint');

  // device 側だけ更新 → mismatch
  const updated = buildDeviceClaim('self_pr', {
    state: 'present',
    value: [selfPrFixture({ text: '更新後の本文' })],
  });
  const mismatch = verifyExamSourcePair({
    canonical: deviceClaimToCandidate(updated),
    mirror: serverMirrorCandidate({ status: 'ok', observation: mirrorObs }),
  });
  check('e2e: device が更新済み → mismatch',
    mismatch.status === 'mismatch' && mismatch.evidence === 'fingerprint');

  // 注入 reader 経由（I/O は呼び出し側にある）
  const readers = {
    basic_info: () => ({ state: 'absent' as const }),
    activity: () => ({ state: 'absent' as const }),
    diagnosis: () => ({ state: 'absent' as const }),
    self_analysis: () => ({ state: 'absent' as const }),
    statement_review: () => ({ state: 'absent' as const }),
    self_pr: () => ({ state: 'present' as const, value: prs }),
    interview_record: () => ({ state: 'absent' as const }),
    essay: () => ({ state: 'absent' as const }),
  } as unknown as ExamDeviceSourceReaders;
  const candidate = readDeviceCandidate('self_pr', readers);
  check('e2e: 注入 reader から candidate を作れる', candidate.state === 'present');
  eq('e2e: absent reader は empty candidate', readDeviceCandidate('basic_info', readers).state, 'empty');
}

// ── 静的境界 ──────────────────────────────────────────────────────

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

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
    const idx = raw.indexOf('//');
    out.push(idx >= 0 ? raw.slice(0, idx) : raw);
  }
  return out;
}

function staticBoundaries(): void {
  const deviceFiles = ['deviceViews.ts', 'deviceSources.ts'].map((f) => join(ADAPTERS_DIR, f));
  const FORBIDDEN = [
    'localStorage', 'sessionStorage', 'window.', 'document.', 'globalThis',
    'fetch(', 'XMLHttpRequest', '@supabase', 'getBrowserSupabaseClient',
    'Date.now', 'Date.parse', 'new Date', 'Math.random', 'crypto.', 'console.',
    'process.', 'require(', 'node:', 'next/', 'server-only',
    '@anthropic-ai', 'openai', 'OpenAI', 'Anthropic', '@google/genai',
  ];
  const hits: string[] = [];
  for (const file of deviceFiles) {
    for (const line of codeLines(file)) {
      for (const t of FORBIDDEN) if (line.includes(t)) hits.push(`${relative(REPO_ROOT, file)}: ${t}`);
    }
  }
  check('device layer に I/O / clock / random / vendor / logging が 0', hits.length === 0, hits.join(' | '));

  // deviceSources は「注入境界」であって I/O 実装ではない
  const srcLines = codeLines(join(ADAPTERS_DIR, 'deviceSources.ts')).join('\n');
  check('deviceSources に storage 読み出しの実装が無い',
    !/getItem|setItem|JSON\.parse\(/.test(srcLines));

  // truncate を device 側で再実装していない（server の guard を通す）
  const dvLines = codeLines(join(ADAPTERS_DIR, 'deviceViews.ts')).join('\n');
  check('device 側に truncate / toStringArray の再実装が無い',
    !/function\s+(truncate|toStringArray|asRecord)/.test(dvLines));
  check('device view は server の mapper を経由する',
    /mapBasicInfoRow\(/.test(dvLines) && /mapEssayRow\(/.test(dvLines) &&
    /mapInterviewRecordRow\(/.test(dvLines));

  // adoption API が無い
  for (const word of ['adopt', 'winner', 'choose', 'prefer', 'newerWins', 'mergeSources', 'resolveConflict', 'selectAuthority']) {
    check(`device layer に "${word}" が現れない`,
      !dvLines.includes(word) && !srcLines.includes(word));
  }

  // class 2 の adapter を作っていない
  check('class 2 kind の device builder が存在しない',
    !dvLines.includes('interview_ai') && !dvLines.includes('presentation'));

  // production runtime からの import 0
  const importers: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const file of listFiles(join(REPO_ROOT, dir))) {
      const rel = relative(REPO_ROOT, file);
      if (rel.startsWith(join('lib', 'examSpine'))) continue;
      if (/examSpine\/sync/.test(readFileSync(file, 'utf8'))) importers.push(rel);
    }
  }
  // ★ Stage 5.0（E-S33 / E-S34）で pilot 1 purpose が接続済み。
  //   allowlist で管理し、device view 本体が production から直接
  //   import されていないことを別途固定する。
  const pilotImporters = ['app/tutor/page.tsx', 'app/api/tutor/route.ts'];
  const unexpected = importers.filter((f) => !pilotImporters.includes(f));
  check('sync を import する production file は Stage 5.0 pilot だけ',
    unexpected.length === 0, unexpected.join(', '));
}

// ── run ───────────────────────────────────────────────────────────

function aiSdkLoaded(): boolean {
  const cache =
    (globalThis as { require?: { cache?: Record<string, unknown> } }).require?.cache ??
    (typeof require !== 'undefined' ? require.cache : undefined);
  if (!cache) return false;
  return Object.keys(cache).some(
    (p) => p.includes('@anthropic-ai') || p.includes('/openai/') || p.includes('@google/genai'),
  );
}

function main(): void {
  console.log('[exam-spine-sync-device] Stage 4 Wave 3 device ↔ mirror parity check');
  console.log(`[exam-spine-sync-device] kinds=${EXAM_SYNC_SUPPORTED_KINDS.length} limits=${JSON.stringify(L)}`);

  staticBoundaries();
  schemaVersionPin();

  const nondet = withNondeterminismTrap(() => {
    baselineParity();
    fieldSetFreeze();
    truncationParity();
    nullabilityParity();
    timestampParity();
    orderingParity();
    essayContract();
    devicePiiContainment();
    essayEnableInvariant();
    failClosed();
    verificationEndToEnd();
  });

  check(`clock 呼び出し = 0（実測 ${nondet.dateCalls}）`, nondet.dateCalls === 0);
  check(`random 呼び出し = 0（実測 ${nondet.randomCalls}）`, nondet.randomCalls === 0);

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-sync-device] FAIL: 外部通信が ${fetchCallCount} 回発生しました`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[exam-spine-sync-device] network calls = ${fetchCallCount}（実 Supabase / AI 呼び出しゼロ）`);
  console.log(`[exam-spine-sync-device] clock calls   = ${nondet.dateCalls}`);
  console.log(`[exam-spine-sync-device] random calls  = ${nondet.randomCalls}`);
  console.log(`[exam-spine-sync-device] AI SDK loaded = ${aiSdkLoaded() ? 'YES' : 'NO'}`);
  if (aiSdkLoaded()) {
    console.error('[exam-spine-sync-device] FAIL: AI SDK が module graph に載っています');
    process.exitCode = 1;
    return;
  }

  console.log(`[exam-spine-sync-device] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`\n[exam-spine-sync-device] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 25)) console.error(`  - ${f}`);
    if (failures.length > 25) console.error(`  … 他 ${failures.length - 25} 件`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-sync-device] PASS');
}

main();
