// Exam Spine — Stage 4 Wave 2 / sync adapter contract check（Wave 2.5 で canonical convergence 反映）。
//
// 目的:
//   lib/examSpine/sync/adapters/** が
//     real source data → kind-specific adapter → normalized observation → Wave 1 primitives
//   という境界を、**Authority 判断を持たずに**満たすことを機械的に示す。
//
// 本 script が守らせる guard:
//   A1  registry（宣言）と view（実装）の key 集合が一致する ＝ contract の凍結
//   A2  除外 field はすべて分類済みの理由と実コード evidence を持つ
//   A3  E-L2 / E-S3 の authority 決定が registry に正しく反映されている
//       （class 2 は not_applicable。adapter を実装しない）
//   A4  metadata だけの差では fingerprint が変わらない / content の差では必ず変わる
//   A5  multiset kind は source 側の順序差を吸収し、sequence（item 内部配列）は順序を検出する
//   A6  timestamptz は instant へ正規化するが、offset を持たない値は UTC と仮定しない
//   A7  revision は宣言どおり absent（無い revision を生成しない）
//   A8  mixed-origin を型と runtime の両方で防ぐ
//   A9  adapter / export に adoption API（採用側を返すもの）が存在しない
//   A10 read status → candidate の写像が E-S2 の優先順位（unreadable > unclaimed）に従う
//   A11 Wave 2.5 convergence pin: essay 分類の根拠（E-S27）が実コードで成立していること、
//       purpose gate（E-S28）の denied と E-H1 の「200 + 0 行」経路が verified を出さないこと
//
// 厳守:
//   実ネットワーク 0 / 実 DB 0 / AI 呼び出し 0 / clock 0 / random 0 / production 変更 0
//
// 使い方:
//   npm run qa:examSpine:syncAdapters

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let fetchCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCallCount += 1;
  const target = typeof args[0] === 'string' ? args[0] : '(non-string input)';
  throw new Error(`[exam-spine-sync-adapters] 外部通信が発生しました: ${target}`);
}) as typeof globalThis.fetch;
void originalFetch;

import { EXAM_SOURCE_AUTHORITY, EXAM_SOURCE_KINDS } from '@/lib/examSpine/sourceData/types';
import type { ExamSourceKind, ExamSourceReadStatus } from '@/lib/examSpine/sourceData/types';
import { EXAM_READ_FIELD_LIMITS } from '@/lib/examSpine/read/readSources';
import { essayQuery } from '@/lib/examSpine/read/queries';
import { mapEssayRow } from '@/lib/examSpine/read/rowMappers';
import type {
  ExamSelfPrServerRow,
  ExamSelfAnalysisServerRow,
  ExamStatementReviewServerRow,
  ExamInterviewRecordServerRow,
  ExamBasicInfoServerRow,
  ExamActivityServerRow,
  ExamDiagnosisServerRow,
  ExamEssayServerRow,
} from '@/lib/examSpine/read/rowMappers';

import * as NormalizeMod from '@/lib/examSpine/sync/adapters/normalize';
import * as TypesMod from '@/lib/examSpine/sync/adapters/types';
import * as RegistryMod from '@/lib/examSpine/sync/adapters/registry';
import * as ViewsMod from '@/lib/examSpine/sync/adapters/views';

import {
  EXAM_SYNC_NORMALIZE_VERSION,
  normalizeSyncJson,
  normalizeSyncTimestamp,
  sortSyncItems,
  syncFingerprint,
} from '@/lib/examSpine/sync/adapters/normalize';
import {
  EXAM_SYNC_ADAPTER_CONTRACTS,
  EXAM_SYNC_SUPPORTED_KINDS,
  EXAM_SYNC_VIEW_VERSION,
  isExamSyncSupportedKind,
} from '@/lib/examSpine/sync/adapters/registry';
import {
  ExamSyncOriginError,
  deviceCanonicalCandidate,
  serverMirrorCandidate,
} from '@/lib/examSpine/sync/adapters/types';
import type { ExamSyncObservation } from '@/lib/examSpine/sync/adapters/types';
import {
  ESSAY_REVIEW_CONTENT_FIELDS,
  activitySyncView,
  basicInfoSyncView,
  diagnosisSyncView,
  essayReviewView,
  essaySyncView,
  examSyncObservation,
  interviewRecordItemView,
  listSyncView,
  selfAnalysisItemView,
  selfPrItemView,
  statementReviewItemView,
} from '@/lib/examSpine/sync/adapters/views';
import { verifyExamSourcePair } from '@/lib/examSpine/sync/verification';
import { isExamFingerprint } from '@/lib/examSpine/sync/fingerprint';

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

const FORBIDDEN_TOKENS: readonly string[] = [
  '@supabase',
  'getBrowserSupabaseClient',
  'serverClient',
  'serviceRole',
  'next/',
  'server-only',
  'localStorage.',
  'sessionStorage.',
  'localStorage[',
  'document.',
  'window.',
  'process.',
  'require(',
  'node:',
  'fetch(',
  'Date.now',
  'Date.parse',
  'new Date',
  'Math.random',
  'crypto.',
  'randomUUID',
  'console.',
  '@anthropic-ai',
  'openai',
  'OpenAI',
  'Anthropic',
  '@google/genai',
];

/** adapter が import してよい先（core 相対 + Spine 内部の純粋 contract のみ）。 */
const ALLOWED_IMPORTS: readonly RegExp[] = [
  /^\.\/[A-Za-z0-9_-]+$/, // adapters/** 内部
  /^\.\.\/[A-Za-z0-9_-]+$/, // sync core（fingerprint / revision / verification）
  /^\.\.\/\.\.\/sourceData\/types$/,
  /^\.\.\/\.\.\/read\/(types|rowMappers|readSources|guards)$/,
];

/**
 * Wave 3: device view が使う domain 型。**type-only import に限って**許可する。
 * 「device 側の shape を発明しない」ために実 storage の型を使う必要がある一方、
 * runtime dependency は 1 本も作らない（`import type` は runtime に残らない）。
 * allowlist は列挙で持つ（`@/lib/**` を丸ごと開けない）。
 */
const ALLOWED_TYPE_ONLY_IMPORTS: readonly string[] = [
  '@/types/basicInfo',
  '@/types/activity',
  '@/types/selfAnalysisLog',
  '@/types/selfPR',
  '@/types/essay',
  '@/lib/diagnosisStorage',
  '@/lib/statement/review/statementStorage',
  '@/lib/interviewRecordStorage',
];

