// Exam Spine — Stage 2 contract + byte-equivalence check。
//
// 目的:
//   Stage 2 で導入した pure pipeline
//     buildExamContextBlocks → selectExamContextBlocks → orderExamContextBlocks → renderExamContext
//   が、**現行 prompt builder と 1 byte も違わない**ことを機械的に示す。
//
// 厳守（Stage 2 の制約）:
//   - AI API / 外部通信を絶対に呼ばない（fetch を trap し、1 回でも呼ばれたら fail）。
//   - production runtime を一切変更しない（本 script は読むだけ）。
//   - normalize して比較しない。trim / whitespace 正規化 / 改行統一 / JSON 意味比較は禁止。
//     比較は素の `===`（strictEqual 相当）で行う。
//   - Stage 0 snapshot を Stage 2 の実装に合わせて更新しない（baseline は legacy 挙動）。
//
// 使い方:
//   npm run qa:examSpine:stage2
//
// 関連:
//   lib/examSpine/blocks/ , lib/examSpine/orchestrator/
//   scripts/exam-spine-characterization.ts（Stage 0 baseline）
//   scripts/exam-spine-stage1-check.ts（Stage 1 contract）

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── 1. 外部通信 trap（AI calls = 0 の機械的証明）────────────────────
//
// import より前に仕掛ける。以降 fetch が 1 回でも呼ばれたら例外になる。

let fetchCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCallCount += 1;
  const target = typeof args[0] === 'string' ? args[0] : '(non-string input)';
  throw new Error(`[exam-spine-stage2] 外部通信が発生しました（Stage 2 では禁止）: ${target}`);
}) as typeof globalThis.fetch;
void originalFetch;

// ── 2. Stage 1 / Stage 2 contract ─────────────────────────────────
import { EXAM_CONTEXT_PURPOSES } from '@/lib/examSpine/types';
import type { ExamContextPurpose } from '@/lib/examSpine/types';
import { EXAM_SOURCE_KINDS } from '@/lib/examSpine/sourceData/types';
import { EXAM_CONTEXT_REGISTRY } from '@/lib/examSpine/purpose';
import {
  EXAM_CONTEXT_BLOCK_IDS,
  isExamContextBlockId,
} from '@/lib/examSpine/blocks/types';
import type { ExamContextBlockId } from '@/lib/examSpine/blocks/types';
import { EXAM_CONTEXT_BLOCK_REGISTRY } from '@/lib/examSpine/blocks/registry';
import { EXAM_PURPOSE_PLANS } from '@/lib/examSpine/orchestrator/plan';
import { assembleExamContext } from '@/lib/examSpine/orchestrator/assemble';
import { buildExamContextBlocks } from '@/lib/examSpine/blocks/build';
import type { ExamContextInput } from '@/lib/examSpine/orchestrator/input';

// ── 3. legacy prompt builder（比較対象・すべて純関数）──────────────
import { buildWallHittingPrompt } from '@/lib/prompts/analysisPrompt';
import { buildAdditionalQuestionsPrompt } from '@/lib/prompts/additionalQuestionsPrompt';
import { buildSummarizePrompt } from '@/lib/prompts/summarizePrompt';
import { buildStatementReviewPrompt } from '@/lib/statement/review/statementPrompt';
import { buildInterviewQuestionUserPrompt } from '@/lib/interview/buildInterviewQuestionPrompt';
import { buildInterviewQuestionMaterials } from '@/lib/interview/buildInterviewQuestionMaterials';
import { buildReasonPrompt } from '@/lib/prompts';

