// Exam Spine — characterization baseline（Stage 0）。
//
// 目的:
//   **Spine 移行前の、現行 context / materials builder の出力を固定する。**
//   Stage 1 以降で loader / projection / orchestrator を導入したとき、
//   「出力が変わっていないこと」を機械的に検出できる基準線を作る。
//
// 厳守（Stage 0 の制約）:
//   - **AI API を絶対に呼ばない**（Anthropic / OpenAI / その他）。
//     script 冒頭で globalThis.fetch を trap し、外部通信が起きたら即 fail させる。
//   - production runtime を一切変更しない（本 script は読むだけ）。
//   - deterministic。Date.now / new Date / Math.random / crypto / UUID / 環境変数に依存しない。
//     生成時刻を必要とする builder には fixture の固定値を注入する。
//   - dependency を追加しない（Node 標準 + 既存 lib のみ）。
//
// 対象:
//   純関数として import 可能な現行 builder のみ。
//   lib/contextBuilders/tutorContext.ts（Supabase server loader 同居）は
//   'server-only' を transitively import するため対象外
//   （Stage 3 で server reader を分離したときに追加する）。
//
// 使い方:
//   npm run qa:exam-spine:characterization           # --check（既定）
//   npx tsx scripts/exam-spine-characterization.ts --record
//   npx tsx scripts/exam-spine-characterization.ts --check
//
// 関連:
//   docs/principles/exam_spine/EXAM_SPINE_ARCHITECTURE.md
//   docs/principles/exam_spine/EXAM_SPINE_STATE.md
//   scripts/fixtures/examSpineCharacterization.ts
// Upstream architecture reference: PASSAI-CAREER/scripts/（QA script 方式）

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── 1. 外部通信 trap（AI calls = 0 の機械的証明）────────────────────
//
// import より前に仕掛ける。以降 fetch が 1 回でも呼ばれたら例外になり、
// script は非ゼロ終了する。＝「AI を呼んでいない」ことが実行結果で担保される。

let fetchCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCallCount += 1;
  const target = typeof args[0] === 'string' ? args[0] : '(non-string input)';
  throw new Error(
    `[exam-spine-characterization] 外部通信が発生しました（Stage 0 では禁止）: ${target}`,
  );
}) as typeof globalThis.fetch;
void originalFetch;

// ── 2. 対象 builder（すべて純関数）─────────────────────────────────

import {
  buildBasicInfoPromptSection,
  buildSubjectGradesPromptLines,
} from '@/lib/buildBasicInfoPromptSection';
import { toStudentProfile } from '@/lib/studentProfile';
import { buildStatementStudentProfileContext } from '@/lib/contextBuilders/statementContext';
import { buildInterviewStudentProfileContext } from '@/lib/contextBuilders/interviewContext';
import { buildMatchingStudentProfileContext } from '@/lib/contextBuilders/matchingContext';
import { buildInterviewQuestionMaterials } from '@/lib/interview/buildInterviewQuestionMaterials';
import { buildSelfPRDraftSeed } from '@/lib/buildSelfPRDraftSeed';
import { buildTutorStudentContext } from '@/lib/contextBuilders/tutorStudentContext';
import { buildTutorStudentContextSection } from '@/lib/tutor/tutorPrompt';
import { buildPreviousOutputSummary } from '@/lib/contextBuilders/divergence/buildPreviousOutputSummary';
import { buildUnusedExperience } from '@/lib/contextBuilders/divergence/buildUnusedExperience';
import { buildThemeFrequency } from '@/lib/contextBuilders/divergence/buildThemeFrequency';

import {
  EXAM_SPINE_FIXTURES,
  FIXED_NOW,
  type ExamSpineFixture,
} from './fixtures/examSpineCharacterization';

// ── 3. builder registry ───────────────────────────────────────────
//
// key は snapshot 内の安定 ID。並べ替え・改名は snapshot の破壊的変更になる。
// 各 builder は fixture を受け取り、JSON 化可能な値を返すだけ（副作用なし）。

type BuilderCase = {
  /** snapshot 内の安定 key。 */
  key: string;
  /** どの feature の context 生成に対応するか（人間向けラベル）。 */
  feature: string;
  /** 実体のソース位置（移行時の追跡用）。 */
  source: string;
  run: (f: ExamSpineFixture) => unknown;
};