function staticBoundaries(): void {
  const files = listFiles(ADAPTERS_DIR);
  eq('adapters が 6 file 構成である', files.map((f) => relative(ADAPTERS_DIR, f)).sort(),
    ['deviceSources.ts', 'deviceViews.ts', 'normalize.ts', 'registry.ts', 'types.ts', 'views.ts']);

  const tokenHits: string[] = [];
  for (const file of files) {
    for (const line of codeLines(file)) {
      for (const token of FORBIDDEN_TOKENS) {
        if (line.includes(token)) tokenHits.push(`${relative(REPO_ROOT, file)}: ${token}`);
      }
    }
  }
  check('forbidden token = 0（I/O / clock / random / vendor / logging）',
    tokenHits.length === 0, tokenHits.join(' | '));

  const importHits: string[] = [];
  const valueImportHits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)) {
      const spec = m[1];
      const typeOnly = /^\s*import\s+type\s/.test(m[0]);
      if (ALLOWED_IMPORTS.some((re) => re.test(spec))) continue;
      if (ALLOWED_TYPE_ONLY_IMPORTS.includes(spec)) {
        // domain 型は type-only でしか許さない（値を import したら runtime 依存になる）
        if (!typeOnly) valueImportHits.push(`${relative(REPO_ROOT, file)}: ${spec}`);
        continue;
      }
      importHits.push(`${relative(REPO_ROOT, file)}: ${spec}`);
    }
  }
  check('adapters の import は sync core + Spine 内部 contract + 許可 domain 型のみ',
    importHits.length === 0, importHits.join(' | '));
  check('domain 型は type-only import に限る（runtime 依存 0）',
    valueImportHits.length === 0, valueImportHits.join(' | '));

  const dbVerbs: string[] = [];
  const BUILTIN_FROM = new Set(['Array', 'Uint8Array', 'Uint32Array', 'Object', 'String', 'Set', 'Map']);
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    for (const line of codeLines(file)) {
      for (const p of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
        if (line.includes(p)) dbVerbs.push(`${rel}: ${p}`);
      }
      for (const m of line.matchAll(/([A-Za-z0-9_$]+)\.from\(/g)) {
        if (!BUILTIN_FROM.has(m[1])) dbVerbs.push(`${rel}: ${m[1]}.from(`);
      }
    }
  }
  check('adapters に DB 動詞が 0 本', dbVerbs.length === 0, dbVerbs.join(' | '));

  // A9: adoption API が無い
  const banned = /adopt|winner|newerWins|prefer|chooseSide|resolveConflict|latestWins/i;
  const nameOffenders: string[] = [];
  const surfaces: Array<[string, Record<string, unknown>]> = [
    ['normalize.ts', NormalizeMod as unknown as Record<string, unknown>],
    ['types.ts', TypesMod as unknown as Record<string, unknown>],
    ['registry.ts', RegistryMod as unknown as Record<string, unknown>],
    ['views.ts', ViewsMod as unknown as Record<string, unknown>],
  ];
  for (const [name, mod] of surfaces) {
    for (const key of Object.keys(mod)) if (banned.test(key)) nameOffenders.push(`${name}: ${key}`);
  }
  check('A9 「採用 / 選択」を示す export が 0（Canon §31 / §32）',
    nameOffenders.length === 0, nameOffenders.join(', '));

  const bodyOffenders: string[] = [];
  for (const file of files) {
    const src = codeLines(file).join('\n');
    for (const word of ['adopt', 'winner', 'newerWins', 'latestWins', 'resolveConflict', 'compareRevision']) {
      if (src.includes(word)) bodyOffenders.push(`${relative(REPO_ROOT, file)}: ${word}`);
    }
  }
  check('A9 adapters は順序比較 / 採用語彙を実装に持たない',
    bodyOffenders.length === 0, bodyOffenders.join(' | '));

  // envelope が limits を含むこと（限界値変更が黙った不一致にならないこと）
  const viewsSrc = codeLines(join(ADAPTERS_DIR, 'views.ts')).join('\n');
  check('fingerprint envelope が EXAM_READ_FIELD_LIMITS を含む',
    /limits:\s*EXAM_READ_FIELD_LIMITS/.test(viewsSrc));

  // production runtime へ未接続（Wave 2 は wiring しない）
  const importers: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const file of listFiles(join(REPO_ROOT, dir))) {
      const rel = relative(REPO_ROOT, file);
      if (rel.startsWith(join('lib', 'examSpine'))) continue;
      if (/examSpine\/sync/.test(readFileSync(file, 'utf8'))) importers.push(rel);
    }
  }
  // ★ Stage 5.0（E-S33）で claim 層が pilot の production path に入った。
  //   adapter 本体（registry / views / normalize / types）は引き続き
  //   production から直接 import されない。
  const pilotImporters = ['app/tutor/page.tsx', 'app/api/tutor/route.ts'];
  const unexpected = importers.filter((f) => !pilotImporters.includes(f));
  check('sync を import する production file は Stage 5.0 pilot だけ',
    unexpected.length === 0, unexpected.join(', '));

  const adapterDirect: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const file of listFiles(join(REPO_ROOT, dir))) {
      const rel = relative(REPO_ROOT, file);
      if (rel.startsWith(join('lib', 'examSpine'))) continue;
      if (/examSpine\/sync\/adapters/.test(readFileSync(file, 'utf8'))) adapterDirect.push(rel);
    }
  }
  check('adapter 本体は production から直接 import されない（接続点は claim 層のみ）',
    adapterDirect.length === 0, adapterDirect.join(', '));
}

// ── registry contract ─────────────────────────────────────────────