// ── 4. legacy section builder（block 単位比較の対象）────────────────
import {
  buildBasicInfoPromptSection,
  buildSubjectGradesPromptLines,
} from '@/lib/buildBasicInfoPromptSection';
import { toStudentProfile } from '@/lib/studentProfile';
import { buildStatementStudentProfileContext } from '@/lib/contextBuilders/statementContext';
import { buildInterviewStudentProfileContext } from '@/lib/contextBuilders/interviewContext';
import { buildMatchingStudentProfileContext } from '@/lib/contextBuilders/matchingContext';
import { buildPreviousOutputSummary } from '@/lib/contextBuilders/divergence/buildPreviousOutputSummary';
import { buildPreviousOutputSummarySection } from '@/lib/contextBuilders/divergence/previousOutputSummarySection';
import { buildUnusedExperience } from '@/lib/contextBuilders/divergence/buildUnusedExperience';
import { buildUnusedExperienceSection } from '@/lib/contextBuilders/divergence/unusedExperienceSection';
import { buildThemeFrequency } from '@/lib/contextBuilders/divergence/buildThemeFrequency';
import { buildThemeFrequencySection } from '@/lib/contextBuilders/divergence/themeFrequencySection';
import { buildTutorStudentContext } from '@/lib/contextBuilders/tutorStudentContext';
import { buildTutorStudentContextSection } from '@/lib/tutor/tutorPrompt';

import {
  EXAM_SPINE_FIXTURES,
  FIXED_NOW,
  type ExamSpineFixture,
} from './fixtures/examSpineCharacterization';
import { asActivityData, getStage2Extras } from './fixtures/examSpineStage2';
import type { ExamSpineStage2Extras } from './fixtures/examSpineStage2';

// ── 5. assertion helper ───────────────────────────────────────────

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    return;
  }
  failures.push(detail ? `${label}\n      ${detail}` : label);
}

/** byte 比較。normalize 禁止（trim も whitespace 正規化もしない）。 */
function checkBytes(label: string, actual: string, expected: string): void {
  if (actual === expected) {
    passed += 1;
    return;
  }
  failures.push(
    `${label}\n      legacy bytes = ${expected.length} / spine bytes = ${actual.length}\n      ${describeFirstDiff(expected, actual)}`,
  );
}

function describeFirstDiff(expected: string, actual: string): string {
  const max = Math.max(expected.length, actual.length);
  for (let i = 0; i < max; i++) {
    if (expected[i] !== actual[i]) {
      const from = Math.max(0, i - 40);
      return [
        `first diff at index ${i}`,
        `  expected: ${JSON.stringify(expected.slice(from, i + 40))}`,
        `  actual  : ${JSON.stringify(actual.slice(from, i + 40))}`,
      ].join('\n      ');
    }
  }
  return 'no character diff（長さのみ相違）';
}

// ── 6. Section A: Stage 2 structural contract ─────────────────────

