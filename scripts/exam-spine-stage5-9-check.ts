// Exam Spine — Stage 5.9 presentation canonical Tutor block（G4）。
//
// ★ presentation は class 2 = server_authoritative（E-S3 / LOCKED）★
//   Source-Sync を **増やさない** Stage である。device claim / fingerprint /
//   verified を作っていないことを §1 で明示的に検査する。
//
// ★ 3 つを混ぜない ★
//   authority（どこが正本か）/ semantics（legacy が prompt に出している値を
//   canonical が再現できるか）/ block（block が正しく建つか）は別問題。
//
// ★ 本 Stage で成立してはいけないこと ★
//   canonical block が production の tutor prompt へ到達すること。§7 で検査する。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let fetchCallCount = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
  fetchCallCount += 1;
  throw new Error(`[stage5.9] 外部通信: ${String(args[0])}`);
}) as typeof realFetch;

import {
  projectTutorPresentationContext,
  renderTutorPresentationLines,
  TUTOR_PRESENTATION_LIMITS,
  PRESENTATION_CATEGORY_ORDER,
  PRESENTATION_CATEGORY_LABELS,
  PRESENTATION_LEVEL_LABELS,
  type TutorPresentationContext,
} from '@/lib/contextBuilders/tutorPresentationSection';
import {
  projectPresentationContext,
  projectPresentationResultSummary,
} from '@/lib/examSpine/context/presentationProjection';
import { buildCanonicalExamContext } from '@/lib/examSpine/context/assemble.server';
import { compareTutorShadow } from '@/lib/examSpine/context/shadow/compareTutor';
import { buildTutorDeviceClaimEntries } from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import {
  EXAM_SYNC_ADAPTER_CONTRACTS,
  EXAM_SYNC_SUPPORTED_KINDS,
  EXAM_SYNC_RUNTIME_ENABLE_BLOCKED,
  isExamSyncSupportedKind,
} from '@/lib/examSpine/sync/adapters/registry';
import {
  examSyncUsability,
  isExamSyncRuntimeBlocked,
} from '@/lib/examSpine/sync/enable';
import { EXAM_CONTEXT_BLOCK_REGISTRY } from '@/lib/examSpine/blocks/registry';
import { EXAM_CONTEXT_BLOCK_IDS } from '@/lib/examSpine/blocks/types';
import { getExamPurposePlan } from '@/lib/examSpine/orchestrator/plan';
import { sourcesForPurpose } from '@/lib/examSpine/purpose';
import { EXAM_READ_CAPS, isExamCappedSourceKind } from '@/lib/examSpine/read/types';
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

/**
 * DECISIONS.md から 1 つの decision 本文を **次の見出しまで**で切り出す。
 *
 * ★ 固定長 slice を使わない（S5-P9 / S5-P11 で 2 度踏んだ defect）★
 *   `slice(i, i + N)` は本文長に依存して「途中で切れる」か「隣へ食い込む」かの
 *   どちらかになり、どちらも検査を無意味にする。境界は文書構造で決める。
 * `## E-S3` が `## E-S30` に前方一致しないよう、見出し語の直後を厳密に見る。
 */
function decisionBody(doc: string, id: string): string | null {
  const re = new RegExp(`^## ${id}(?=[^0-9])`, 'm');
  const m = re.exec(doc);
  if (!m) return null;
  const start = m.index;
  // ★ 「次の `## `」では区切らない ★
  //   decision 本文は `## Level 分類（S5-P9 で明文化）` のような **同レベルの
  //   小見出し**を持つ。素朴に次の `## ` で切ると本文の後半（Level 表や Decision 行）
  //   を丸ごと取り落とし、「書いてあるのに無い」と誤判定する。
  //   境界は **次の decision 見出し**（E-S / E-P / E-H + 数字）で決める。
  const nextRe = /^## E-[SPH][0-9]+(?=[^0-9])/m;
  const rest = doc.slice(start + 1);
  const n = nextRe.exec(rest);
  return n ? doc.slice(start, start + 1 + n.index) : doc.slice(start);
}

/** registry を sourceKind で引く（block id の前方一致で kind を推定しない）。 */
const REG = EXAM_CONTEXT_BLOCK_REGISTRY as Record<string, { sourceKind?: string }>;
function blockIdsForKind(kind: string): string[] {
  return (EXAM_CONTEXT_BLOCK_IDS as readonly string[]).filter(
    (id) => REG[id]?.sourceKind === kind,
  );
}

const CAP = EXAM_READ_CAPS.presentation;
const BLOCK = 'presentation_result_summary';
// prompt へ絶対に出てはいけない生成物。
const SECRET = 'RAW_TRANSCRIPT_SECRET_TEXT';

// ── fixture ──────────────────────────────────────────────────────
type Fb = {
  overallComment?: unknown;
  goodPoints?: unknown;
  improvements?: unknown;
  nextPractice?: unknown;
  categories?: unknown;
};

function feedback(over: Fb = {}): Record<string, unknown> {
  return {
    overallComment: '構成は明確で聞き取りやすい発表でした。',
    goodPoints: ['結論が先に来ている', '具体例が入っている'],
    improvements: ['時間配分がやや後半に偏る'],
    nextPractice: ['1分短く話す練習'],
    categories: { composition: 'strong', clarity: 'normal', timeManagement: 'weak' },
    ...over,
  };
}

function resultRow(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `pres-${String(n).padStart(2, '0')}`,
    user_id: USER_A,
    attempt_id: `att-${String(n).padStart(2, '0')}`,
    feedback: feedback(),
    // ★ 派生コピー column。legacy は使わない。意図的に別値を入れて取り違えを検出する。
    categories: { composition: 'weak', clarity: 'weak', timeManagement: 'strong' },
    qa_summary: null,
    final_report: null,
    created_at: `2026-05-${String(n).padStart(2, '0')}T03:00:00.000Z`,
    ...over,
  };
}

function attemptRow(n: number): Record<string, unknown> {
  return {
    id: `att-${String(n).padStart(2, '0')}`,
    user_id: USER_A,
    session_id: `psess-${String(n).padStart(2, '0')}`,
    attempt_index: n,
    duration_sec: 180,
    status: 'evaluated',
    created_at: `2026-05-${String(n).padStart(2, '0')}T03:00:00.000Z`,
  };
}

function sessionRow(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `psess-${String(n).padStart(2, '0')}`,
    user_id: USER_A,
    university_name: 'サンプル大学',
    faculty_name: 'サンプル学部',
    department_name: 'サンプル学科',
    admission_type: '総合型選抜',
    presentation_format: 'スライドあり',
    theme: `発表テーマ${n}`,
    university_notes: '面接重視',
    created_at: `2026-05-${String(n).padStart(2, '0')}T03:00:00.000Z`,
    ...over,
  };
}

/**
 * legacy（Supabase 層）が作る値を再現する。
 * `loadPresentationContext` は `created_at DESC` / LIMIT 1 で 1 行採り、
 * その attempt → session を enrichment する。
 */