function registryContract(): void {
  eq('registry が 10 kind すべてを持つ',
    Object.keys(EXAM_SYNC_ADAPTER_CONTRACTS).sort(), [...EXAM_SOURCE_KINDS].sort());

  const badKindField: string[] = [];
  const badAuthority: string[] = [];
  for (const kind of EXAM_SOURCE_KINDS) {
    const c = EXAM_SYNC_ADAPTER_CONTRACTS[kind];
    if (c.kind !== kind) badKindField.push(kind);
    // A3: authority は E-L2 の宣言を写すだけで、上書きしない
    if (c.authority !== EXAM_SOURCE_AUTHORITY[kind]) badAuthority.push(kind);
  }
  check('registry の kind field が key と一致', badKindField.length === 0, badKindField.join(', '));
  check('A3 registry の authority が EXAM_SOURCE_AUTHORITY（E-L2）と一致',
    badAuthority.length === 0, badAuthority.join(', '));

  // A3: class 2 は E-S3 により not_applicable
  for (const kind of ['interview_ai', 'presentation'] as const) {
    const c = EXAM_SYNC_ADAPTER_CONTRACTS[kind];
    check(`A3 ${kind} は not_applicable（E-S3）`, c.capability === 'not_applicable');
    check(`A3 ${kind} は content field を宣言しない`, c.contentFields.length === 0);
    check(`A3 ${kind} の blocker が E-S3 を引用する`, (c.blocker ?? '').includes('E-S3'));
    check(`A3 ${kind} は supported kind に入らない`, !isExamSyncSupportedKind(kind));
  }

  // ★ Wave 2.5: essay は E-S27（LOCKED / Wave 2 で実装 + QA 済み）により blocked を解除 ★
  const essay = EXAM_SYNC_ADAPTER_CONTRACTS.essay;
  check('essay は possible（E-S27 で projection が確定）', essay.capability === 'possible');
  check('essay は supported kind に入る', isExamSyncSupportedKind('essay'));
  check('essay の blocker が null', essay.blocker === null);
  check('essay の evidence が E-S27 を引用する',
    essay.excludedFields.some((e) => e.evidence.includes('E-S27')));

  // blocked が残っている kind があれば blocker の明示を強制する（宣言の空洞化を防ぐ）
  const blockedWithoutReason = EXAM_SOURCE_KINDS.filter((k) => {
    const c = EXAM_SYNC_ADAPTER_CONTRACTS[k];
    return c.capability === 'blocked' && (c.blocker ?? '').trim().length < 20;
  });
  check('blocked kind は必ず blocker を明示する',
    blockedWithoutReason.length === 0, blockedWithoutReason.join(', '));

  // capability === possible ⇔ supported kind
  const possible = EXAM_SOURCE_KINDS.filter(
    (k) => EXAM_SYNC_ADAPTER_CONTRACTS[k].capability === 'possible',
  );
  eq('capability=possible の集合が EXAM_SYNC_SUPPORTED_KINDS と一致',
    [...possible].sort(), [...EXAM_SYNC_SUPPORTED_KINDS].sort());

  // A2: 除外 field の evidence
  const weak: string[] = [];
  const emptyContent: string[] = [];
  for (const kind of EXAM_SYNC_SUPPORTED_KINDS) {
    const c = EXAM_SYNC_ADAPTER_CONTRACTS[kind];
    if (c.contentFields.length === 0) emptyContent.push(kind);
    if (c.excludedFields.length === 0) weak.push(`${kind}: 除外宣言が 0 件`);
    for (const ex of c.excludedFields) {
      if (ex.field.trim() === '') weak.push(`${kind}: field が空`);
      if (ex.evidence.trim().length < 20) weak.push(`${kind}.${ex.field}: evidence が薄い`);
    }
  }
  check('A2 実装 kind はすべて content field を持つ', emptyContent.length === 0, emptyContent.join(', '));
  check('A2 除外 field がすべて実コード evidence を持つ', weak.length === 0, weak.join(' | '));

  // A7: revision は全 kind absent（無いものを生成しない）
  const declared = EXAM_SOURCE_KINDS.filter(
    (k) => EXAM_SYNC_ADAPTER_CONTRACTS[k].revision.form !== 'absent',
  );
  check('A7 revision contract は全 kind absent（Wave 2 の宣言）',
    declared.length === 0, declared.join(', '));
  const noReason = EXAM_SOURCE_KINDS.filter((k) => {
    const r = EXAM_SYNC_ADAPTER_CONTRACTS[k].revision;
    return r.form === 'absent' && r.reason.trim().length < 10;
  });
  check('A7 revision absent の理由が全 kind で明文化されている',
    noReason.length === 0, noReason.join(', '));

  // order semantics の宣言
  eq('snapshot 3 kind は single',
    (['basic_info', 'activity', 'diagnosis'] as const).map((k) => EXAM_SYNC_ADAPTER_CONTRACTS[k].order),
    ['single', 'single', 'single']);
  eq('history 4 kind は multiset',
    (['self_analysis', 'statement_review', 'self_pr', 'interview_record'] as const)
      .map((k) => EXAM_SYNC_ADAPTER_CONTRACTS[k].order),
    ['multiset', 'multiset', 'multiset', 'multiset']);

  // 限界値の凍結（変えたら EXAM_SYNC_VIEW_VERSION を上げる判断が要る）
  eq('EXAM_READ_FIELD_LIMITS が凍結値と一致', EXAM_READ_FIELD_LIMITS,
    { shortText: 200, longText: 4000, arrayItems: 20, arrayItemLength: 400, recordItems: 10 });
  check('version 定数が宣言されている',
    EXAM_SYNC_VIEW_VERSION === 'sv1' && EXAM_SYNC_NORMALIZE_VERSION === 'snv1');
}

// ── fixtures（Stage 3 projection 型そのもの）──────────────────────

function basicInfoRow(): ExamBasicInfoServerRow {
  return {
    nameOnServer: false,
    grade: '3',
    track: '文系',
    overallGpa: '4.2',
    examTypes: ['総合型', '学校推薦型'],
    preferences: [
      { university: 'A大学', faculty: '法学部', department: '法律学科' },
      { university: 'B大学', faculty: null, department: null },
    ],
    // ★ sync view には入らない事実列（E-S56）★ 入っていないことは T? が検査する。
    rawPreferences: [
      { sourceIndex: 0, university: 'A大学', faculty: '法学部', department: '法律学科' },
      { sourceIndex: 1, university: 'B大学', faculty: null, department: null },
    ],
    subjectGrades: { 国語: '5', 数学: '4' },
    schemaVersion: '1',
  };
}

/** 余剰 field を持つ row（object literal の excess property check を避けるため変数経由で作る）。 */
function activityRowWith(over: Partial<ExamActivityServerRow>): ExamActivityServerRow {
  const row: ExamActivityServerRow = { ...activityRow(), ...over };
  return row;
}

/** 氏名を持つ row。server には存在しないが、device 側が誤って渡しても view に入らないことを示す。 */
function basicInfoRowWithName(name: string): ExamBasicInfoServerRow {
  const row: ExamBasicInfoServerRow & { name?: string } = { ...basicInfoRow(), name };
  return row;
}

function activityRow(): ExamActivityServerRow {
  return {
    payload: { club: [{ title: '吹奏楽' }], volunteer: [] },
    categoryCounts: { club: 1, volunteer: 0 },
    schemaVersion: '1',
  };
}

function diagnosisRow(): ExamDiagnosisServerRow {
  return { payload: { typeHint: 'X', scores: [1, 2, 3] }, schemaVersion: '3' };
}

function selfAnalysisRow(over: Partial<ExamSelfAnalysisServerRow> = {}): ExamSelfAnalysisServerRow {
  return {
    id: 'db-uuid-1',
    createdAt: '2026-08-26T09:12:33.123456+00:00',
    analysis: { walls: ['w1'] },
    summary: { text: 'まとめ' },
    displayedQuestions: ['Q1', 'Q2'],
    answers: ['A1', 'A2'],
    deepAnswers: ['D1'],
    freeMemo: 'メモ',
    ...over,
  };
}

function statementReviewRow(
  over: Partial<ExamStatementReviewServerRow> = {},
): ExamStatementReviewServerRow {
  return {
    id: 'db-uuid-2',
    localReviewId: 'local-r-1',
    university: 'A大学',
    faculty: '法学部',
    department: '法律学科',
    result: { score: 80 },
    createdAt: '2026-08-26T09:12:33+00:00',
    ...over,
  };
}

function selfPrRow(over: Partial<ExamSelfPrServerRow> = {}): ExamSelfPrServerRow {
  return {
    id: 'db-uuid-3',
    localPrId: 'local-pr-1',
    prIndex: 0,
    title: '自己PR',
    body: '本文です',
    latestResult: '講評です',
    createdAt: '2026-08-01T00:00:00+00:00',
    updatedAt: '2026-08-26T09:12:33+00:00',
    ...over,
  };
}