function checkStructuralContracts(): void {
  // Stage 1 の語彙を Stage 2 が壊していないこと（purpose 17 / source kind 10 は不変）。
  check('A1 Stage 1 purpose が 17 のまま', EXAM_CONTEXT_PURPOSES.length === 17,
    `actual=${EXAM_CONTEXT_PURPOSES.length}`);
  check('A2 Stage 1 source kind が 10 のまま', EXAM_SOURCE_KINDS.length === 10,
    `actual=${EXAM_SOURCE_KINDS.length}`);

  // block id ↔ registry の全単射。
  const registryIds = Object.keys(EXAM_CONTEXT_BLOCK_REGISTRY);
  check('A3 block id と registry が 1:1', registryIds.length === EXAM_CONTEXT_BLOCK_IDS.length,
    `ids=${EXAM_CONTEXT_BLOCK_IDS.length} registry=${registryIds.length}`);
  check('A4 registry の key がすべて有効な block id', registryIds.every(isExamContextBlockId));
  check('A5 block id に重複が無い',
    new Set(EXAM_CONTEXT_BLOCK_IDS).size === EXAM_CONTEXT_BLOCK_IDS.length);

  for (const id of EXAM_CONTEXT_BLOCK_IDS) {
    const spec = EXAM_CONTEXT_BLOCK_REGISTRY[id];
    // sourceKind を名乗るなら Stage 1 の kind でなければならない（勝手な 11 個目を作らない）。
    if (spec.sourceKind) {
      check(`A6 ${id} の sourceKind が Stage 1 の kind`,
        (EXAM_SOURCE_KINDS as readonly string[]).includes(spec.sourceKind), spec.sourceKind);
    }
    // mixed は理由の明記を必須にする（安易な mixed を防ぐ）。
    if (spec.provenance === 'mixed') {
      check(`A7 ${id} の mixed に理由がある`, Boolean(spec.mixedReason && spec.mixedReason.length > 20));
    }
    // Stage 2 に generative block は存在しない（AI 出力は必ず domain 型を経由する）。
    check(`A8 ${id} は generative ではない`, spec.derivation !== 'generative');
    check(`A9 ${id} に legacySource 宣言がある`, spec.legacySource.length > 0);
  }

  // mixed の総数を固定する（増えたら意図的判断を強制する）。
  const mixedIds = EXAM_CONTEXT_BLOCK_IDS.filter(
    (id) => EXAM_CONTEXT_BLOCK_REGISTRY[id].provenance === 'mixed',
  );
  check('A10 mixed block は 5 件のみ', mixedIds.length === 5, mixedIds.join(', '));

  // purpose plan の健全性。
  for (const purpose of EXAM_CONTEXT_PURPOSES) {
    const plan = EXAM_PURPOSE_PLANS[purpose];
    check(`A11 ${purpose} の plan が存在`, Boolean(plan));
    const ids = plan.blocks.map((b) => b.id);
    check(`A12 ${purpose} の slot id がすべて有効`, ids.every(isExamContextBlockId));
    check(`A13 ${purpose} の slot に重複が無い`, new Set(ids).size === ids.length, ids.join(', '));
    // heading の二重付与を防ぐ: content 側が heading を持つ block に slot heading を付けない。
    for (const slot of plan.blocks) {
      const spec = EXAM_CONTEXT_BLOCK_REGISTRY[slot.id];
      if (spec.headingOwner === 'block' && !spec.renderMayWrap) {
        check(`A14 ${purpose}/${slot.id} は slot heading を持たない`, slot.heading === undefined);
      }
    }
    // render を持たない purpose は必ず理由を残している。
    if (!plan.render) {
      check(`A15 ${purpose} は render 未定義の理由を残している`,
        Boolean(plan.notes) || Boolean(plan.notYetModeled?.length));
    }
    // 末尾改行を足す purpose は現行に存在しない。
    if (plan.render) {
      check(`A16 ${purpose} は trailingNewline を足さない`, plan.render.trailingNewline === false);
    }
  }

  checkPolicyConsistency();
}

/**
 * Stage 1 policy（profile / activity / selfUnderstanding / recentLogs / university）と
 * Stage 2 の block 選択が矛盾しないことを検証する。
 *
 * ★ 検証するのは **exclude 方向**（「載せないと宣言したものが block に混じっていない」）。
 *   include 方向は、まだ block 化していない section を持つ purpose があるため
 *   render contract を持つ purpose にだけ課す（未着手を「違反」と誤検出しない）。
 */