const BUILDERS: readonly BuilderCase[] = [
  {
    key: 'basicInfoPromptSection',
    feature: 'cross-cutting（11 route が参照）',
    source: 'lib/buildBasicInfoPromptSection.ts:buildBasicInfoPromptSection',
    run: (f) => buildBasicInfoPromptSection(f.basicInfo),
  },
  {
    key: 'subjectGradesPromptLines',
    feature: 'cross-cutting（subjectGrades section）',
    source: 'lib/buildBasicInfoPromptSection.ts:buildSubjectGradesPromptLines',
    run: (f) => buildSubjectGradesPromptLines(f.basicInfo?.subjectGrades),
  },
  {
    key: 'toStudentProfile',
    feature: 'self-analysis / summarize（canonical projection）',
    source: 'lib/studentProfile.ts:toStudentProfile',
    // generatedAt は options.now で固定する（実時刻を使うと snapshot が不安定になる）。
    run: (f) =>
      f.wallHittingResult ? toStudentProfile(f.wallHittingResult, { now: FIXED_NOW }) : null,
  },
  {
    key: 'statementStudentProfileContext',
    feature: 'statement-review',
    source: 'lib/contextBuilders/statementContext.ts:buildStatementStudentProfileContext',
    run: (f) => buildStatementStudentProfileContext(f.studentProfile),
  },
  {
    key: 'interviewStudentProfileContext',
    feature: 'interview-feedback',
    source: 'lib/contextBuilders/interviewContext.ts:buildInterviewStudentProfileContext',
    run: (f) => buildInterviewStudentProfileContext(f.studentProfile),
  },
  {
    key: 'matchingStudentProfileContext',
    feature: 'matching',
    source: 'lib/contextBuilders/matchingContext.ts:buildMatchingStudentProfileContext',
    run: (f) => buildMatchingStudentProfileContext(f.studentProfile),
  },
  {
    key: 'interviewQuestionMaterials',
    feature: 'interview-questions',
    source: 'lib/interview/buildInterviewQuestionMaterials.ts:buildInterviewQuestionMaterials',
    run: (f) =>
      buildInterviewQuestionMaterials({
        basicInfo: f.basicInfo,
        statementDraft: f.statementDraft,
        studentProfile: f.studentProfile,
        activitySummary: f.activitySummary,
      }),
  },
  {
    key: 'selfPRDraftSeed',
    feature: 'self-pr',
    source: 'lib/buildSelfPRDraftSeed.ts:buildSelfPRDraftSeed',
    run: (f) =>
      buildSelfPRDraftSeed({ profile: f.studentProfile, analyzeSummary: f.analyzeSummary }),
  },
  {
    key: 'tutorStudentContext',
    feature: 'tutor（body 由来の横断要約）',
    source: 'lib/contextBuilders/tutorStudentContext.ts:buildTutorStudentContext',
    run: (f) =>
      buildTutorStudentContext({
        basicInfo: f.basicInfo,
        studentProfile: f.studentProfile,
        statementReviewLatest: f.tutorSources.statementReviewLatest,
        activityData: f.tutorSources.activityData,
        essayReviewLatest: f.tutorSources.essayReviewLatest,
        interviewRecordLatest: f.tutorSources.interviewRecordLatest,
        interviewFeedbackLatest: f.tutorSources.interviewFeedbackLatest,
        mypageSummary: f.tutorSources.mypageSummary,
      }),
  },
  {
    key: 'tutorStudentContextSection',
    feature: 'tutor（SYSTEM block 2 の最終文字列）',
    source: 'lib/tutor/tutorPrompt.ts:buildTutorStudentContextSection',
    run: (f) =>
      buildTutorStudentContextSection(
        buildTutorStudentContext({
          basicInfo: f.basicInfo,
          studentProfile: f.studentProfile,
          statementReviewLatest: f.tutorSources.statementReviewLatest,
          activityData: f.tutorSources.activityData,
          essayReviewLatest: f.tutorSources.essayReviewLatest,
          interviewRecordLatest: f.tutorSources.interviewRecordLatest,
          interviewFeedbackLatest: f.tutorSources.interviewFeedbackLatest,
          mypageSummary: f.tutorSources.mypageSummary,
        }),
      ),
  },
  {
    key: 'divergencePreviousOutputSummary',
    feature: 'statement-review / interview-feedback（divergence）',
    source:
      'lib/contextBuilders/divergence/buildPreviousOutputSummary.ts:buildPreviousOutputSummary',
    run: (f) => buildPreviousOutputSummary(f.statementReviewResults),
  },
  {
    key: 'divergenceUnusedExperience',
    feature: 'statement-review / interview-feedback / self-pr（divergence）',
    source: 'lib/contextBuilders/divergence/buildUnusedExperience.ts:buildUnusedExperience',
    run: (f) => buildUnusedExperience({ activityData: f.activityData, usedText: f.usedText }),
  },
  {
    key: 'divergenceThemeFrequency',
    feature: 'self-pr（divergence）',
    source: 'lib/contextBuilders/divergence/buildThemeFrequency.ts:buildThemeFrequency',
    run: (f) =>
      buildThemeFrequency({ activityData: f.activityData, studentProfile: f.studentProfile }),
  },
];