function essayReviewRow(
  over: Partial<ExamEssayServerRow['reviews'][number]> = {},
): ExamEssayServerRow['reviews'][number] {
  return {
    bodyOnServer: false,
    totalScore: 82,
    verdict: 'B',
    improvement: '結論を先に書く',
    goodPoints: ['構成が明確'],
    weakPoints: ['具体例が薄い'],
    createdAt: '2026-08-20T10:00:00.000Z',
    source: 'ai',
    parseError: false,
    ...over,
  };
}

function essayRow(over: Partial<ExamEssayServerRow> = {}): ExamEssayServerRow {
  return {
    bodyOnServer: false,
    id: 'db-uuid-5',
    localWorkspaceId: 'ws-1',
    reviews: [essayReviewRow(), essayReviewRow({ totalScore: 70, verdict: 'C' })],
    reviewCount: 2,
    reviewsTruncated: false,
    createdAt: '2026-08-01T00:00:00+00:00',
    updatedAt: '2026-08-26T09:12:33+00:00',
    ...over,
  };
}

function interviewRecordRow(
  over: Partial<ExamInterviewRecordServerRow> = {},
): ExamInterviewRecordServerRow {
  return {
    id: 'db-uuid-4',
    localRecordId: 'local-ir-1',
    practiceDate: '2026-08-20',
    universityName: 'A大学',
    facultyName: '法学部',
    examType: '総合型',
    mainQuestion: '志望理由を教えてください',
    improvementSummary: '結論を先に',
    whatWentWrong: '緊張した',
    feedbackReceived: '良い',
    selfNoted: '練習する',
    feedback: { strengths: ['s1'] },
    createdAt: '2026-08-20T10:00:00+00:00',
    ...over,
  };
}

// ── A1: 宣言と実装の一致 ──────────────────────────────────────────

function contractFreeze(): void {
  const cases: Array<[ExamSourceKind, Record<string, unknown>]> = [
    ['basic_info', basicInfoSyncView(basicInfoRow())],
    ['activity', activitySyncView(activityRow())],
    ['diagnosis', diagnosisSyncView(diagnosisRow())],
    ['self_analysis', selfAnalysisItemView(selfAnalysisRow())],
    ['statement_review', statementReviewItemView(statementReviewRow())],
    ['self_pr', selfPrItemView(selfPrRow())],
    ['interview_record', interviewRecordItemView(interviewRecordRow())],
    ['essay', essaySyncView(essayRow())],
  ];
  for (const [kind, view] of cases) {
    const declared = [...EXAM_SYNC_ADAPTER_CONTRACTS[kind].contentFields].sort();
    eq(`A1 ${kind} の view key 集合が contentFields と一致`, Object.keys(view).sort(), declared);
  }

  // 除外宣言した field が view に紛れ込んでいないこと
  const leaked: string[] = [];
  for (const [kind, view] of cases) {
    const keys = new Set(Object.keys(view));
    for (const ex of EXAM_SYNC_ADAPTER_CONTRACTS[kind].excludedFields) {
      for (const f of ex.field.split('/').map((s) => s.trim())) {
        if (f !== '' && keys.has(f)) leaked.push(`${kind}.${f}`);
      }
    }
  }
  check('A1 除外宣言した field が view に現れない', leaked.length === 0, leaked.join(', '));

  // 逐語 / 本文の非読取（E-P5）が view でも成立していること
  const forbiddenKeys = ['essay', 'questionsAsked', 'myAnswers', 'transcript', 'name', 'workspace'];
  const bad: string[] = [];
  for (const [kind, view] of cases) {
    for (const k of Object.keys(view)) if (forbiddenKeys.includes(k)) bad.push(`${kind}.${k}`);
  }
  check('A1 逐語 / 本文 / 氏名 が view に入っていない（E-P5 / E-P8）',
    bad.length === 0, bad.join(', '));

  // essay review item の key 集合も凍結する（宣言 ESSAY_REVIEW_CONTENT_FIELDS と一致）
  eq('A1 essay review の key 集合が宣言と一致',
    Object.keys(essayReviewView(essayReviewRow())).sort(),
    [...ESSAY_REVIEW_CONTENT_FIELDS].sort());

  // ★ Wave 2.5 convergence pin: essay を possible にした根拠（E-S27）を実コードで固定する ★
  //   E-S27 が revert されたら、この 3 件が落ちて分類の前提崩れを知らせる。
  const eq2 = essayQuery('00000000-0000-4000-8000-000000000000');
  check('E-S27 pin: essayQuery が workspace を丸ごと SELECT しない',
    !eq2.columns.includes('workspace'), eq2.columns.join(', '));
  check('E-S27 pin: essayQuery が reviews:workspace->reviews へ絞る',
    eq2.columns.includes('reviews:workspace->reviews'), eq2.columns.join(', '));

  //   mapper が本文 snapshot を落とすことを、実 mapper を通して確認する（grep ではない）
  const CANARY_BODY = 'CANARY_ESSAY_BODY_7f2a';
  const mapped = mapEssayRow(
    {
      id: 'db-uuid-9',
      local_workspace_id: 'ws-9',
      reviews: [
        {
          totalScore: 90,
          verdict: 'A',
          improvement: 'よい',
          goodPoints: [],
          weakPoints: [],
          createdAt: '2026-08-20T10:00:00.000Z',
          essayBodySnapshot: CANARY_BODY,
          breakdown: [{ label: CANARY_BODY }],
        },
      ],
      created_at: '2026-08-01T00:00:00+00:00',
      updated_at: '2026-08-26T09:12:33+00:00',
    },
    EXAM_READ_FIELD_LIMITS,
  );
  check('E-S27 pin: mapEssayRow が本文 snapshot を projection に載せない',
    mapped !== null && !JSON.stringify(mapped).includes(CANARY_BODY));
  check('E-S27 pin: sync view にも本文 snapshot が現れない',
    mapped !== null && !JSON.stringify(essaySyncView(mapped)).includes(CANARY_BODY));
}

// ── A4: semantic equality / difference ────────────────────────────