function checkPolicyConsistency(): void {
  const PROFILE_FULL: ExamContextBlockId[] = ['basic_profile'];
  const PROFILE_MINIMAL: ExamContextBlockId[] = ['applicant_profile_basics', 'subject_grades'];
  const SELF: ExamContextBlockId[] = [
    'self_analysis_statement',
    'self_analysis_interview',
    'self_analysis_matching',
    'self_analysis_questions',
  ];
  const ACTIVITY_COMPACT: ExamContextBlockId[] = [
    'activity_text',
    'activity_context',
    'activity_context_matching',
  ];
  const ACTIVITY_MINIMAL: ExamContextBlockId[] = [
    'activity_summary',
    'unused_experience',
    'theme_frequency',
    'theme_frequency_questions',
  ];
  const LOGS: ExamContextBlockId[] = [
    'previous_output_summary',
    'statement_summary',
    'tutor_student_context',
  ];
  const UNIVERSITY: ExamContextBlockId[] = [
    'university_context',
    'statement_university_context',
    'interview_university_context',
    'essay_university_context',
    'admission_focus',
  ];

  for (const purpose of EXAM_CONTEXT_PURPOSES) {
    const policy = EXAM_CONTEXT_REGISTRY[purpose];
    const plan = EXAM_PURPOSE_PLANS[purpose];
    const ids = new Set(plan.blocks.map((b) => b.id));
    const has = (list: ExamContextBlockId[]) => list.some((id) => ids.has(id));
    const label = (rule: string) => `A-P ${purpose} ${rule}`;

    if (policy.profile === 'exclude') {
      check(label('profile=exclude → profile block なし'),
        !has(PROFILE_FULL) && !has(PROFILE_MINIMAL));
    }
    if (policy.profile === 'minimal') {
      // 氏名込みの basic_profile を載せてはいけない（minimal の定義）。
      check(label('profile=minimal → basic_profile なし'), !has(PROFILE_FULL));
    }
    if (policy.selfUnderstanding === 'exclude') {
      check(label('selfUnderstanding=exclude → 自己理解 block なし'), !has(SELF));
    }
    if (policy.recentLogs === 'exclude') {
      check(label('recentLogs=exclude → 横断ログ block なし'), !has(LOGS));
    }
    if (policy.university === 'exclude') {
      check(label('university=exclude → 大学 block なし'), !has(UNIVERSITY));
    }
    if (policy.activity === 'exclude') {
      check(label('activity=exclude → 活動 block なし'),
        !has(ACTIVITY_COMPACT) && !has(ACTIVITY_MINIMAL));
    }
    if (policy.activity === 'minimal') {
      check(label('activity=minimal → compact 活動 block なし'), !has(ACTIVITY_COMPACT));
    }

    // admissionFocus は「通電している purpose」と block の有無が一致していなければならない。
    check(label('admission_focus は policy と一致'),
      ids.has('admission_focus') === (policy.university === 'admission_focus'));

    // include 方向は render contract を持つ（= 完全に block 化済みの）purpose にだけ課す。
    if (plan.render) {
      if (policy.profile === 'include') {
        check(label('profile=include → basic_profile あり'), has(PROFILE_FULL));
      }
      if (policy.selfUnderstanding === 'include') {
        check(label('selfUnderstanding=include → 自己理解 block あり'), has(SELF));
      }
      if (policy.university === 'include') {
        check(label('university=include → 大学 block あり'), has(UNIVERSITY));
      }
    }
  }
}

// ── 7. Section B: block 単位の byte-equivalence ────────────────────
//
// Stage 0 で characterization した builder のうち「context section 文字列を返すもの」を、
// Spine の block content と byte 比較する。

function fullInput(f: ExamSpineFixture, x: ExamSpineStage2Extras): ExamContextInput {
  return {
    origin: 'bridge',
    basicInfo: f.basicInfo,
    universityContext: x.universityContext,
    interviewUniversityContext: x.interviewUniversityContext,
    interviewExamTypeGuidance: x.interviewExamTypeGuidance,
    activityText: x.activityText,
    activityData: asActivityData(f.activityData),
    activitySummary: f.activitySummary,
    studentProfile: f.studentProfile,
    wallHittingResult: f.wallHittingResult,
    projectionNow: FIXED_NOW,
    statementDraft: f.statementDraft,
    ngIssues: x.ngIssues,
    structureAnalysis: x.structureAnalysis,
    previousOutputSummary: buildPreviousOutputSummary(f.statementReviewResults),
    themeFrequency: buildThemeFrequency({
      activityData: f.activityData,
      studentProfile: f.studentProfile,
    }),
    unusedExperience: buildUnusedExperience({
      activityData: f.activityData,
      usedText: f.usedText,
    }),
    tutorSources: f.tutorSources,
    statementTarget: x.statementTarget,
    statementBody: x.statementBody,
    selfPrBody: x.selfPrBody,
    analysis: x.analysis,
    answers: x.answers,
    deepAnswers: x.deepAnswers,
    freeMemo: x.freeMemo,
    existingQuestions: x.existingQuestions,
    dailySeed: x.dailySeed,
  };
}

function resolveFixtureProfile(f: ExamSpineFixture) {
  return f.studentProfile ?? (f.wallHittingResult ? toStudentProfile(f.wallHittingResult, { now: FIXED_NOW }) : null);
}