function legacyContextOf(
  results: readonly Record<string, unknown>[],
  sessions: readonly Record<string, unknown>[],
  attempts: readonly Record<string, unknown>[],
): TutorPresentationContext | null {
  const latest = [...results].sort((a, b) =>
    String(a.created_at) < String(b.created_at) ? 1 : -1)[0];
  if (!latest) return null;
  const att = attempts.find((a) => a.id === latest.attempt_id);
  const sess = att ? sessions.find((s) => s.id === att.session_id) : undefined;
  return projectTutorPresentationContext({
    feedback: latest.feedback,
    createdAt: latest.created_at,
    universityName: sess?.university_name,
    facultyName: sess?.faculty_name,
    theme: sess?.theme,
  });
}

function legacySummaryOf(
  results: readonly Record<string, unknown>[],
  sessions: readonly Record<string, unknown>[],
  attempts: readonly Record<string, unknown>[],
): string | null {
  const lines = renderTutorPresentationLines(legacyContextOf(results, sessions, attempts));
  return lines.length > 0 ? lines.join('\n') : null;
}

/** trace のうち presentation kind の query だけ数える（context は 9 kind 分読む）。 */
function presentationTraces(rec: { trace: readonly { kind: string }[] }): number {
  return rec.trace.filter((t) => t.kind === 'presentation').length;
}

/** 有効な日付で n 番目の created_at を作る（日 50 のような不正値を避ける）。 */
function isoOf(n: number): string {
  return new Date(Date.UTC(2026, 0, n, 3, 0, 0)).toISOString();
}

const authorizeA = async (): Promise<ExamRequestAuthorization> => ({ ok: true, userId: USER_A });

async function run(opts: {
  results?: readonly Record<string, unknown>[];
  attempts?: readonly Record<string, unknown>[];
  sessions?: readonly Record<string, unknown>[];
  errors?: Record<string, { code: string; message: string }>;
  purpose?: 'tutor' | 'essay_chat';
}) {
  const database = {
    tables: {
      presentation_results: [...(opts.results ?? [])],
      presentation_attempts: [...(opts.attempts ?? [])],
      presentation_sessions: [...(opts.sessions ?? [])],
    },
  } as FakeDb;
  if (opts.errors) (database as FakeDb).errors = opts.errors;
  const recorder = createRecordingExecutor(database);
  const r = await buildCanonicalExamContext({
    request: new Request('https://example.test/s59/' + Math.random().toString(36).slice(2)),
    purpose: opts.purpose ?? 'tutor',
    authorize: authorizeA,
    bridge: {},
    executor: recorder.executor,
    projectionNow: '2026-01-01T00:00:00.000Z',
  });
  if (!r.ok) throw new Error('veto: ' + r.veto.reasons.join(','));
  return {
    ctx: r.context, rec: recorder, resolved: r.shadowResolvedInput,
    source: r.context.sources.find((s) => s.kind === 'presentation'),
    block: r.context.blocks.find((b) => b.id === BLOCK),
  };
}