function semanticEquality(): void {
  const fp = (kind: (typeof EXAM_SYNC_SUPPORTED_KINDS)[number], view: unknown): string =>
    examSyncObservation({ kind, source: 'server_mirror', view }).fingerprint;

  // determinism
  const v = basicInfoSyncView(basicInfoRow());
  let stable = true;
  for (let i = 0; i < 50; i += 1) if (fp('basic_info', v) !== fp('basic_info', v)) stable = false;
  check('determinism: 同一 view 50 回で同じ fingerprint', stable);
  check('fingerprint が efp1 形式', isExamFingerprint(fp('basic_info', v)));

  // ★ metadata だけの差では変わらない ★
  const metadataOnly: Array<[string, string, string]> = [
    [
      'self_pr: DB uuid / createdAt / updatedAt',
      fp('self_pr', selfPrItemView(selfPrRow())),
      fp('self_pr', selfPrItemView(selfPrRow({
        id: 'db-uuid-DIFFERENT',
        createdAt: '2020-01-01T00:00:00+00:00',
        updatedAt: '2030-01-01T00:00:00+00:00',
      }))),
    ],
    [
      'statement_review: DB uuid / createdAt',
      fp('statement_review', statementReviewItemView(statementReviewRow())),
      fp('statement_review', statementReviewItemView(statementReviewRow({
        id: 'x', createdAt: '2001-01-01T00:00:00+00:00',
      }))),
    ],
    [
      'interview_record: DB uuid / createdAt',
      fp('interview_record', interviewRecordItemView(interviewRecordRow())),
      fp('interview_record', interviewRecordItemView(interviewRecordRow({
        id: 'y', createdAt: '2001-01-01T00:00:00+00:00',
      }))),
    ],
    [
      'self_analysis: DB uuid',
      fp('self_analysis', selfAnalysisItemView(selfAnalysisRow())),
      fp('self_analysis', selfAnalysisItemView(selfAnalysisRow({ id: 'z' }))),
    ],
    [
      'activity: categoryCounts（導出物）',
      fp('activity', activitySyncView(activityRow())),
      fp('activity', activitySyncView(activityRowWith({ categoryCounts: { bogus: 99 } }))),
    ],
    [
      'essay: DB uuid / updatedAt / reviewsTruncated',
      fp('essay', essaySyncView(essayRow())),
      fp('essay', essaySyncView(essayRow({
        id: 'db-uuid-DIFFERENT',
        updatedAt: '2030-01-01T00:00:00+00:00',
        reviewsTruncated: true,
      }))),
    ],
    [
      'basic_info: 余剰 field（氏名など）は view に入らない',
      fp('basic_info', basicInfoSyncView(basicInfoRow())),
      fp('basic_info', basicInfoSyncView(basicInfoRowWithName('山田太郎'))),
    ],
  ];
  const changed = metadataOnly.filter(([, a, b]) => a !== b).map(([l]) => l);
  check('A4 metadata だけの差では content fingerprint が変わらない',
    changed.length === 0, changed.join(' | '));

  // ★ content の差では必ず変わる ★
  const contentDiff: Array<[string, string, string]> = [
    ['self_pr.body', fp('self_pr', selfPrItemView(selfPrRow())),
      fp('self_pr', selfPrItemView(selfPrRow({ body: '本文です。' })))],
    ['self_pr.title', fp('self_pr', selfPrItemView(selfPrRow())),
      fp('self_pr', selfPrItemView(selfPrRow({ title: '自己PR2' })))],
    ['self_pr.prIndex', fp('self_pr', selfPrItemView(selfPrRow())),
      fp('self_pr', selfPrItemView(selfPrRow({ prIndex: 1 })))],
    ['self_pr.latestResult', fp('self_pr', selfPrItemView(selfPrRow())),
      fp('self_pr', selfPrItemView(selfPrRow({ latestResult: '別講評' })))],
    ['self_pr.localPrId', fp('self_pr', selfPrItemView(selfPrRow())),
      fp('self_pr', selfPrItemView(selfPrRow({ localPrId: 'local-pr-2' })))],
    ['statement_review.result', fp('statement_review', statementReviewItemView(statementReviewRow())),
      fp('statement_review', statementReviewItemView(statementReviewRow({ result: { score: 81 } })))],
    ['statement_review.university', fp('statement_review', statementReviewItemView(statementReviewRow())),
      fp('statement_review', statementReviewItemView(statementReviewRow({ university: 'C大学' })))],
    ['interview_record.feedback', fp('interview_record', interviewRecordItemView(interviewRecordRow())),
      fp('interview_record', interviewRecordItemView(interviewRecordRow({ feedback: { strengths: ['s2'] } })))],
    ['interview_record.selfNoted', fp('interview_record', interviewRecordItemView(interviewRecordRow())),
      fp('interview_record', interviewRecordItemView(interviewRecordRow({ selfNoted: 'x' })))],
    ['self_analysis.answers', fp('self_analysis', selfAnalysisItemView(selfAnalysisRow())),
      fp('self_analysis', selfAnalysisItemView(selfAnalysisRow({ answers: ['A1', 'A3'] })))],
    ['self_analysis.freeMemo', fp('self_analysis', selfAnalysisItemView(selfAnalysisRow())),
      fp('self_analysis', selfAnalysisItemView(selfAnalysisRow({ freeMemo: 'メモ2' })))],
    ['self_analysis.createdAt（別 instant）', fp('self_analysis', selfAnalysisItemView(selfAnalysisRow())),
      fp('self_analysis', selfAnalysisItemView(selfAnalysisRow({ createdAt: '2026-08-26T09:12:33.123457+00:00' })))],
    ['basic_info.grade', fp('basic_info', basicInfoSyncView(basicInfoRow())),
      fp('basic_info', basicInfoSyncView({ ...basicInfoRow(), grade: '2' }))],
    ['basic_info.preferences', fp('basic_info', basicInfoSyncView(basicInfoRow())),
      fp('basic_info', basicInfoSyncView({ ...basicInfoRow(), preferences: [] }))],
    ['basic_info.schemaVersion', fp('basic_info', basicInfoSyncView(basicInfoRow())),
      fp('basic_info', basicInfoSyncView({ ...basicInfoRow(), schemaVersion: '2' }))],
    ['activity.payload', fp('activity', activitySyncView(activityRow())),
      fp('activity', activitySyncView({ ...activityRow(), payload: { club: [] } }))],
    ['diagnosis.payload', fp('diagnosis', diagnosisSyncView(diagnosisRow())),
      fp('diagnosis', diagnosisSyncView({ ...diagnosisRow(), payload: { typeHint: 'Y' } }))],
    ['essay.localWorkspaceId', fp('essay', essaySyncView(essayRow())),
      fp('essay', essaySyncView(essayRow({ localWorkspaceId: 'ws-2' })))],
    ['essay.reviewCount（cap 済みで reviews から復元できない）',
      fp('essay', essaySyncView(essayRow())),
      fp('essay', essaySyncView(essayRow({ reviewCount: 12 })))],
    ['essay.review の内容', fp('essay', essaySyncView(essayRow())),
      fp('essay', essaySyncView(essayRow({
        reviews: [essayReviewRow({ improvement: '別の指摘' }), essayReviewRow({ totalScore: 70, verdict: 'C' })],
      })))],
    ['essay.createdAt（別 instant）', fp('essay', essaySyncView(essayRow())),
      fp('essay', essaySyncView(essayRow({ createdAt: '2026-08-02T00:00:00+00:00' })))],
    ['essay.review.createdAt（jsonb 文字列なので表記差も差分）',
      fp('essay', essaySyncView(essayRow())),
      fp('essay', essaySyncView(essayRow({
        reviews: [essayReviewRow({ createdAt: '2026-08-20T10:00:00+00:00' }), essayReviewRow({ totalScore: 70, verdict: 'C' })],
      })))],
  ];
  const missed = contentDiff.filter(([, a, b]) => a === b).map(([l]) => l);
  check(`A4 content の差を必ず検出（${contentDiff.length} 件）`, missed.length === 0, missed.join(' | '));

  // ★ M3 検出: client(toISOString の Z) と PostgREST(+00:00) が同じ instant なら同じ fingerprint ★
  //   ここを raw 文字列比較にすると、同じ内容でも **永久に不一致**になり Source-Sync が
  //   常に veto へ倒れて機能が無効化される（upstream が実測した失敗モード）。
  const tsZ = fp('self_analysis', selfAnalysisItemView(selfAnalysisRow({
    createdAt: '2026-08-26T09:12:33.123456Z',
  })));
  const tsOffset = fp('self_analysis', selfAnalysisItemView(selfAnalysisRow({
    createdAt: '2026-08-26T09:12:33.123456+00:00',
  })));
  const tsJst = fp('self_analysis', selfAnalysisItemView(selfAnalysisRow({
    createdAt: '2026-08-26T18:12:33.123456+09:00',
  })));
  check('A6 createdAt: Z / +00:00 / +09:00 が同じ instant なら同じ fingerprint',
    tsZ === tsOffset && tsOffset === tsJst,
    `Z=${tsZ.slice(0, 16)} off=${tsOffset.slice(0, 16)} jst=${tsJst.slice(0, 16)}`);
  const tsNaive = fp('self_analysis', selfAnalysisItemView(selfAnalysisRow({
    createdAt: '2026-08-26T09:12:33.123456',
  })));
  check('A6 createdAt: offset 無しは同一視しない（UTC と仮定しない）', tsNaive !== tsOffset);

  // kind が違えば同じ view でも別 fingerprint（mixed-origin の値レベル防御）
  const shared = { payload: null, schemaVersion: '1' };
  check('A4 kind が違えば同じ view でも別 fingerprint',
    fp('activity', shared) !== fp('diagnosis', shared));
}