function checkBlockEquivalence(f: ExamSpineFixture, x: ExamSpineStage2Extras): void {
  const blocks = buildExamContextBlocks(fullInput(f, x));
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const content = (id: ExamContextBlockId): string => byId.get(id)?.content ?? '__MISSING_BLOCK__';
  const at = (id: string) => `B ${f.id} / ${id}`;

  const profile = resolveFixtureProfile(f);
  const gradeLines = buildSubjectGradesPromptLines(f.basicInfo?.subjectGrades);

  checkBytes(at('basic_profile'), content('basic_profile'), buildBasicInfoPromptSection(f.basicInfo));
  checkBytes(at('subject_grades'), content('subject_grades'),
    gradeLines.length > 0 ? gradeLines.join('\n') : '');
  checkBytes(at('self_analysis_statement'), content('self_analysis_statement'),
    buildStatementStudentProfileContext(profile));
  checkBytes(at('self_analysis_interview'), content('self_analysis_interview'),
    buildInterviewStudentProfileContext(profile));
  checkBytes(at('self_analysis_matching'), content('self_analysis_matching'),
    buildMatchingStudentProfileContext(profile));
  checkBytes(at('previous_output_summary'), content('previous_output_summary'),
    buildPreviousOutputSummarySection(buildPreviousOutputSummary(f.statementReviewResults)));
  checkBytes(at('theme_frequency'), content('theme_frequency'),
    buildThemeFrequencySection(
      buildThemeFrequency({ activityData: f.activityData, studentProfile: f.studentProfile }),
    ));
  checkBytes(at('unused_experience'), content('unused_experience'),
    buildUnusedExperienceSection(
      buildUnusedExperience({ activityData: f.activityData, usedText: f.usedText }),
    ));
  checkBytes(at('tutor_student_context'), content('tutor_student_context'),
    buildTutorStudentContextSection(buildTutorStudentContext(f.tutorSources)));

  // presence / empty の意味づけが legacy の「section を出す / 出さない」と一致すること。
  for (const block of blocks) {
    check(`B ${f.id} / ${block.id} empty flag が presence と整合`,
      block.empty === (block.presence !== 'present'));
    check(`B ${f.id} / ${block.id} estimatedChars が content 長`,
      block.estimatedChars === block.content.length);
  }
}

// ── 8. Section C: assembly（prompt 全体）の byte-equivalence ────────
//
// legacy prompt builder を **実際に import して呼び**、Spine pipeline の出力と byte 比較する。
// 転記した期待値ではなく本番コードそのものが比較対象なので、写経ズレも検出できる。

type AssemblyCase = {
  purpose: ExamContextPurpose;
  legacy: () => string;
  input: ExamContextInput;
};