// ══════════════════════════════════════════════════════════════════
// 1. Authority / class 2 / no-claim
// ══════════════════════════════════════════════════════════════════
function s1Authority(): void {
  console.log('\n1. Authority / class 2');

  const c = EXAM_SYNC_ADAPTER_CONTRACTS.presentation;
  eq('A1 presentation は server_authoritative（E-S3）', c.authority, 'server_authoritative');

  // ★ E-S3 が LOCKED であること自体を doc から pin する ★
  //
  // ★ 修正（S5-P11 promotion）★ source 側は `dec.slice(i, i + 500)` という
  //   **固定長 window** で decision 本文を切り出していた。これは S5-P9 が
  //   `src.slice(i, i + 500)` で見つけたのと同じ function/section boundary bleed で、
  //   (a) 本文が 500 字を超えると後半を検査できず、
  //   (b) 500 字が次の decision へ食い込むと **隣の decision の LOCKED** を
  //       自分のものとして読んでしまう。
  //   固定長ではなく **次の見出し（\n## ）まで**で区切る。
  const dec = readFileSync(join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md'), 'utf8');
  const es3 = decisionBody(dec, 'E-S3');
  check('A1 E-S3 が存在する', es3 !== null);
  check('A1 E-S3 は class 2 の decision である',
    (es3 ?? '').startsWith('## E-S3 — class 2 に Source-Sync を適用しない'));
  check('A1 E-S3 は LOCKED', (es3 ?? '').includes('`LOCKED`'));
  check('A1 E-S3 は presentation を class 2 に含む', (es3 ?? '').includes('presentation'));
  // 抽出が隣へ漏れていないことを構造的に確かめる（bleed 検出）。
  check('A1 E-S3 の本文が次の decision を含まない', !(es3 ?? '').includes('## E-S4 '));

  // ★ Source-Sync を増やしていない ★
  const entries = buildTutorDeviceClaimEntries({ name: 'x', grade: '高3' } as never);
  check('A1 presentation は claim entry に載らない',
    !entries.some((e) => e.kind === 'presentation'), entries.map((e) => e.kind).join(','));
  const claimSrc = readFileSync(join(ROOT, 'lib/examSpine/sync/claim/deviceBasicInfo.ts'), 'utf8');
  check('A1 devicePresentationToken を作っていない', !claimSrc.includes('devicePresentationToken'));
  const deviceSrc = readFileSync(join(ROOT, 'lib/examSpine/sync/adapters/deviceViews.ts'), 'utf8');
  check('A1 device presentation view を作っていない', !deviceSrc.includes('devicePresentationView'));
  const projSrc = readFileSync(join(ROOT, 'lib/examSpine/context/presentationProjection.ts'), 'utf8');
  check('A1 projection は localStorage を読まない',
    !projSrc.includes('localStorage') && !projSrc.includes('safeGetStorage'));
  check('A1 projection は fetch / supabase を持たない',
    !projSrc.includes('fetch(') && !projSrc.includes('.from('));

  // ★ 「docs が class 2 と言っている」で終わらせない（S5-P11 / §9）★
  //   presentation が Source-Sync pipeline に **構造的に入れない** ことを
  //   実コードの registry / gate から証明する。
  check('A2 presentation は EXAM_SYNC_SUPPORTED_KINDS に無い',
    !(EXAM_SYNC_SUPPORTED_KINDS as readonly string[]).includes('presentation'));
  eq('A2 isExamSyncSupportedKind(presentation) = false',
    isExamSyncSupportedKind('presentation' as never), false);
  // gate を実際に通す。class 1 の理由（canary / not_verified）ではなく
  // **kind そのものが対象外**という理由で veto されることまで固定する。
  const usable = examSyncUsability({
    kind: 'presentation' as never,
    verdict: { status: 'verified' } as never,
    canaryAllowed: true,
  });
  eq('A2 presentation は canary 許可 + verified でも veto', usable.usability, 'veto');
  eq('A2 veto 理由は kind_not_syncable（canary/verify 以前の構造的除外）',
    usable.reason, 'kind_not_syncable');
  eq('A2 presentation は runtime blocker で止めているのではない（class 1 の仕組みを流用しない）',
    isExamSyncRuntimeBlocked('presentation' as never), false);
  eq('A2 adapter contract の capability は not_applicable', c.capability, 'not_applicable');
  eq('A2 revision は absent', c.revision.form, 'absent');
  eq('A2 contentFields は空（比較する device 値が無い）', c.contentFields, []);

  // purpose
  check('A1 tutor は presentation を許可', sourcesForPurpose('tutor').includes('presentation'));
  check('A1 essay_chat は presentation を許可しない',
    !sourcesForPurpose('essay_chat').includes('presentation'));
  check('A1 statement_review は presentation を許可しない',
    !sourcesForPurpose('statement_review').includes('presentation'));
}

// ══════════════════════════════════════════════════════════════════
// 2. Canonical query / window / boundedness / privacy
// ══════════════════════════════════════════════════════════════════
function s2Query(): void {
  console.log('\n2. Canonical query');

  const core = Q.presentationCoreQuery('00000000-0000-4000-8000-000000000000');
  eq('Q1 core table', core.table, 'presentation_results');
  eq('Q1 ordering', core.order.map((o) => `${o.column}:${o.ascending ? 'asc' : 'desc'}`),
    ['created_at:desc', 'id:desc']);
  eq('Q1 limit は cap+1', core.limit, CAP + 1);
  eq('Q1 cap は 3（既存値。発明しない）', CAP, 3);
  eq('Q1 capped kind', isExamCappedSourceKind('presentation'), true);
  check('Q1 feedback を読む（legacy と同じ材料）', core.columns.includes('feedback'));

  const att = Q.presentationAttemptsQuery('u', ['a']);
  check('Q2 attempt は transcript を読まない', !att.columns.includes('transcript'));
  check('Q2 attempt は storage_path を読まない', !att.columns.includes('storage_path'));
  const sess = Q.presentationSessionsQuery('u', ['s']);
  check('Q2 session は script を読まない', !sess.columns.includes('script'));
  check('Q2 session は material_path を読まない', !sess.columns.includes('material_path'));
  check('Q2 session は legacy が使う 3 列を読む',
    sess.columns.includes('university_name') && sess.columns.includes('faculty_name')
    && sess.columns.includes('theme'));

  // legacy 側の read も同じ table / 同じ順序であることを実ソースから pin する。
  const legacy = readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8');
  check('Q3 legacy も presentation_results を読む', legacy.includes(".from('presentation_results')"));
  check('Q3 legacy も created_at DESC', legacy.includes("order('created_at', { ascending: false })"));
  check('Q3 legacy は最新 1 件', /\.limit\(1\); \/\/ 最新 1 件/.test(legacy));
  check('Q3 legacy の enrichment も attempts → sessions',
    legacy.includes(".from('presentation_attempts')")
    && legacy.includes('presentation_sessions(university_name, faculty_name, theme)'));
}

// ══════════════════════════════════════════════════════════════════
// 3. Projection（正本の共有 / feedback.categories authority）
// ══════════════════════════════════════════════════════════════════
function s3Projection(): void {
  console.log('\n3. Projection');

  // ★ 定数の正本が 1 つであること ★
  const legacy = readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8');
  check('P1 tutorContext に presentation 定数が残っていない',
    !legacy.includes('MAX_PRESENTATION_GOOD') && !legacy.includes('PRESENTATION_CATEGORY_ORDER')
    && !legacy.includes('PRESENTATION_LEVEL_LABELS'));
  check('P1 tutorContext は共有 projector を使う',
    legacy.includes('projectTutorPresentationContext') && legacy.includes('renderTutorPresentationLines'));
  const canonical = readFileSync(join(ROOT, 'lib/examSpine/context/presentationProjection.ts'), 'utf8');
  check('P1 canonical も同じ正本を import する',
    canonical.includes("from '@/lib/contextBuilders/tutorPresentationSection'"));
  check('P1 canonical は件数定数を書き写していない',
    !canonical.includes('slice(0, 3)') && !canonical.includes('MAX_PRESENTATION'));

  // ★ 共有語彙（40 / 120）が legacy 側とずれていない ★
  const m1 = /const MAX_ITEM_LENGTH = (\d+);/.exec(legacy);
  const m2 = /const MAX_SUMMARY_LENGTH = (\d+);/.exec(legacy);
  eq('P2 itemLength が tutorContext と一致', TUTOR_PRESENTATION_LIMITS.itemLength, Number(m1?.[1]));
  eq('P2 summaryLength が tutorContext と一致', TUTOR_PRESENTATION_LIMITS.summaryLength, Number(m2?.[1]));

  // ★ categories の authority は feedback.categories（派生 column ではない）★
  const rows = [{ result: {
    id: 'p1', attemptId: 'a1',
    feedback: { overallComment: 'x', categories: { composition: 'strong' } },
    categories: { composition: 'weak' }, qaSummary: null, finalReport: null,
    createdAt: '2026-05-01T03:00:00.000Z',
  }, attempt: null, session: null }] as never;
  const pr = projectPresentationContext(rows);
  eq('P3 categories は feedback.categories 由来', pr?.categories, [{ label: '構成力', level: '良い' }]);
  check('P3 派生 column（weak）を採っていない',
    JSON.stringify(pr?.categories).includes('良い') && !JSON.stringify(pr?.categories).includes('要改善'));

  // カテゴリ順序 / 未知 key の無視
  const all = projectTutorPresentationContext({
    feedback: { overallComment: 'x', categories: {
      materialConsistency: 'strong', composition: 'weak', unknownKey: 'strong', clarity: 'bogus',
    } },
    createdAt: '2026-05-01T03:00:00.000Z',
  });
  eq('P4 ORDER 順に並ぶ（資料整合性は末尾）',
    all?.categories?.map((c) => c.label), ['構成力', '資料整合性']);
  check('P4 未知 key は無視', !JSON.stringify(all?.categories).includes('unknownKey'));
  check('P4 未知 level は無視（clarity は出ない）',
    !JSON.stringify(all?.categories).includes('わかりやすさ'));
  eq('P4 ORDER は 7 件', PRESENTATION_CATEGORY_ORDER.length, 7);
  eq('P4 LABELS は ORDER を覆う',
    PRESENTATION_CATEGORY_ORDER.every((k) => typeof PRESENTATION_CATEGORY_LABELS[k] === 'string'), true);
  eq('P4 LEVEL は 3 値', Object.keys(PRESENTATION_LEVEL_LABELS).sort(), ['normal', 'strong', 'weak']);

  // 件数 / 字数
  const long = 'あ'.repeat(200);
  const capped = projectTutorPresentationContext({
    feedback: feedback({ goodPoints: [long, 'b', 'c', 'd'], improvements: ['1', '2', '3', '4'], nextPractice: ['1', '2', '3'] }),
    createdAt: '2026-05-01T03:00:00.000Z',
  });
  // ★ 定数と自分自身を比べない（S5-P11 negative control N5c）★
  //   `length === TUTOR_PRESENTATION_LIMITS.good` は good を 2 に書き換えても
  //   両辺が同時に動くため **必ず通る**（実測で検出できなかった）。
  //   件数・字数は legacy の値である **リテラル**に対して固定する。
  eq('P5 goodPoints は 3 件（legacy MAX_PRESENTATION_GOOD）', capped?.goodPoints?.length, 3);
  eq('P5 improvements は 3 件（legacy MAX_PRESENTATION_IMPROVE）', capped?.improvements?.length, 3);
  eq('P5 nextPractice は 2 件（legacy MAX_PRESENTATION_NEXT）', capped?.nextPractice?.length, 2);
  eq('P5 1 要素は 40 字で切る（legacy MAX_ITEM_LENGTH）', capped?.goodPoints?.[0].length, 40);
  // 定数表そのものも legacy の値で固定する。
  eq('P5 LIMITS の件数は 3/3/2 のまま',
    [TUTOR_PRESENTATION_LIMITS.good, TUTOR_PRESENTATION_LIMITS.improve, TUTOR_PRESENTATION_LIMITS.next],
    [3, 3, 2]);
  const longOverall = projectTutorPresentationContext({
    feedback: feedback({ overallComment: 'い'.repeat(500) }), createdAt: '2026-05-01T03:00:00.000Z' });
  eq('P5 総合評価は 120 字で切る（legacy MAX_SUMMARY_LENGTH）',
    longOverall?.overall?.length, 120);

  // 二重 truncate が起きない（canonical mapper は shortText=200 で先に切る）
  const uni = 'う'.repeat(300);
  const viaCanonical = projectTutorPresentationContext({
    feedback: feedback(), createdAt: '2026-05-01T03:00:00.000Z',
    universityName: uni.slice(0, 200), // mapper 通過後
  });
  const viaLegacy = projectTutorPresentationContext({
    feedback: feedback(), createdAt: '2026-05-01T03:00:00.000Z', universityName: uni });
  eq('P6 mapper の 200 字先行 truncate は結果を変えない（40 < 200）',
    viaCanonical?.university, viaLegacy?.university);

  // ★ block content の producer を直接押さえる ★
  //   summary は「projection → renderer → 改行連結」以外の何物でもない。
  const summaryRows = [{ result: {
    id: 'p1', attemptId: 'a1', feedback: feedback(),
    categories: {}, qaSummary: null, finalReport: null,
    createdAt: '2026-05-01T03:00:00.000Z',
  }, attempt: null, session: null }] as never;
  eq('P7 summary は renderer の出力と一致',
    projectPresentationResultSummary(summaryRows),
    renderTutorPresentationLines(projectPresentationContext(summaryRows)).join('\n'));
  eq('P7 材料が無ければ null（空文字を返さない）',
    projectPresentationResultSummary([] as never), null);
  eq('P7 rows が null でも null', projectPresentationResultSummary(null), null);
}

// ══════════════════════════════════════════════════════════════════
// 4. Semantic matrix（S1〜S9）
// ══════════════════════════════════════════════════════════════════
async function s4Semantics(): Promise<void> {
  console.log('\n4. Semantic matrix');

  const cmpFor = async (
    results: readonly Record<string, unknown>[],
    sessions: readonly Record<string, unknown>[] = [],
    attempts: readonly Record<string, unknown>[] = [],
    errors?: Record<string, { code: string; message: string }>,
  ) => {
    const r = await run({ results, attempts, sessions, errors });
    const before = r.rec.trace.length;
    const cmp = compareTutorShadow({
      legacy: { presentationResultSummary: legacySummaryOf(results, sessions, attempts) },
      canonicalInput: r.resolved, context: r.ctx,
    });
    return {
      r, cmp, extra: r.rec.trace.length - before,
      diff: cmp.entries.find((e) => e.field === 'presentation.resultSummary'),
      legacy: legacySummaryOf(results, sessions, attempts),
    };
  };

  // S1 — 完了した通常レコード（★ 非空 meaningful MATCH ★）
  const s1 = await cmpFor([resultRow(1)], [sessionRow(1)], [attemptRow(1)]);
  check('S1 legacy が非空', (s1.legacy ?? '').length > 0);
  check('S1 canonical block が非空', (s1.r.block?.content ?? '').length > 0);
  eq('S1 canonical block == legacy', s1.r.block?.content, s1.legacy);
  eq('S1 MATCH', s1.diff?.diff, 'MATCH');
  eq('S1 compare は追加 read を出さない', s1.extra, 0);
  check('S1 大学 / 学部 / テーマが enrichment から入る',
    (s1.legacy ?? '').includes('サンプル大学') && (s1.legacy ?? '').includes('発表テーマ1'));
  check('S1 カテゴリ評価が日本語ラベルで出る',
    (s1.legacy ?? '').includes('構成力=良い') && (s1.legacy ?? '').includes('時間配分=要改善'));

  // S2 — 複数レコード → 最新が選ばれる
  const many = [resultRow(1), resultRow(2), resultRow(3, { feedback: feedback({ overallComment: '最新の総合評価' }) })];
  const s2 = await cmpFor(many, [sessionRow(1), sessionRow(2), sessionRow(3)], [attemptRow(1), attemptRow(2), attemptRow(3)]);
  check('S2 最新（created_at 最大）が選ばれる', (s2.legacy ?? '').includes('最新の総合評価'));
  eq('S2 MATCH', s2.diff?.diff, 'MATCH');
  eq('S2 canonical も同じ最新を選ぶ', s2.r.block?.content, s2.legacy);

  // S3 — enrichment 欠落（session 無し）→ core だけで出す
  const s3 = await cmpFor([resultRow(1)], [], [attemptRow(1)]);
  check('S3 大学名が入らない', !(s3.legacy ?? '').includes('サンプル大学'));
  check('S3 それでも section は出る', (s3.legacy ?? '').includes('直近のプレゼン練習'));
  eq('S3 MATCH', s3.diff?.diff, 'MATCH');

  // S4 — feedback が空 object → 出さない
  const s4 = await cmpFor([resultRow(1, { feedback: {} })], [sessionRow(1)], [attemptRow(1)]);
  eq('S4 legacy は null（代替文言を作らない）', s4.legacy, null);
  eq('S4 canonical block も missing', s4.r.block?.presence, 'missing');
  eq('S4 双方空 → MATCH', s4.diff?.diff, 'MATCH');

  // S5 — レコード無し
  const s5 = await cmpFor([], [], []);
  eq('S5 legacy は null', s5.legacy, null);
  eq('S5 canonical block も missing', s5.r.block?.presence, 'missing');
  eq('S5 MATCH', s5.diff?.diff, 'MATCH');
  eq('S5 core が空なら enrichment query は 0 本（presentation は core の 1 本だけ）',
    presentationTraces(s5.r.rec), 1);

  // S6 — truncation 境界
  const s6 = await cmpFor(
    [resultRow(1, { feedback: feedback({ overallComment: 'ん'.repeat(400), goodPoints: ['か'.repeat(100), 'b', 'c', 'd'] }) })],
    [sessionRow(1, { theme: 'て'.repeat(400) })], [attemptRow(1)]);
  eq('S6 MATCH（境界でも一致）', s6.diff?.diff, 'MATCH');
  check('S6 4 件目 d は出ない', !(s6.legacy ?? '').includes('「d」'));

  // S7 — field priority: feedback.categories と派生 column が食い違う場合
  const s7 = await cmpFor([resultRow(1)], [sessionRow(1)], [attemptRow(1)]);
  check('S7 feedback.categories 側（構成力=良い）を採る', (s7.legacy ?? '').includes('構成力=良い'));
  check('S7 派生 column 側（構成力=要改善）を採らない', !(s7.legacy ?? '').includes('構成力=要改善'));
  eq('S7 MATCH', s7.diff?.diff, 'MATCH');

  // S8 — 新しいが未評価に近いレコード vs 古い完全レコード
  const s8rows = [
    resultRow(9, { feedback: { categories: {} } }),           // 新しいが中身なし
    resultRow(1, { feedback: feedback({ overallComment: '古いが完全' }) }),
  ];
  const s8 = await cmpFor(s8rows, [sessionRow(1), sessionRow(9)], [attemptRow(1), attemptRow(9)]);
  eq('S8 legacy は「最新」を選んだ結果 null になる（古い方へ遡らない）', s8.legacy, null);
  eq('S8 canonical も同じ選択規則', s8.r.block?.presence, 'missing');
  eq('S8 MATCH（選択規則まで一致）', s8.diff?.diff, 'MATCH');

  // S9 — feedback が壊れている / 型違い
  for (const [label, fb] of [['null', null], ['配列', [1, 2]], ['文字列', 'not json']] as const) {
    const s9 = await cmpFor([resultRow(1, { feedback: fb })], [sessionRow(1)], [attemptRow(1)]);
    eq(`S9 feedback=${label} は null（throw しない）`, s9.legacy, null);
    eq(`S9 feedback=${label} MATCH`, s9.diff?.diff, 'MATCH');
  }

  // core query 失敗
  const err = await run({ results: [resultRow(1)], attempts: [attemptRow(1)], sessions: [sessionRow(1)],
    errors: { presentation_results: { code: '42P01', message: 'missing' } } });
  eq('S10 core 失敗時は block を作らない', err.block?.presence, 'missing');
  eq('S10 source は error', err.source?.readStatus, 'error');
}

// ══════════════════════════════════════════════════════════════════
// 5. Block registry / plan
// ══════════════════════════════════════════════════════════════════
function s5Block(): void {
  console.log('\n5. Block');

  check('B1 block id が登録されている',
    (EXAM_CONTEXT_BLOCK_IDS as readonly string[]).includes(BLOCK));
  const meta = EXAM_CONTEXT_BLOCK_REGISTRY[BLOCK as keyof typeof EXAM_CONTEXT_BLOCK_REGISTRY] as {
    sourceKind: string; derivation: string; headingOwner: string; legacySource: string; meaning: string;
  };
  eq('B1 sourceKind は presentation', meta.sourceKind, 'presentation');
  eq('B1 deterministic', meta.derivation, 'deterministic');
  eq('B1 heading は caller 所有（既存 convention）', meta.headingOwner, 'none');
  check('B1 legacySource が共有正本を指す',
    meta.legacySource.includes('tutorPresentationSection'));
  check('B1 meaning が除外物を明示', meta.meaning.includes('transcript') || meta.meaning.includes('STT'));

  // plan: tutor のみ
  const tutor = getExamPurposePlan('tutor');
  check('B2 tutor plan に含まれる',
    tutor?.blocks.some((b) => b.id === BLOCK), tutor?.blocks.map((b) => b.id).join(','));
  for (const p of ['essay_chat', 'statement_review', 'interview_feedback', 'self_pr'] as const) {
    const plan = getExamPurposePlan(p);
    check(`B2 ${p} plan には含まれない`,
      !plan?.blocks.some((b) => b.id === BLOCK));
  }
}

// ══════════════════════════════════════════════════════════════════
// 6. Privacy / boundedness
// ══════════════════════════════════════════════════════════════════
async function s6Privacy(): Promise<void> {
  console.log('\n6. Privacy / boundedness');

  const r = await run({
    results: [resultRow(1, { feedback: { ...feedback(), transcript: SECRET, rawEvaluation: SECRET } })],
    attempts: [{ ...attemptRow(1), transcript: SECRET, storage_path: SECRET }],
    sessions: [{ ...sessionRow(1), script: SECRET, material_path: SECRET }],
  });
  const dump = JSON.stringify(r.ctx);
  check('V1 context 全体に生成物が出ない', !dump.includes(SECRET));
  check('V1 block content に生成物が出ない', !(r.block?.content ?? '').includes(SECRET));
  check('V1 context は userId を持たない', !dump.includes(USER_A));

  // ★ block も query も履歴件数に比例しない ★
  //   最新 1 件が同一になるよう組み、1 件 / 50 件で block content を突き合わせる。
  const latest = resultRow(1, { created_at: isoOf(99) });
  const one = await run({
    results: [latest], attempts: [attemptRow(1)], sessions: [sessionRow(1)] });
  const olderRows = Array.from({ length: 49 }, (_, i) =>
    resultRow(i + 2, { created_at: isoOf(i + 1) }));
  const many = await run({
    results: [latest, ...olderRows],
    attempts: [attemptRow(1), ...olderRows.map((_, i) => attemptRow(i + 2))],
    sessions: [sessionRow(1), ...olderRows.map((_, i) => sessionRow(i + 2))],
  });
  check('V2 1 件でも 50 件でも block は非空', (one.block?.content ?? '').length > 0);
  eq('V2 50 件でも block は最新 1 件ぶん（内容一致）', many.block?.content, one.block?.content);
  eq('V2 presentation の query は core + attempts + sessions = 3 本',
    presentationTraces(many.rec), 3);
  eq('V2 1 件のときも 3 本（件数に比例しない）', presentationTraces(one.rec), 3);

  // shadow の出力は enum と件数のみ
  // ★ 実際の値で走らせる（S5-P11 negative control N7）★
  //   legacy 側にダミー（'x'）を渡していたため、entry に legacy 値を丸ごと
  //   載せる欠陥を注入しても「本文が入らない」検査が通ってしまった。
  //   legacy にも canonical にも **本物の要約行**を渡して漏洩を検出する。
  const realLegacy = one.block?.content ?? '';
  check('V3 前提: legacy 値は非空で識別可能な語を含む',
    realLegacy.includes('サンプル大学') && realLegacy.includes('構成は明確'));
  const cmp = compareTutorShadow({
    legacy: { presentationResultSummary: realLegacy + SECRET },
    canonicalInput: one.resolved, context: one.ctx });
  const entry = cmp.entries.find((e) => e.field === 'presentation.resultSummary');
  const eDump = JSON.stringify(entry);
  for (const leak of ['サンプル大学', '構成は明確', '発表テーマ', SECRET, '良かった点']) {
    check(`V3 comparison entry に \`${leak}\` が入らない`, !eDump.includes(leak), eDump.slice(0, 200));
  }
  // entry が持ってよいのは enum / hash / 件数だけ。値そのものを持つ key を作らない。
  eq('V3 entry の key 集合は固定（値 field を増やしていない）',
    Object.keys(entry ?? {}).sort(),
    ['canonicalChars', 'canonicalFingerprint', 'canonicalOrigin', 'canonicalState',
      'diff', 'field', 'kind', 'legacyChars', 'legacyFingerprint', 'reason', 'syncStatus']);
  check('V3 diff は enum', typeof entry?.diff === 'string');
}

// ══════════════════════════════════════════════════════════════════
// 7. Consumer invariance
// ══════════════════════════════════════════════════════════════════
function s7Consumer(): void {
  console.log('\n7. Consumer invariance');

  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  const iSection = route.indexOf('const studentContext = buildTutorStudentContext(');
  const iGate = route.indexOf('const shadowEnabled = isExamSpineShadowEnabled(');
  const calls: number[] = [];
  for (let i = route.indexOf('buildCanonicalExamContext('); i !== -1;
       i = route.indexOf('buildCanonicalExamContext(', i + 1)) calls.push(i);
  eq('C1 canonical の呼び出しは 1 箇所', calls.length, 1);
  check('C1 呼び出しは shadow gate の後ろ', calls[0] > iGate && iGate > iSection);

  // legacy の prompt 経路は Supabase 層のまま
  const legacy = readFileSync(join(ROOT, 'lib/contextBuilders/tutorContext.ts'), 'utf8');
  check('C2 legacy section は renderTutorPresentationLines を使う',
    legacy.includes('renderTutorPresentationLines(context.presentation)'));
  check('C2 legacy が canonical block を読まない',
    !legacy.includes('EXAM_CONTEXT_BLOCK_REGISTRY') && !legacy.includes('presentationProjection'));
  const prompt = readFileSync(join(ROOT, 'lib/tutor/tutorPrompt.ts'), 'utf8');
  check('C2 prompt builder は canonical block を読まない',
    !prompt.includes('presentation_result_summary'));

  // shadow の結果が出力に影響しない
  check('C3 shadow の出力は enum と件数だけ',
    route.includes('shadowOverall = comparison.overall')
    && route.includes('shadowMismatchCount = comparison.mismatchCount')
    && !/studentContextSection\s*=\s*[^;]*shadow/i.test(route));
  check('C3 presentation block が prompt へ渡らない',
    !route.includes(`blocks['${BLOCK}']`) && !route.includes(`'${BLOCK}'`));

  // ★ prompt anchor は固定 window を使わない（S5-P11 / §32）★
  //   Stage 5.2〜5.8 で 6 回踏んだ defect: `route.indexOf('buildTutorUserPrompt')` は
  //   file 冒頭の見出しコメントにも一致するため、window が file 先頭に張られて
  //   実際の prompt 経路を 1 行も検査できていなかった。
  //   コメント行を除いた実コード上で **呼び出し形**に anchor し、
  //   固定長ではなく prompt 組み立て「以降すべて」を検査する。
  const routeCode = route
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  const promptIdx = routeCode.indexOf('= buildTutorUserPrompt(');
  check('C4 prompt 組み立て位置を特定できる（コメントではなく呼び出し形）', promptIdx !== -1);
  if (promptIdx !== -1) {
    const afterPrompt = routeCode.slice(promptIdx);
    for (const forbidden of [
      'presentationResultSummary', 'presentation_result_summary',
      'renderTutorPresentationLines', 'projectPresentationResultSummary',
      'shadowResolvedInput', 'compareTutorShadow',
    ]) {
      check(`C4 prompt 以降に ${forbidden} が現れない`, !afterPrompt.includes(forbidden));
    }
    check('C4 prompt 以降に canonical block 配列が現れない',
      !/\.context\??\.blocks/.test(afterPrompt));
  }

  // ★ prompt の入力そのものを固定する（S5-P11 negative control N14）★
  //   「禁止語が現れない」検査は形を変えた注入をすり抜ける
  //   （`blocks.map(b=>b.content).join()` を contextString の位置へ渡す等）。
  //   consumer 切替の本質は **prompt の第 1 引数が legacy の contextString か**なので、
  //   呼び出し形を丸ごと固定する。legacy 経路を変えるとここが必ず落ちる。
  const callForm = /=\s*buildTutorUserPrompt\(\{\s*contextString\s*,\s*userMessage:\s*message\s*\}\)/;
  check('C6 prompt は legacy の contextString をそのまま受け取る（加工・置換なし）',
    callForm.test(routeCode),
    routeCode.slice(Math.max(0, promptIdx - 20), promptIdx + 120).replace(/\n/g, ' '));
  // contextString の生成元も legacy の Supabase 層のままであること。
  check('C6 contextString は legacy の section builder から作られる',
    /contextString\s*=/.test(routeCode)
    && route.includes('buildTutorSupabaseContextSection'));
  eq('C6 buildTutorUserPrompt の呼び出しは 1 箇所',
    (routeCode.match(/buildTutorUserPrompt\(/g) ?? []).length, 1);

  // ★ shadow 経路の内側に閉じている ★
  //   presentation の legacy 値を作る行は isExamSpineShadowEnabled gate の内側にあり、
  //   prompt 組み立てより前で閉じていること（位置関係で固定する）。
  const iShadowGate = routeCode.indexOf('isExamSpineShadowEnabled(');
  const iPresLine = routeCode.indexOf('presentationResultSummary');
  check('C5 presentation の legacy 値は shadow gate より後ろで作られる',
    iShadowGate !== -1 && iPresLine > iShadowGate);
  check('C5 presentation の legacy 値は prompt 組み立てより前で閉じている',
    promptIdx !== -1 && iPresLine < promptIdx);
}

// ══════════════════════════════════════════════════════════════════
// 8. 先行 Stage の境界を壊していないこと（S5-P11 / §25 / §26）
// ══════════════════════════════════════════════════════════════════
//
// ★ presentation を足したついでに他 kind の状態を動かさない ★
//   古い consumer/convergence lineage が canonical へ混ざると、S5-P10 で
//   復元した essay の runtime blocker が `{}` へ戻る等の **静かな後退**が起きる。
//   Stage 5.9 の QA でも先行 Stage の不変条件を機械的に pin する。
function s8PriorStages(): void {
  console.log('\n8. 先行 Stage の境界');

  const dec = readFileSync(join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md'), 'utf8');

  // ── essay（E-S52 / E-S53）────────────────────────────────────
  const blocked = EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.essay;
  check('X1 essay の runtime blocker が存在する', typeof blocked === 'string' && blocked.length > 0);
  check('X1 blocker は E-S52 を根拠にする', (blocked ?? '').includes('E-S52'));
  eq('X1 runtime blocker は essay だけ（presentation を足していない）',
    Object.keys(EXAM_SYNC_RUNTIME_ENABLE_BLOCKED).sort(), ['essay']);
  eq('X1 essay は runtime_blocked で veto される',
    examSyncUsability({
      kind: 'essay' as never,
      verdict: { status: 'verified' } as never,
      canaryAllowed: true,
    }).reason, 'runtime_blocked');
  // ★ id の前方一致で判定しない ★
  //   `essay_university_context` は大学 DB の system_metadata block であって
  //   source kind `essay`（essay_workspaces）の block ではない。判定は sourceKind で行う。
  eq('X1 sourceKind=essay の canonical block は作られていない', blockIdsForKind('essay'), []);
  check('X1 essay_university_context は system_metadata であり essay kind ではない',
    (REG.essay_university_context as { sourceKind?: string }).sourceKind === undefined);

  // ── statement_review（E-S49）────────────────────────────────
  // ★ 本文ではなく **見出し行**を見る（S5-P11 negative control N9）★
  //   `body.includes('statement_review')` は見出しを presentation に書き換えても
  //   本文中に語が残るため通ってしまった。decision の同一性は見出しで判定する。
  const es49 = decisionBody(dec, 'E-S49');
  const es49Head = (es49 ?? '').split('\n')[0];
  check('X2 E-S49 の見出しは statement_review のもの（presentation で上書きしていない）',
    es49Head.includes('statement_review'), es49Head);
  check('X2 E-S49 の見出しが presentation を指していない',
    !es49Head.includes('presentation'), es49Head);
  const assemble = readFileSync(join(ROOT, 'lib/examSpine/context/assemble.server.ts'), 'utf8');
  check('X2 legacy 相当 statement_review 射影は shadow 専用 snapshot にだけ載る',
    assemble.includes('projectStatementReviewLegacyLine'));
  const input = readFileSync(join(ROOT, 'lib/examSpine/orchestrator/input.ts'), 'utf8');
  check('X2 ExamContextInput に statement_review の legacy 射影 slot が無い',
    !input.includes('statementReviewLegacyLine'));
  // ★ E-S49 が deferred にしたのは「legacy 相当射影」であって canonical 射影ではない ★
  //   `previous_output_summary`（buildPreviousOutputSummary = 反復論点の集約）は
  //   canonical 側の正式な block として既に存在する。Stage 5.9 はこの集合を変えない。
  eq('X2 statement_review の block は previous_output_summary 1 つのまま',
    blockIdsForKind('statement_review'), ['previous_output_summary']);
  check('X2 statement_review block は tutor plan に載っていない（consumer 未接続）',
    !getExamPurposePlan('tutor').blocks.some((b) => b.id === 'previous_output_summary'));

  // ── interview_record（E-S51）────────────────────────────────
  const es51 = decisionBody(dec, 'E-S51');
  check('X3 E-S51 の見出しは interview_record のもの',
    (es51 ?? '').split('\n')[0].includes('interview_record'), (es51 ?? '').split('\n')[0]);
  check('X3 interview_issue_line block は存在する',
    (EXAM_CONTEXT_BLOCK_IDS as readonly string[]).includes('interview_issue_line'));
  const route = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  check('X3 interview_issue_line は AI-visible ではない',
    !route.includes('interview_issue_line'));

  // ── E-S50 に presentation を捏造していないこと（§10 / Case B）──
  const es50 = decisionBody(dec, 'E-S50');
  check('X4 E-S50 が存在する', es50 !== null);
  check('X4 E-S50 は device window の tie-break 監査である',
    (es50 ?? '').includes('device history window'));
  // presentation は class 2 で claim を持たないため Level A/B/C を持てない。
  check('X4 E-S50 が presentation に Level A/B/C を与えていない',
    !/presentation[^\n]*→\s*\*\*Level [ABC]\*\*/.test(es50 ?? ''));
  check('X4 E-S50 が presentation を N/A として明示している',
    (es50 ?? '').includes('presentation') && (es50 ?? '').includes('N/A'));

  // ── E-S54 が canonical に登録されている（採番衝突の解決）──────
  const es54 = decisionBody(dec, 'E-S54');
  check('X6 E-S54 が存在する', es54 !== null);
  check('X6 E-S54 の見出しは presentation のもの',
    (es54 ?? '').split('\n')[0].includes('presentation'), (es54 ?? '').split('\n')[0]);
  check('X6 E-S54 は LOCKED', (es54 ?? '').includes('`LOCKED`'));
  check('X6 E-S54 は source の E-S49 からの再採番であると記録している',
    (es54 ?? '').includes('E-S49') && (es54 ?? '').includes('再採番'));
  check('X6 E-S54 は class 2 / Source-Sync を増やさないと明記する',
    (es54 ?? '').includes('kind_not_syncable'));
  // canonical の採番は E-S54 が最大（次は E-S55）。
  const ids = [...dec.matchAll(/^## E-S([0-9]+)(?=[^0-9])/gm)].map((m) => Number(m[1]));
  eq('X6 canonical の最大 decision ID は 54', Math.max(...ids), 54);
  eq('X6 decision ID に重複が無い', ids.length, new Set(ids).size);

  // ── consumer 切替をしていない ────────────────────────────────
  const plan = getExamPurposePlan('tutor');
  eq('X5 tutor plan は render / legacyBuilder を持たない（prompt 経路ではない）',
    [plan.render, plan.legacyBuilder], [null, null]);

  // ★ Stage 境界: tutor plan の block 列を完全一致で固定（negative control N13）★
  //   「presentation を足したついでに Stage 5.10 以降の block を混ぜない」。
  //   部分一致（含まれているか）では後続 stage の混入を検出できない。
  eq('X5 tutor plan の block は 5.1/5.2/5.3/5.7/5.9 の 5 つ',
    plan.blocks.map((b) => b.id),
    ['tutor_student_context', 'diagnosis_type_hint', 'activity_category_counts',
      'interview_issue_line', 'presentation_result_summary']);

  // 後続 stage（5.10+ = self_pr）の block は sourceKind 単位で 0 件。
  eq('X5 sourceKind=self_pr の canonical block は作られていない（Stage 5.10 以降）',
    blockIdsForKind('self_pr'), []);
  eq('X5 sourceKind=presentation の block は 1 つだけ',
    blockIdsForKind('presentation'), [BLOCK]);
  eq('X5 sourceKind=interview_record の block は 1 つだけ',
    blockIdsForKind('interview_record'), ['interview_issue_line']);
}

// ══════════════════════════════════════════════════════════════════
// 9. Golden bytes（S5-P11 / §14）
// ══════════════════════════════════════════════════════════════════
//
// ★ なぜ必要か ★
//   §4 の semantic matrix は legacy 相当値と canonical block を突き合わせるが、
//   両者は Stage 5.9 以降 **同じ tutorPresentationSection を共有**している。
//   したがって共有 module 側の書式が変わると **両側が同時に変わり MATCH のまま**
//   通ってしまう。比較だけでは delimiter / label / 連結記号 / 空行の drift を検出できない。
//   ここでは相対比較ではなく **絶対 bytes** を固定する。
//
// ★ 値の出所 ★
//   S5-P11 の pre/post characterization（抽出前の tutorContext.ts に fake supabase
//   client を注入して loadTutorStudentContext → buildTutorSupabaseContextSection を
//   実行）で観測した **抽出前の legacy 出力**である。抽出後の実装から採っていない。
function s9GoldenBytes(): void {
  console.log('\n9. Golden bytes');

  const at = '2026-05-01T03:00:00.000Z';
  const golden: [string, Record<string, unknown>, string[]][] = [
    ['G1 full（日付・大学・学部・テーマ・全項目）',
      { feedback: feedback(), createdAt: at, universityName: 'サンプル大学', facultyName: 'サンプル学部', theme: '発表テーマ1' },
      ['・直近のプレゼン練習（2026/05/01実施・サンプル大学 サンプル学部）の結果が保存されています。',
        '  - 発表テーマ: 発表テーマ1',
        '  - 総合評価: 構成は明確で聞き取りやすい発表でした。',
        '  - カテゴリ評価: 構成力=良い / わかりやすさ=標準 / 時間配分=要改善',
        '  - 良かった点: 「結論が先に来ている」「具体例が入っている」',
        '  - 改善点: 「時間配分がやや後半に偏る」',
        '  - 次に練習すると良い点: 「1分短く話す練習」']],
    ['G2 enrichment 無し（core だけ）',
      { feedback: feedback(), createdAt: at },
      ['・直近のプレゼン練習（2026/05/01実施）の結果が保存されています。',
        '  - 総合評価: 構成は明確で聞き取りやすい発表でした。',
        '  - カテゴリ評価: 構成力=良い / わかりやすさ=標準 / 時間配分=要改善',
        '  - 良かった点: 「結論が先に来ている」「具体例が入っている」',
        '  - 改善点: 「時間配分がやや後半に偏る」',
        '  - 次に練習すると良い点: 「1分短く話す練習」']],
    ['G3 総合評価だけ（空 field は行ごと落ちる）',
      { feedback: { overallComment: 'ひとこと' }, createdAt: at },
      ['・直近のプレゼン練習（2026/05/01実施）の結果が保存されています。',
        '  - 総合評価: ひとこと']],
    ['G4 日付が不正（見出しの括弧ごと落ちる）',
      { feedback: feedback(), createdAt: 'bogus' },
      ['・直近のプレゼン練習の結果が保存されています。',
        '  - 総合評価: 構成は明確で聞き取りやすい発表でした。',
        '  - カテゴリ評価: 構成力=良い / わかりやすさ=標準 / 時間配分=要改善',
        '  - 良かった点: 「結論が先に来ている」「具体例が入っている」',
        '  - 改善点: 「時間配分がやや後半に偏る」',
        '  - 次に練習すると良い点: 「1分短く話す練習」']],
    ['G5 学部が無いと大学名だけ（連結記号を変えない）',
      { feedback: feedback(), createdAt: at, universityName: 'サンプル大学' },
      ['・直近のプレゼン練習（2026/05/01実施・サンプル大学）の結果が保存されています。',
        '  - 総合評価: 構成は明確で聞き取りやすい発表でした。',
        '  - カテゴリ評価: 構成力=良い / わかりやすさ=標準 / 時間配分=要改善',
        '  - 良かった点: 「結論が先に来ている」「具体例が入っている」',
        '  - 改善点: 「時間配分がやや後半に偏る」',
        '  - 次に練習すると良い点: 「1分短く話す練習」']],
    ['G6 全カテゴリ（ORDER 順・区切りは " / "）',
      { feedback: feedback({ categories: { composition: 'strong', persuasion: 'normal', concreteness: 'weak', clarity: 'strong', timeManagement: 'normal', completeness: 'weak', materialConsistency: 'strong' } }), createdAt: at },
      ['・直近のプレゼン練習（2026/05/01実施）の結果が保存されています。',
        '  - 総合評価: 構成は明確で聞き取りやすい発表でした。',
        '  - カテゴリ評価: 構成力=良い / 説得力=標準 / 具体性=要改善 / わかりやすさ=良い / 時間配分=標準 / 完成度=要改善 / 資料整合性=良い',
        '  - 良かった点: 「結論が先に来ている」「具体例が入っている」',
        '  - 改善点: 「時間配分がやや後半に偏る」',
        '  - 次に練習すると良い点: 「1分短く話す練習」']],
  ];
  for (const [label, src, want] of golden) {
    eq(label, renderTutorPresentationLines(projectTutorPresentationContext(src as never)), want);
  }

  // ★ 件数上限を跨ぐ golden（N5c 対策）★
  //   G1〜G6 の fixture は goodPoints が 2 件しかないため、3→2 の cap 変更で
  //   出力が変わらず検出できなかった。上限を **超える** 入力を必ず 1 件持つ。
  eq('G9 件数上限 3/3/2 が bytes で固定されている',
    renderTutorPresentationLines(projectTutorPresentationContext({
      feedback: {
        overallComment: '総合',
        goodPoints: ['g1', 'g2', 'g3', 'g4'],
        improvements: ['i1', 'i2', 'i3', 'i4'],
        nextPractice: ['n1', 'n2', 'n3'],
        categories: {},
      },
      createdAt: at,
    } as never)),
    ['・直近のプレゼン練習（2026/05/01実施）の結果が保存されています。',
      '  - 総合評価: 総合',
      '  - 良かった点: 「g1」「g2」「g3」',
      '  - 改善点: 「i1」「i2」「i3」',
      '  - 次に練習すると良い点: 「n1」「n2」']);

  // 空 input は 1 行も出さない（空文字列や代替文言を作らない）。
  eq('G7 値が無ければ空配列', renderTutorPresentationLines(null), []);
  eq('G8 undefined でも空配列', renderTutorPresentationLines(undefined), []);
}

async function main(): Promise<void> {
  console.log('[exam-spine-stage5.9] presentation canonical tutor block（class 2 / Source-Sync を増やさない）');
  s1Authority();
  s2Query();
  s3Projection();
  await s4Semantics();
  s5Block();
  await s6Privacy();
  s7Consumer();
  s8PriorStages();
  s9GoldenBytes();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage5.9] FAIL: 外部通信 ${fetchCallCount} 回`);
    process.exitCode = 1; return;
  }
  console.log(`\n[exam-spine-stage5.9] network calls = ${fetchCallCount}`);
  console.log(`[exam-spine-stage5.9] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-stage5.9] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
    process.exitCode = 1; return;
  }
  console.log('[exam-spine-stage5.9] PASS');
}
void main();