// ── A5: ordering ──────────────────────────────────────────────────

function orderingSemantics(): void {
  const rowsA = [selfPrRow({ localPrId: 'p1' }), selfPrRow({ localPrId: 'p2' }), selfPrRow({ localPrId: 'p3' })];
  const rowsB = [...rowsA].reverse();
  const viewA = listSyncView(rowsA, selfPrItemView);
  const viewB = listSyncView(rowsB, selfPrItemView);
  const fpA = examSyncObservation({ kind: 'self_pr', source: 'server_mirror', view: viewA }).fingerprint;
  const fpB = examSyncObservation({ kind: 'self_pr', source: 'server_mirror', view: viewB }).fingerprint;
  check('A5 multiset: list の順序差を吸収する', fpA === fpB);

  // 件数 / 内容が違えば当然変わる
  const fpShort = examSyncObservation({
    kind: 'self_pr', source: 'server_mirror', view: listSyncView(rowsA.slice(0, 2), selfPrItemView),
  }).fingerprint;
  check('A5 multiset: 件数が違えば別 fingerprint', fpA !== fpShort);
  const fpChanged = examSyncObservation({
    kind: 'self_pr',
    source: 'server_mirror',
    view: listSyncView([selfPrRow({ localPrId: 'p1' }), selfPrRow({ localPrId: 'p2' }), selfPrRow({ localPrId: 'p9' })], selfPrItemView),
  }).fingerprint;
  check('A5 multiset: 1 件の内容差を検出', fpA !== fpChanged);

  // 重複要素は畳み込まれない（multiset であって set ではない）
  const dupOne = listSyncView([selfPrRow({ localPrId: 'p1' })], selfPrItemView);
  const dupTwo = listSyncView([selfPrRow({ localPrId: 'p1' }), selfPrRow({ localPrId: 'p1' })], selfPrItemView);
  check('A5 multiset: 同一 item の重複を畳み込まない',
    examSyncObservation({ kind: 'self_pr', source: 'server_mirror', view: dupOne }).fingerprint !==
      examSyncObservation({ kind: 'self_pr', source: 'server_mirror', view: dupTwo }).fingerprint);

  // ★ item 内部の配列は sequence（jsonb が verbatim で往復する）★
  const seqA = selfAnalysisItemView(selfAnalysisRow({ answers: ['A1', 'A2'] }));
  const seqB = selfAnalysisItemView(selfAnalysisRow({ answers: ['A2', 'A1'] }));
  check('A5 sequence: item 内部の配列は順序変更を検出する',
    syncFingerprint(seqA) !== syncFingerprint(seqB));
  const prefA = basicInfoSyncView(basicInfoRow());
  const prefB = basicInfoSyncView({ ...basicInfoRow(), preferences: [...basicInfoRow().preferences].reverse() });
  check('A5 sequence: basic_info.preferences も順序変更を検出する',
    syncFingerprint(prefA) !== syncFingerprint(prefB));

  // ★ essay の reviews は sequence（mapEssayRow が位置で反転するだけなので往復する）★
  const revA = essaySyncView(essayRow());
  const revB = essaySyncView(essayRow({ reviews: [...essayRow().reviews].reverse() }));
  check('A5 sequence: essay.reviews の順序変更を検出する',
    syncFingerprint(revA) !== syncFingerprint(revB));

  // essay の kind 単位 list は他 history kind と同じ multiset
  const wsA = listSyncView([essayRow({ localWorkspaceId: 'w1' }), essayRow({ localWorkspaceId: 'w2' })], essaySyncView);
  const wsB = listSyncView([essayRow({ localWorkspaceId: 'w2' }), essayRow({ localWorkspaceId: 'w1' })], essaySyncView);
  check('A5 multiset: essay の workspace list 順序を吸収する',
    syncFingerprint(wsA) === syncFingerprint(wsB));

  // sortSyncItems 自体の決定性
  const items = [{ b: 2 }, { a: 1 }, { c: 3 }];
  eq('sortSyncItems は決定的', sortSyncItems(items), sortSyncItems([...items].reverse()));
}

// ── A6: JSON 往復と timezone ──────────────────────────────────────

/** JSON で表現できない値。Date 構築を trap 区間の外で行うため module scope に置く。 */
let NON_JSON_FIXTURE: unknown = null;