function assemblyCases(f: ExamSpineFixture, x: ExamSpineStage2Extras): AssemblyCase[] {
  const activityData = asActivityData(f.activityData);
  const themeFrequency = buildThemeFrequency({
    activityData: f.activityData,
    studentProfile: f.studentProfile,
  });
  const unusedExperience = buildUnusedExperience({
    activityData: f.activityData,
    usedText: f.usedText,
  });
  const previousOutputSummary = buildPreviousOutputSummary(f.statementReviewResults);

  return [
    {
      purpose: 'self_analysis',
      legacy: () =>
        buildWallHittingPrompt({
          basicInfo: f.basicInfo,
          universityContext: x.universityContext,
          activityText: x.activityText,
        }),
      input: {
        basicInfo: f.basicInfo,
        universityContext: x.universityContext,
        activityText: x.activityText,
      },
    },
    {
      purpose: 'self_analysis_additional',
      legacy: () =>
        buildAdditionalQuestionsPrompt({
          basicInfo: f.basicInfo,
          universityContext: x.universityContext,
          activityText: x.activityText,
          existingQuestions: x.existingQuestions,
          themeFrequency,
        }),
      input: {
        basicInfo: f.basicInfo,
        universityContext: x.universityContext,
        activityText: x.activityText,
        existingQuestions: x.existingQuestions,
        themeFrequency,
      },
    },
    {
      purpose: 'summarize',
      legacy: () =>
        buildSummarizePrompt({
          basicInfo: f.basicInfo,
          universityContext: x.universityContext,
          activityText: x.activityText,
          analysis: x.analysis,
          answers: x.answers,
          deepAnswers: x.deepAnswers,
          freeMemo: x.freeMemo,
        }),
      input: {
        basicInfo: f.basicInfo,
        universityContext: x.universityContext,
        activityText: x.activityText,
        analysis: x.analysis,
        answers: x.answers,
        deepAnswers: x.deepAnswers,
        freeMemo: x.freeMemo,
      },
    },
    {
      purpose: 'statement_review',
      legacy: () =>
        buildStatementReviewPrompt({
          university: x.statementTarget.university,
          faculty: x.statementTarget.faculty,
          department: x.statementTarget.department,
          essay: x.statementBody,
          basicInfo: f.basicInfo,
          activityData,
          studentProfile: f.studentProfile,
          wallHittingResult: f.wallHittingResult,
          ngIssues: x.ngIssues,
          structureAnalysis: x.structureAnalysis,
          previousOutputSummary,
          themeFrequency,
          unusedExperience,
        }),
      input: {
        basicInfo: f.basicInfo,
        statementTarget: x.statementTarget,
        statementBody: x.statementBody,
        activityData,
        studentProfile: f.studentProfile,
        wallHittingResult: f.wallHittingResult,
        projectionNow: FIXED_NOW,
        ngIssues: x.ngIssues,
        structureAnalysis: x.structureAnalysis,
        previousOutputSummary,
        themeFrequency,
        unusedExperience,
      },
    },
    {
      purpose: 'interview_questions',
      legacy: () =>
        buildInterviewQuestionUserPrompt({
          materials: buildInterviewQuestionMaterials({
            basicInfo: f.basicInfo,
            statementDraft: f.statementDraft,
            studentProfile: f.studentProfile,
            activitySummary: f.activitySummary,
          }),
          universityContext: x.interviewUniversityContext,
          examTypeGuidance: x.interviewExamTypeGuidance,
          dailySeed: x.dailySeed,
        }),
      input: {
        basicInfo: f.basicInfo,
        statementDraft: f.statementDraft,
        studentProfile: f.studentProfile,
        activitySummary: f.activitySummary,
        interviewUniversityContext: x.interviewUniversityContext,
        interviewExamTypeGuidance: x.interviewExamTypeGuidance,
        dailySeed: x.dailySeed,
      },
    },
    {
      purpose: 'self_pr',
      legacy: () =>
        buildReasonPrompt(x.selfPrBody, {
          themeFrequencySection: buildThemeFrequencySection(themeFrequency),
          unusedExperienceSection: buildUnusedExperienceSection(unusedExperience),
        }),
      input: {
        themeFrequency,
        unusedExperience,
        selfPrBody: x.selfPrBody,
      },
    },
  ];
}

function checkAssemblyEquivalence(f: ExamSpineFixture, x: ExamSpineStage2Extras): void {
  for (const c of assemblyCases(f, x)) {
    const result = assembleExamContext({ purpose: c.purpose, input: c.input });
    check(`C ${f.id} / ${c.purpose} は render 済み`, result.renderStatus === 'rendered');
    checkBytes(`C ${f.id} / ${c.purpose} byte-equivalence`, result.text ?? '', c.legacy());
    // budget を参照しても enforcement していないこと。
    check(`C ${f.id} / ${c.purpose} budget を enforce していない`, result.budget.enforced === false);
  }
}

// ── 9. Section D: 純関数性 / budget / runtime 分離 ─────────────────

/**
 * pipeline が Date / Math.random に触れていないことを、実際に壊して確かめる。
 * 触れていれば throw して fail する（「同じ結果になった」より強い証明）。
 */
function checkPurity(f: ExamSpineFixture, x: ExamSpineStage2Extras): void {
  const realNow = Date.now;
  const realRandom = Math.random;
  const RealDate = globalThis.Date;
  let threw: string | null = null;
  let first = '';
  let second = '';
  try {
    Date.now = () => {
      throw new Error('Date.now が呼ばれました');
    };
    Math.random = () => {
      throw new Error('Math.random が呼ばれました');
    };
    globalThis.Date = new Proxy(RealDate, {
      construct() {
        throw new Error('new Date() が呼ばれました');
      },
    });
    for (const c of assemblyCases(f, x)) {
      const a = assembleExamContext({ purpose: c.purpose, input: c.input });
      const b = assembleExamContext({ purpose: c.purpose, input: c.input });
      first += a.text ?? '';
      second += b.text ?? '';
    }
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
    globalThis.Date = RealDate;
  }
  check(`D ${f.id} pipeline は Date / Math.random に触れない`, threw === null, threw ?? '');
  check(`D ${f.id} pipeline は同入力で同出力`, first === second);
}