// ── 4. deterministic serialization ────────────────────────────────
//
// JSON.stringify のキー順は挿入順に依存する。snapshot の安定性のため、
// object のキーを常にソートして出力する。

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = stableSort(src[k]);
    return out;
  }
  // undefined は JSON に載らないため明示マーカーへ落とす（欠損と null を区別する）。
  if (value === undefined) return '__undefined__';
  return value;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(stableSort(value), null, 2)}\n`;
}

// ── 5. snapshot I/O ───────────────────────────────────────────────

const SNAPSHOT_DIR = join(__dirname, 'fixtures', 'exam-spine-characterization');

function snapshotPath(fixtureId: string): string {
  return join(SNAPSHOT_DIR, `${fixtureId}.json`);
}

function buildSnapshot(fixture: ExamSpineFixture): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  for (const b of BUILDERS) {
    try {
      outputs[b.key] = b.run(fixture);
    } catch (error) {
      // builder は throw しない設計だが、throw した事実自体も固定対象にする。
      outputs[b.key] = {
        __threw__: true,
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    fixtureId: fixture.id,
    description: fixture.description,
    // builder の実体位置。移行時に「どこが置き換わったか」を追える。
    builders: BUILDERS.map((b) => ({ key: b.key, feature: b.feature, source: b.source })),
    outputs,
  };
}

// ── 6. run ────────────────────────────────────────────────────────

type Mode = 'record' | 'check';

function parseMode(argv: readonly string[]): Mode {
  if (argv.includes('--record')) return 'record';
  if (argv.includes('--check')) return 'check';
  // 既定は check（CI / 手元での回帰検出を既定動作にする）。
  return 'check';
}

function main(): void {
  const mode = parseMode(process.argv.slice(2));
  console.log(`[exam-spine-characterization] mode=${mode}`);
  console.log(
    `[exam-spine-characterization] fixtures=${EXAM_SPINE_FIXTURES.length} builders=${BUILDERS.length}`,
  );

  if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });

  let failures = 0;
  const seen = new Set<string>();

  for (const fixture of EXAM_SPINE_FIXTURES) {
    const path = snapshotPath(fixture.id);
    const actual = serialize(buildSnapshot(fixture));
    seen.add(`${fixture.id}.json`);

    if (mode === 'record') {
      writeFileSync(path, actual, 'utf8');
      console.log(`  RECORDED  ${fixture.id}  (${actual.length} bytes)`);
      continue;
    }

    if (!existsSync(path)) {
      console.error(`  MISSING   ${fixture.id}  → --record が未実行です`);
      failures += 1;
      continue;
    }
    const expected = readFileSync(path, 'utf8');
    if (expected === actual) {
      console.log(`  OK        ${fixture.id}  (${actual.length} bytes)`);
    } else {
      failures += 1;
      console.error(`  DIFF      ${fixture.id}`);
      printFirstDiff(expected, actual);
    }
  }

  // record 時のみ、fixture から消えた古い snapshot を検出して知らせる（自動削除はしない）。
  if (mode === 'record' && existsSync(SNAPSHOT_DIR)) {
    for (const file of readdirSync(SNAPSHOT_DIR)) {
      if (file.endsWith('.json') && !seen.has(file)) {
        console.warn(`  ORPHAN    ${file}  （対応 fixture が存在しません。手動で確認してください）`);
      }
    }
  }

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-characterization] FAIL: 外部通信が ${fetchCallCount} 回発生しました`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[exam-spine-characterization] network calls = ${fetchCallCount}（AI API 呼び出しゼロ）`);
  console.log(`[exam-spine-characterization] AI SDK loaded  = ${aiSdkLoaded() ? 'YES' : 'NO'}`);

  if (aiSdkLoaded()) {
    console.error('[exam-spine-characterization] FAIL: AI SDK が module graph に載っています');
    process.exitCode = 1;
    return;
  }

  if (mode === 'check' && failures > 0) {
    console.error(`\n[exam-spine-characterization] FAIL: ${failures} fixture が baseline と不一致`);
    process.exitCode = 1;
    return;
  }
  console.log(`[exam-spine-characterization] ${mode === 'record' ? 'RECORD' : 'CHECK'} PASS`);
}

/** 差分の先頭 1 行だけを出す（本文全体を log に流さない）。 */
function printFirstDiff(expected: string, actual: string): void {
  const e = expected.split('\n');
  const a = actual.split('\n');
  const max = Math.max(e.length, a.length);
  for (let i = 0; i < max; i++) {
    if (e[i] !== a[i]) {
      console.error(`      line ${i + 1}`);
      console.error(`        expected: ${(e[i] ?? '(EOF)').slice(0, 160)}`);
      console.error(`        actual  : ${(a[i] ?? '(EOF)').slice(0, 160)}`);
      return;
    }
  }
}

/**
 * AI SDK が module graph に載っていないことの機械的確認。
 * import した builder のどれかが AI client を引き込んでいれば true になる。
 */
function aiSdkLoaded(): boolean {
  const cache = (globalThis as { require?: { cache?: Record<string, unknown> } }).require?.cache
    ?? (typeof require !== 'undefined' ? require.cache : undefined);
  if (!cache) return false;
  return Object.keys(cache).some(
    (p) => p.includes('@anthropic-ai') || p.includes('openai') || p.includes('@google/genai'),
  );
}

main();