function normalizationSemantics(): void {
  // undefined の扱い（generic core は区別する / adapter が JSON 往復へ寄せる）
  eq('undefined property を落とす', normalizeSyncJson({ a: 1, b: undefined }), { a: 1 });
  check('{a:undefined} と {} が同じ fingerprint になる（adapter 正規化）',
    syncFingerprint({ a: undefined }) === syncFingerprint({}));
  check('null は落とさない（null と欠損は別）',
    syncFingerprint({ a: null }) !== syncFingerprint({}));
  eq('配列内の undefined は null', normalizeSyncJson([1, undefined, 3]), [1, null, 3]);
  eq('NaN / Infinity は null', normalizeSyncJson({ a: Number.NaN, b: Number.POSITIVE_INFINITY }),
    { a: null, b: null });
  eq('深い階層でも undefined を落とす',
    normalizeSyncJson({ a: { b: { c: undefined, d: 1 } } }), { a: { b: { d: 1 } } });
  // 表現できない値はそのまま通し、fingerprint 側で fail-closed に throw させる
  // （fixture は非決定性 trap の外で作る）
  let threw = false;
  try {
    syncFingerprint({ at: NON_JSON_FIXTURE });
  } catch {
    threw = true;
  }
  check('表現できない値は fail-closed で throw（黙って落とさない）', threw);

  // A6 timezone
  const z = normalizeSyncTimestamp('2026-08-26T09:12:33.123456Z');
  const off = normalizeSyncTimestamp('2026-08-26T18:12:33.123456+09:00');
  const pg = normalizeSyncTimestamp('2026-08-26T09:12:33.123456+00:00');
  eq('A6 Z / +09:00 / +00:00 が同一 instant へ正規化される', [z, off], [pg, pg]);
  check('A6 正規化結果が tag 付きである',
    typeof z === 'object' && z !== null && '__examTs' in (z as Record<string, unknown>));

  // ★ offset を持たない値は UTC と仮定しない ★
  const naive = normalizeSyncTimestamp('2026-08-26T09:12:33.123456');
  eq('A6 offset 無しは文字列のまま（UTC 化しない）', naive, '2026-08-26T09:12:33.123456');
  check('A6 offset 無しと offset 付きは一致しない（fail-closed）',
    syncFingerprint(naive) !== syncFingerprint(pg));

  // 日時でない文字列 / null
  eq('A6 日時でない文字列は触らない', normalizeSyncTimestamp('2026-07'), '2026-07');
  eq('A6 null は null', normalizeSyncTimestamp(null), null);
  eq('A6 実在しない日付は文字列のまま', normalizeSyncTimestamp('2026-02-30T00:00:00Z'),
    '2026-02-30T00:00:00Z');

  // ★ essay: timestamptz column は正規化し、jsonb 内の createdAt は触らない ★
  const essayZ = syncFingerprint(essaySyncView(essayRow({ createdAt: '2026-08-01T00:00:00Z' })));
  const essayOffset = syncFingerprint(essaySyncView(essayRow({ createdAt: '2026-08-01T00:00:00+00:00' })));
  check('A6 essay.createdAt（timestamptz column）は表記差を吸収する', essayZ === essayOffset);

  // jsonb 内の文字列は触らない（deep scan していないことの確認）
  const inside = normalizeSyncJson({ payload: { note: '2026-08-26T09:12:33+00:00' } }) as {
    payload: { note: unknown };
  };
  eq('A6 jsonb 内のユーザー文字列は正規化しない', inside.payload.note,
    '2026-08-26T09:12:33+00:00');

  // key 順は generic core が吸収する（jsonb は key 順を保持しない）
  check('jsonb の key 順差を吸収する',
    syncFingerprint({ payload: { a: 1, b: 2 } }) === syncFingerprint({ payload: { b: 2, a: 1 } }));
}

// ── A8 / A10: Wave 1 primitives への接続 ──────────────────────────