/** budget を超える入力でも truncate されないこと（Stage 2 は enforcement しない）。 */
function checkBudgetNotEnforced(): void {
  const huge = 'あ'.repeat(60_000);
  const result = assembleExamContext({
    purpose: 'self_analysis',
    input: { basicInfo: null, universityContext: null, activityText: huge },
  });
  check('D budget を超えても truncate しない',
    (result.text ?? '').includes(huge) &&
      (result.text ?? '').length > result.budget.maxContextChars,
    `text=${(result.text ?? '').length} budget=${result.budget.maxContextChars}`);
  check('D budget.enforced は常に false', result.budget.enforced === false);
  // legacy も同じく truncate しないこと（Spine だけが素通しなのではない）。
  const legacy = buildWallHittingPrompt({
    basicInfo: null,
    universityContext: null,
    activityText: huge,
  });
  checkBytes('D budget 超過時も legacy と byte 一致', result.text ?? '', legacy);
}

const REPO_ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

/** production runtime（app / lib）から examSpine を import していないこと。 */
function checkNoRuntimeImport(): void {
  const offenders: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const file of walk(join(REPO_ROOT, dir))) {
      const rel = relative(REPO_ROOT, file);
      if (rel.startsWith(join('lib', 'examSpine'))) continue;
      const src = readFileSync(file, 'utf8');
      // import 文だけを見る（コメント中の architecture 参照は許容される）。
      if (/^\s*import[^\n]*examSpine/m.test(src) || /require\(['"][^'"]*examSpine/.test(src)) {
        offenders.push(rel);
      }
    }
  }
  check('D production runtime からの examSpine import が 0 本', offenders.length === 0,
    offenders.join(', '));
}

/** CAREER への runtime dependency が 0 であること（コメント参照は Stage 1 ルールで許容）。 */
function checkNoCareerDependency(): void {
  const offenders: string[] = [];
  const targets = [
    ...walk(join(REPO_ROOT, 'lib', 'examSpine')),
    join(REPO_ROOT, 'scripts', 'exam-spine-stage2-check.ts'),
    join(REPO_ROOT, 'scripts', 'fixtures', 'examSpineStage2.ts'),
  ];
  for (const file of targets) {
    const src = readFileSync(file, 'utf8');
    for (const line of src.split('\n')) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      // import 文だけを見る（本 script 自身の検出用パターン文字列を拾わないため行頭を固定する）。
      if (/^\s*import[^\n]*['"][^'"]*(PASSAI-CAREER|careerSpine|careerContext|careerSourceData)/.test(line)) {
        offenders.push(`${relative(REPO_ROOT, file)}: ${line.trim()}`);
      }
    }
  }
  check('D CAREER への runtime dependency が 0', offenders.length === 0, offenders.join(' | '));
}

/**
 * AI SDK が module graph に載っていないことの機械的確認。
 * import した builder のどれかが AI client を引き込んでいれば true になる。
 */
function aiSdkLoaded(): boolean {
  const cache =
    (globalThis as { require?: { cache?: Record<string, unknown> } }).require?.cache ??
    (typeof require !== 'undefined' ? require.cache : undefined);
  if (!cache) return false;
  return Object.keys(cache).some(
    (p) => p.includes('@anthropic-ai') || p.includes('/openai/') || p.includes('@google/genai'),
  );
}

// ── 10. run ───────────────────────────────────────────────────────