function verificationCompatibility(): void {
  const serverView = listSyncView([selfPrRow()], selfPrItemView);
  const serverObs = examSyncObservation({ kind: 'self_pr', source: 'server_mirror', view: serverView });
  const deviceObs = examSyncObservation({ kind: 'self_pr', source: 'device_canonical', view: serverView });
  const deviceOther = examSyncObservation({
    kind: 'self_pr',
    source: 'device_canonical',
    view: listSyncView([selfPrRow({ body: '別本文' })], selfPrItemView),
  });

  // A8 mixed-origin
  check('A8 source identity が observation に載る',
    serverObs.source === 'server_mirror' && deviceObs.source === 'device_canonical');
  check('A8 同じ view なら source が違っても fingerprint は等しい（比較可能である）',
    serverObs.fingerprint === deviceObs.fingerprint);

  let originThrew = false;
  try {
    serverMirrorCandidate({ status: 'ok', observation: deviceObs });
  } catch (error) {
    originThrew = error instanceof ExamSyncOriginError;
  }
  check('A8 device observation を server candidate として渡すと throw', originThrew);

  let originThrew2 = false;
  try {
    deviceCanonicalCandidate({ claimPresented: true, observation: serverObs });
  } catch (error) {
    originThrew2 = error instanceof ExamSyncOriginError;
  }
  check('A8 server observation を device claim として渡すと throw', originThrew2);

  // A10 read status → candidate（E-S2 の優先順位 / E-S8）
  const nonOk: readonly ExamSourceReadStatus[] = ['truncated', 'error', 'skipped'];
  for (const status of nonOk) {
    const c = serverMirrorCandidate({ status, observation: serverObs });
    check(`A10 status=${status} は unreadable（E-S8: freshness の権威にしない）`,
      c.state === 'unreadable');
  }
  eq('A10 status=ok / データ無しは empty',
    serverMirrorCandidate({ status: 'ok', observation: null }).state, 'empty');
  eq('A10 status=ok / データ有りは present',
    serverMirrorCandidate({ status: 'ok', observation: serverObs }).state, 'present');
  eq('A10 claim 未提示は unclaimed',
    deviceCanonicalCandidate({ claimPresented: false, observation: null }).state, 'unclaimed');
  eq('A10 claim 提示 / device が空は empty',
    deviceCanonicalCandidate({ claimPresented: true, observation: null }).state, 'empty');

  // Wave 1 verification との接続
  // origin 違反で throw した場合も summary を出せるように包む
  //   （M4 mutation は「throw で run が落ちる」だけでなく、明示 assertion でも落ちる）
  function pairOrNull(canonicalObs: ExamSyncObservation | null, status: ExamSourceReadStatus, mirrorObs: ExamSyncObservation | null) {
    try {
      return verifyExamSourcePair({
        canonical: deviceCanonicalCandidate({ claimPresented: true, observation: canonicalObs }),
        mirror: serverMirrorCandidate({ status, observation: mirrorObs }),
      });
    } catch (error) {
      failures.push(`origin 違反により pair を構成できない: ${(error as Error).message}`);
      return null;
    }
  }

  const verified = pairOrNull(deviceObs, 'ok', serverObs);
  check('内容一致 → verified / fingerprint（pair が構成できる）', verified !== null);
  if (verified === null) return;
  check('内容一致 → verified / fingerprint',
    verified.status === 'verified' && verified.agreement === 'fingerprint');

  const mismatch = verifyExamSourcePair({
    canonical: deviceCanonicalCandidate({ claimPresented: true, observation: deviceOther }),
    mirror: serverMirrorCandidate({ status: 'ok', observation: serverObs }),
  });
  check('内容不一致 → mismatch / fingerprint',
    mismatch.status === 'mismatch' && mismatch.evidence === 'fingerprint');

  const truncated = verifyExamSourcePair({
    canonical: deviceCanonicalCandidate({ claimPresented: true, observation: deviceObs }),
    mirror: serverMirrorCandidate({ status: 'truncated', observation: serverObs }),
  });
  check('truncated → unreadable（verified にしない）', truncated.status === 'unreadable');

  const unclaimed = verifyExamSourcePair({
    canonical: deviceCanonicalCandidate({ claimPresented: false, observation: null }),
    mirror: serverMirrorCandidate({ status: 'ok', observation: serverObs }),
  });
  check('claim 無し → unclaimed', unclaimed.status === 'unclaimed');

  const bothEmpty = verifyExamSourcePair({
    canonical: deviceCanonicalCandidate({ claimPresented: true, observation: null }),
    mirror: serverMirrorCandidate({ status: 'ok', observation: null }),
  });
  check('両方空 → verified / both_empty',
    bothEmpty.status === 'verified' && bothEmpty.agreement === 'both_empty');

  // ★ revision が absent なので Canon §12/§13 の tension（内容一致 + revision 相違）は発火しない
  check('A7 observation の revision は absent',
    serverObs.revision.form === 'absent' && deviceObs.revision.form === 'absent');
  check('A7 revision 由来の mismatch が発生しない',
    verified.signals.revision === 'unknown');

  // ★ Wave 1 の 5 status 空間と E-S2 の 4 verdict 空間の整合 ★
  //   Wave 1 の verification は判定材料が足りないとき `incomparable` を返すが、
  //   E-S2 が列挙する verdict は unreadable / unclaimed / mismatch / verified の 4 つである。
  //   adapter 経路では present candidate の fingerprint が必ず非 null になるため、
  //   `incomparable` は **構造的に発生しない**。ここを実測で固定しておく
  //   （Canon 側の ruling が出るまで Wave 1 の実装は変更しない）。
  const statuses: readonly ExamSourceReadStatus[] = ['ok', 'truncated', 'error', 'skipped'];
  const deviceOptions: Array<[boolean, ExamSyncObservation | null]> = [
    [false, null],
    [true, null],
    [true, deviceObs],
    [true, deviceOther],
  ];
  const mirrorOptions: Array<ExamSyncObservation | null> = [null, serverObs, deviceOther === null ? null : examSyncObservation({
    kind: 'self_pr',
    source: 'server_mirror',
    view: listSyncView([selfPrRow({ body: '別本文' })], selfPrItemView),
  })];
  const produced = new Set<string>();
  let combos = 0;
  for (const status of statuses) {
    for (const [claimPresented, obs] of deviceOptions) {
      for (const mirrorObs of mirrorOptions) {
        combos += 1;
        const r = verifyExamSourcePair({
          canonical: deviceCanonicalCandidate({ claimPresented, observation: obs }),
          mirror: serverMirrorCandidate({ status, observation: mirrorObs }),
        });
        produced.add(r.status);
      }
    }
  }
  check(`adapter 経路で incomparable が発生しない（${combos} 組を全探索）`,
    !produced.has('incomparable'), [...produced].join(', '));
  check('adapter 経路が E-S2 の 4 verdict 空間に収まる',
    [...produced].every((v) => ['verified', 'mismatch', 'unclaimed', 'unreadable'].includes(v)),
    [...produced].join(', '));

  // ★ Wave 2.5: E-H1 の「200 + 0 行」経路が verified を誤って出さないこと ★
  //   authenticated SELECT policy が無いと mirror は空に見える（Canon §40 の UNREADABLE が
  //   EMPTY に化ける）。その状態で device に中身があれば mismatch へ倒れることを固定する。
  const policyMissingLike = verifyExamSourcePair({
    canonical: deviceCanonicalCandidate({ claimPresented: true, observation: deviceObs }),
    mirror: serverMirrorCandidate({ status: 'ok', observation: null }),
  });
  check('E-H1: mirror が空に見えても device に中身があれば mismatch（verified にしない）',
    policyMissingLike.status === 'mismatch' && policyMissingLike.evidence === 'presence');

  // ★ Wave 2.5: purpose gate（E-S28）で denied になった kind は unreadable へ倒れる ★
  //   （そもそも denied kind に verdict を求めないのが正しいが、求めても verified にはならない）
  eq('E-S28: denied（skipped）は unreadable へ倒れる',
    serverMirrorCandidate({ status: 'skipped', observation: serverObs }).state, 'unreadable');
  const denied = verifyExamSourcePair({
    canonical: deviceCanonicalCandidate({ claimPresented: true, observation: deviceObs }),
    mirror: serverMirrorCandidate({ status: 'skipped', observation: null }),
  });
  check('E-S28: denied kind は verified にならない', denied.status === 'unreadable');

  // stale mirror シナリオ（device が更新済み / mirror が古い）
  const stale = verifyExamSourcePair({
    canonical: deviceCanonicalCandidate({
      claimPresented: true,
      observation: examSyncObservation({
        kind: 'self_pr',
        source: 'device_canonical',
        view: listSyncView([selfPrRow({ body: '更新後' })], selfPrItemView),
      }),
    }),
    mirror: serverMirrorCandidate({ status: 'ok', observation: serverObs }),
  });
  check('stale mirror を mismatch として検出する', stale.status === 'mismatch');

  // 逆向き（mirror にだけ行がある = device で削除済み）
  const deleted = verifyExamSourcePair({
    canonical: deviceCanonicalCandidate({ claimPresented: true, observation: null }),
    mirror: serverMirrorCandidate({ status: 'ok', observation: serverObs }),
  });
  check('device で削除済み / mirror に残存を mismatch として検出する',
    deleted.status === 'mismatch' && deleted.evidence === 'presence');
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
  console.log('[exam-spine-sync-adapters] Stage 4 Wave 2 sync adapter contract check（Wave 2.5 convergence 反映）');
  console.log(
    `[exam-spine-sync-adapters] view=${EXAM_SYNC_VIEW_VERSION} normalize=${EXAM_SYNC_NORMALIZE_VERSION} supported=${EXAM_SYNC_SUPPORTED_KINDS.length}/${EXAM_SOURCE_KINDS.length}`,
  );

  NON_JSON_FIXTURE = new Date(0);

  staticBoundaries();
  registryContract();

  const nondet = withNondeterminismTrap(() => {
    contractFreeze();
    semanticEquality();
    orderingSemantics();
    normalizationSemantics();
    verificationCompatibility();
  });

  check(`clock 呼び出し = 0（実測 ${nondet.dateCalls}）`, nondet.dateCalls === 0);
  check(`random 呼び出し = 0（実測 ${nondet.randomCalls}）`, nondet.randomCalls === 0);

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-sync-adapters] FAIL: 外部通信が ${fetchCallCount} 回発生しました`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[exam-spine-sync-adapters] network calls = ${fetchCallCount}（実 Supabase / AI 呼び出しゼロ）`);
  console.log(`[exam-spine-sync-adapters] clock calls   = ${nondet.dateCalls}`);
  console.log(`[exam-spine-sync-adapters] random calls  = ${nondet.randomCalls}`);
  console.log(`[exam-spine-sync-adapters] AI SDK loaded = ${aiSdkLoaded() ? 'YES' : 'NO'}`);
  if (aiSdkLoaded()) {
    console.error('[exam-spine-sync-adapters] FAIL: AI SDK が module graph に載っています');
    process.exitCode = 1;
    return;
  }

  console.log(`[exam-spine-sync-adapters] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`\n[exam-spine-sync-adapters] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 25)) console.error(`  - ${f}`);
    if (failures.length > 25) console.error(`  … 他 ${failures.length - 25} 件`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-sync-adapters] PASS');
}

main();