// ── E-S26: mixed-origin を block 単位で表現できること ─────────────────
//
// Canon §17（暗黙的 Mixed-Origin の禁止）/ E-P7（per-field の server↔bridge 共存）を
// 型で満たしていることの証明。single origin では不可能だったことを示す。
function checkMixedOrigin(): void {
  const fixture = EXAM_SPINE_FIXTURES[0];
  const extras = getStage2Extras(fixture);
  const base = fullInput(fixture, extras);

  // 1 つの context で 3 origin が同時に成立する現実的な組み合わせ:
  //   basic_info  … server（tutor は既に server で読んでいる）
  //   activity    … bridge（server 経路はあるが今回は body 由来）
  //   statementDraft … not_server_capable（durable table が無い / E-P3）
  const mixed = buildExamContextBlocks({
    ...base,
    origin: 'bridge',
    origins: { basic_info: 'server', self_analysis: 'server' },
    notServerCapableSlots: ['statementDraft'],
  });

  const byId = new Map(mixed.map((b) => [b.id, b]));
  const originOf = (id: string): string | undefined => byId.get(id as never)?.origin;

  check('E1 basic_info 由来 block は server', originOf('basic_profile') === 'server',
    String(originOf('basic_profile')));
  check('E1 self_analysis 由来 block は server',
    originOf('self_analysis_statement') === 'server', String(originOf('self_analysis_statement')));
  check('E1 activity 由来 block は bridge（申告が無いので既定へ）',
    originOf('activity_text') === 'bridge', String(originOf('activity_text')));
  check('E1 statementDraft 由来 block は not_server_capable',
    originOf('statement_summary') === 'not_server_capable', String(originOf('statement_summary')));

  const distinct = new Set(mixed.map((b) => b.origin));
  check('E2 1 つの context に 3 origin が同時に存在できる', distinct.size === 3,
    [...distinct].join(', '));

  // single origin では表現できなかったことの反証（後方互換の確認も兼ねる）。
  const single = buildExamContextBlocks({ ...base, origin: 'bridge' });
  const singleDistinct = new Set(single.map((b) => b.origin));
  check('E3 origins 未指定なら全 block が同一 origin（従来挙動）', singleDistinct.size === 1,
    [...singleDistinct].join(', '));

  // origin は render に出ない ＝ byte-equivalence に影響しない。
  const renderedMixed = JSON.stringify(mixed.map((b) => b.content));
  const renderedSingle = JSON.stringify(single.map((b) => b.content));
  check('E4 origin を変えても block content は 1 byte も変わらない',
    renderedMixed === renderedSingle);

  // 推測しない: 申告が無い kind を勝手に server にしない。
  const noClaim = buildExamContextBlocks({ ...base, origins: {} });
  check('E5 申告が無い kind を server に補完しない',
    noClaim.every((b) => b.origin === 'bridge'));
}

function main(): void {
  console.log('[exam-spine-stage2] Stage 2 contract + byte-equivalence check');
  console.log(
    `[exam-spine-stage2] fixtures=${EXAM_SPINE_FIXTURES.length} blocks=${EXAM_CONTEXT_BLOCK_IDS.length} purposes=${EXAM_CONTEXT_PURPOSES.length}`,
  );

  checkStructuralContracts();

  for (const fixture of EXAM_SPINE_FIXTURES) {
    const extras = getStage2Extras(fixture);
    checkBlockEquivalence(fixture, extras);
    checkAssemblyEquivalence(fixture, extras);
    checkPurity(fixture, extras);
  }

  checkMixedOrigin();
  checkBudgetNotEnforced();
  checkNoRuntimeImport();
  checkNoCareerDependency();

  if (fetchCallCount !== 0) {
    console.error(`\n[exam-spine-stage2] FAIL: 外部通信が ${fetchCallCount} 回発生しました`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[exam-spine-stage2] network calls = ${fetchCallCount}（AI API 呼び出しゼロ）`);
  console.log(`[exam-spine-stage2] AI SDK loaded  = ${aiSdkLoaded() ? 'YES' : 'NO'}`);
  if (aiSdkLoaded()) {
    console.error('[exam-spine-stage2] FAIL: AI SDK が module graph に載っています');
    process.exitCode = 1;
    return;
  }

  console.log(`[exam-spine-stage2] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`\n[exam-spine-stage2] FAIL: ${failures.length} 件`);
    for (const f of failures.slice(0, 20)) console.error(`  - ${f}`);
    if (failures.length > 20) console.error(`  … 他 ${failures.length - 20} 件`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-stage2] PASS');
}

main();
