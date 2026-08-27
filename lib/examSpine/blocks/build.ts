// PASSAI 受験版 Exam Spine — Layer 2 block builder（Stage 2 / 純関数のみ）。
//
// 責務は「与えられた入力を、現行 prompt に実在する semantic section へ 1:1 で写すこと」だけ。
// 選択（purpose policy）も順序も render も持たない（Layer 3 / 4 / 5 の責務）。
//
// ★ 実装方針（byte-equivalence の要）★
//   1. **共有 formatter が export されている section は必ずそれを呼ぶ**。
//      同じ section を Spine 側で書き直さない（route ごとの別実装を増やさないという Stage 2 の目的に反する）。
//   2. module-private な legacy helper（statementPrompt.ts の buildActivityContext 等）だけは
//      Spine 側に写経する。**legacy 側は 1 文字も変更しない**（export 追加も production diff になるため行わない）。
//      写経した block は Stage 2 QA が legacy prompt builder の出力と byte 比較して守る。
//   3. content に対して trim / normalize / truncate を足さない。空白も改行も legacy のまま。
//
// 純関数のみ（fetch / Supabase / localStorage / Date / Math.random / process.env / AI 一切なし）。
// production runtime からの import は 0 本（Stage 2 は shadow implementation）。

import type { ActivityData } from '@/types/activity';
import type { NgWordIssue } from '@/lib/detectNgWords';
import type { StructureAnalysis } from '@/lib/structureAnalysis';
import type { ThemeFrequency } from '@/types/divergence';
import type { StudentProfile } from '@/types/studentProfile';
import type {
  InterviewQuestionMaterials,
} from '@/lib/interview/buildInterviewQuestionMaterials';

import { buildBasicInfoPromptSection, buildSubjectGradesPromptLines } from '@/lib/buildBasicInfoPromptSection';
import { buildUniversityContextPromptSection } from '@/lib/buildUniversityContext';
import { buildStatementUniversityContext } from '@/lib/statement/review/buildStatementUniversityContext';
import { buildStatementStudentProfileContext } from '@/lib/contextBuilders/statementContext';
import { buildInterviewStudentProfileContext } from '@/lib/contextBuilders/interviewContext';
import { buildMatchingStudentProfileContext } from '@/lib/contextBuilders/matchingContext';
import { buildPreviousOutputSummarySection } from '@/lib/contextBuilders/divergence/previousOutputSummarySection';
import { buildThemeFrequencySection } from '@/lib/contextBuilders/divergence/themeFrequencySection';
import { buildUnusedExperienceSection } from '@/lib/contextBuilders/divergence/unusedExperienceSection';
import { buildInterviewQuestionMaterials } from '@/lib/interview/buildInterviewQuestionMaterials';
import { formatInterviewApplicantTypeHint } from '@/lib/interview/applicantTypeHint';
import { buildTutorStudentContext } from '@/lib/contextBuilders/tutorStudentContext';
import { buildTutorStudentContextSection } from '@/lib/tutor/tutorPrompt';
import { toStudentProfile } from '@/lib/studentProfile';

import type { ExamContextInput, ExamNotServerCapableSlot } from '../orchestrator/input';
import type { ExamContextOrigin } from '../types';
import type { ExamSourceKind } from '../sourceData/types';
import { EXAM_CONTEXT_BLOCK_IDS, createExamContextBlock } from './types';
import type { ExamContextBlock, ExamContextBlockId } from './types';
import { EXAM_CONTEXT_BLOCK_REGISTRY } from './registry';

/** legacy `lib/contextBuilders/tutorContext.ts:MAX_SUMMARY_LENGTH` と同値。 */
const DIAGNOSIS_TYPE_HINT_MAX_CHARS = 120;

// ── Layer 2 entry ─────────────────────────────────────────────────────

/**
 * 入力から全 block を組み立てる（Layer 2）。
 *
 * 返すのは「作れた block だけ」ではなく **全 block**。作れなかったものは
 * presence='missing' / 'empty' の block として返す。purpose による除外は
 * ここでは行わない（selection の責務）。
 */
export function buildExamContextBlocks(
  input: ExamContextInput,
): readonly ExamContextBlock[] {
  const contents = buildBlockContents(input);
  return EXAM_CONTEXT_BLOCK_IDS.map((id) => {
    const meta = EXAM_CONTEXT_BLOCK_REGISTRY[id];
    return createExamContextBlock(id, meta, contents[id], resolveBlockOrigin(input, id, meta.sourceKind));
  });
}

/**
 * block 1 個の origin を決める（E-S26 / Canon §17）。
 *
 * 優先順位:
 *   1. その block が `notServerCapableSlots` に挙がった slot 由来 → 'not_server_capable'
 *   2. block の `sourceKind` について `origins` に申告がある → その値
 *   3. それ以外 → `input.origin`（既定 'bridge'）
 *
 * ★ ここで origin を **推測しない**。申告が無い kind に対して
 *   「server 経路があるはずだから server」と補完すると、Canon §17 が禁じる
 *   暗黙的 Mixed-Origin を Spine 自身が作ることになる。
 */
function resolveBlockOrigin(
  input: ExamContextInput,
  id: ExamContextBlockId,
  sourceKind: ExamSourceKind | undefined,
): ExamContextOrigin {
  const fallback = input.origin ?? 'bridge';
  const slot = NOT_SERVER_CAPABLE_BLOCKS[id];
  if (slot && input.notServerCapableSlots?.includes(slot)) return 'not_server_capable';
  if (!sourceKind) return fallback;
  return input.origins?.[sourceKind] ?? fallback;
}

/**
 * durable source を持たない slot に由来する block の対応表（E-P3）。
 *
 * `statement_summary` は buildInterviewQuestionMaterials が `statementDraft`
 * （localStorage 専用・durable table 無し）から作る section であり、
 * server 経路が存在しない構造的 bridge である。
 * ★ 「今 server から取れていない」ではなく「**取れる先が無い**」ものだけを載せる。
 */
const NOT_SERVER_CAPABLE_BLOCKS: Partial<
  Record<ExamContextBlockId, ExamNotServerCapableSlot>
> = {
  statement_summary: 'statementDraft',
};

/** id → content（null = source 未提供）。 */
function buildBlockContents(
  input: ExamContextInput,
): Record<ExamContextBlockId, string | null> {
  // interview_questions 系の 4 block は既存の共有 builder が一括で素材化するため、
  // ここで 1 度だけ呼んで使い回す（同じ compress ロジックを Spine 側に写経しない）。
  const materials = hasInterviewMaterialInput(input)
    ? buildInterviewQuestionMaterials({
        basicInfo: input.basicInfo ?? null,
        statementDraft: input.statementDraft ?? null,
        studentProfile: input.studentProfile ?? null,
        activitySummary: input.activitySummary ?? null,
      })
    : null;

  const studentProfile = resolveStudentProfile(input);

  return {
    // ── 基本情報 ────────────────────────────────────────────────
    // basicInfo が無くても legacy は 【生徒の基本情報】（未登録） を必ず出す。
    // したがって block も常に present になる（§Empty / Missing semantics のとおり
    // 「legacy が placeholder を出すなら Spine も同じ placeholder」）。
    basic_profile: buildBasicInfoPromptSection(input.basicInfo ?? null),
    subject_grades: joinLinesOrEmpty(
      buildSubjectGradesPromptLines(input.basicInfo?.subjectGrades),
    ),
    applicant_profile_basics: materials ? buildApplicantProfileBasics(materials) : null,

    // ── 大学・受験方式 ──────────────────────────────────────────
    university_context: buildUniversityContextPromptSection(input.universityContext ?? null),
    statement_university_context: input.statementTarget
      ? buildStatementUniversityContext(input.statementTarget)
      : null,
    interview_university_context: input.interviewUniversityContext ?? null,
    essay_university_context: input.essayUniversityContext ?? null,
    admission_focus: input.admissionFocusContext ?? null,
    exam_type_guidance_statement: input.basicInfo
      ? buildExamTypeStatementGuidance(input.basicInfo.examTypes)
      : null,
    exam_type_guidance_interview: input.interviewExamTypeGuidance ?? null,

    // ── 活動 ────────────────────────────────────────────────────
    activity_text: input.activityText ?? null,
    activity_context:
      input.activityData === undefined
        ? null
        : buildActivityContext(input.activityData, '【活動概要】'),
    // ★ matching は同じ行構成の activity section を heading だけ変えて **別実装**している
    //   （lib/matching/matchingPrompt.ts:buildActivityContext）。Stage 2 は挙動を変えないため
    //   block を分けて事実として記録する。統合は prompt byte が変わるので Stage 6 以降の判断。
    activity_context_matching:
      input.activityData === undefined
        ? null
        : buildActivityContext(input.activityData, '【活動整理の概要】'),
    activity_summary: materials ? materials.activitySummary ?? '' : null,

    // ── 自己理解 ────────────────────────────────────────────────
    self_analysis_statement: studentProfile
      ? buildStatementStudentProfileContext(studentProfile)
      : null,
    self_analysis_interview: studentProfile
      ? buildInterviewStudentProfileContext(studentProfile)
      : null,
    self_analysis_matching: studentProfile
      ? buildMatchingStudentProfileContext(studentProfile)
      : null,
    self_analysis_questions: materials ? buildSelfAnalysisQuestionsSection(materials) : null,

    // ── divergence ──────────────────────────────────────────────
    previous_output_summary:
      input.previousOutputSummary === undefined
        ? null
        : buildPreviousOutputSummarySection(input.previousOutputSummary),
    theme_frequency:
      input.themeFrequency === undefined
        ? null
        : buildThemeFrequencySection(input.themeFrequency),
    theme_frequency_questions:
      input.themeFrequency === undefined
        ? null
        : buildThemeFrequencyQuestionSection(input.themeFrequency),
    unused_experience:
      input.unusedExperience === undefined
        ? null
        : buildUnusedExperienceSection(input.unusedExperience),

    // ── 決定論解析 ──────────────────────────────────────────────
    ng_issues:
      input.ngIssues === undefined ? null : buildNgIssuesSection(input.ngIssues ?? undefined),
    structure_analysis:
      input.structureAnalysis === undefined
        ? null
        : buildStructureAnalysisSection(input.structureAnalysis ?? undefined),

    // ── 横断要約 ────────────────────────────────────────────────
    // 活動: カテゴリ別件数の 1 行表現。legacy の「・活動整理には、…」の値部分。
    activity_category_counts: input.activityCategoryCounts ?? null,

    // 診断: hint 1 文をそのまま content にする。
    // legacy と同じ 120 字 cap を掛ける（tutorContext の MAX_SUMMARY_LENGTH と同値。
    // 現行の hint はすべて 120 字未満なので実質 no-op だが、parity のために残す）。
    diagnosis_type_hint: input.diagnosisTypeHint
      ? input.diagnosisTypeHint.slice(0, DIAGNOSIS_TYPE_HINT_MAX_CHARS)
      : null,

    // 面接: 課題 1 行をそのまま content にする。
    // ★ ここで truncate / join / slice を足さない ★
    //   3 件 / 80 字 / 500 字の整形は `buildInterviewLine`（legacy の正本）が
    //   済ませている。ここで再度掛けると二重整形になり legacy と byte がずれる。
    interview_issue_line: input.interviewIssueLine ?? null,

    // プレゼン: 要約行をそのまま content にする。
    // ★ ここで truncate / join / slice を足さない ★
    //   件数・字数・カテゴリラベル・行連結は tutorPresentationSection（legacy の正本）が
    //   済ませている。再度掛けると二重整形になり legacy と byte がずれる。
    presentation_result_summary: input.presentationResultSummary ?? null,

    tutor_student_context: input.tutorSources
      ? buildTutorStudentContextSection(buildTutorStudentContext(input.tutorSources))
      : null,

    // ── feature 入力 ────────────────────────────────────────────
    statement_target: input.statementTarget
      ? buildStatementTargetSection(input.statementTarget)
      : null,
    statement_summary: materials ? materials.statementSummary ?? '' : null,
    statement_body: input.statementBody ?? null,
    self_pr_body: input.selfPrBody ?? null,
    analysis_result: input.analysis ? buildAnalysisResultSection(input.analysis) : null,
    analysis_qa: input.analysis
      ? buildAnalysisQaSection(input.analysis.questions, input.answers ?? [])
      : null,
    deep_answers:
      input.deepAnswers === undefined ? null : buildDeepAnswersSection(input.deepAnswers),
    free_memo: input.freeMemo === undefined ? null : (input.freeMemo ?? '').trim(),
    existing_questions: input.existingQuestions
      ? buildExistingQuestionsBody(input.existingQuestions)
      : null,
    question_variation_seed:
      input.dailySeed === undefined ? null : buildQuestionVariationSection(input.dailySeed),
  };
}

// ── 共有 helper ───────────────────────────────────────────────────────

function joinLinesOrEmpty(lines: readonly string[]): string {
  return lines.length > 0 ? lines.join('\n') : '';
}

function hasInterviewMaterialInput(input: ExamContextInput): boolean {
  return (
    input.basicInfo !== undefined ||
    input.statementDraft !== undefined ||
    input.activitySummary !== undefined
  );
}

/**
 * StudentProfile の canonical 経路（statement_review の legacy と同じ優先順位）:
 *   1. 明示的に渡された studentProfile
 *   2. wallHittingResult から toStudentProfile() で派生（後方互換）
 *   3. どちらも無ければ null
 *
 * ★ legacy は `toStudentProfile(result)` を options 無しで呼ぶため内部で new Date() が走る。
 *   Stage 2 は純関数でなければならないので `projectionNow` を必須にしている。
 *   生成される differences は `generatedAt` / `sourceHash` だけで、self_analysis_* の
 *   どの block builder もこの 2 field を読まないため prompt byte は変わらない。
 */
function resolveStudentProfile(input: ExamContextInput): StudentProfile | null {
  if (input.studentProfile) return input.studentProfile;
  if (!input.wallHittingResult) return null;
  if (!input.projectionNow) {
    // 純関数性を壊さないため、時刻の注入が無い派生は行わない（黙って new Date() に倒さない）。
    return null;
  }
  return toStudentProfile(input.wallHittingResult, { now: input.projectionNow });
}

// ── legacy module-private helper の写経 ───────────────────────────────
//
// ★ 以下は export されていない legacy helper と **byte 単位で同一**でなければならない。
//   legacy 側に export を足す変更は production diff になるため行わない（Stage 2 の HARD BOUNDARY）。
//   一致は scripts/exam-spine-stage2-check.ts の byte-equivalence で機械的に守られる。

/** 写経元: lib/statement/review/statementPrompt.ts:buildExamTypeStatementGuidance */
function buildExamTypeStatementGuidance(examTypes: string[] | undefined): string {
  const types = examTypes ?? [];
  const rules: string[] = [];

  if (types.includes('総合型選抜（AO入試）')) {
    rules.push('- 総合型選抜（AO）対策として、活動経験・将来目標・学びたい内容の一貫性を厳しめにチェックする。一貫性が弱ければ weaknesses に明記する。');
  }
  if (types.includes('学校推薦型選抜（公募・指定校）')) {
    rules.push('- 学校推薦型選抜対策として、評定平均・学校生活・推薦理由との自然な接続を評価する。校内活動への言及があると加点要素として扱う。');
  }
  if (types.includes('一般選抜') || types.includes('共通テスト利用')) {
    rules.push('- 一般選抜（共通テスト利用を含む）も併願しているため、推薦・総合型を使う理由が不自然になっていないかをチェックする。「保険」と読める表現があれば weaknesses で指摘する。');
  }
  if (types.includes('海外大学受験')) {
    rules.push('- 海外大学受験を含むため、語学力・国際経験との接続も評価軸に加える。');
  }
  if (types.includes('まだ決まっていない')) {
    rules.push('- 受験方式が未確定のため、特定方式に偏らず汎用的に評価する。');
  }
  if (rules.length === 0) return '';
  return ['【受験方式に応じた添削方針】', ...rules].join('\n');
}

/**
 * 写経元: lib/statement/review/statementPrompt.ts:buildActivityContext
 *         lib/matching/matchingPrompt.ts:buildActivityContext
 *
 * ★ 上記 2 つは行の作り方が完全に同一で heading だけが違う（【活動概要】/【活動整理の概要】）。
 *   legacy の重複実装をここで 1 本にまとめるが、**heading は呼び分けて挙動を変えない**。
 */
function buildActivityContext(data: ActivityData | null, heading: string): string {
  if (!data) return '';
  const lines: string[] = [];
  if (data.clubActivities?.length) lines.push(`部活: ${data.clubActivities.map((a) => a.clubName).filter(Boolean).join('・') || `${data.clubActivities.length}件`}`);
  if (data.volunteerActivities?.length) lines.push(`ボランティア: ${data.volunteerActivities.length}件`);
  if (data.researchActivities?.length) lines.push(`探究: ${data.researchActivities.map((a) => a.theme).filter(Boolean).join('・') || `${data.researchActivities.length}件`}`);
  if (data.studyAbroadActivities?.length) lines.push(`留学: ${data.studyAbroadActivities.length}件`);
  if (data.contestActivities?.length) lines.push(`コンテスト: ${data.contestActivities.length}件`);
  if (data.certificationActivities?.length) lines.push(`資格: ${data.certificationActivities.map((a) => a.certificationName).filter(Boolean).join('・') || `${data.certificationActivities.length}件`}`);
  if (data.otherActivities?.length) lines.push(`その他: ${data.otherActivities.map((a) => a.activityName).filter(Boolean).join('・') || `${data.otherActivities.length}件`}`);
  if (lines.length === 0) return '';
  return [heading, ...lines].join('\n');
}

/** 写経元: lib/statement/review/statementPrompt.ts:buildNgIssuesSection */
function buildNgIssuesSection(issues: NgWordIssue[] | undefined): string {
  if (!issues || issues.length === 0) return '';
  const lines = issues.map((i) => `- 「${i.phrase}」：${i.reason}`);
  return [
    '【既知のNG指摘候補】',
    '以下は deterministic ルールベース検出器が既に判定済みの NG パターンです。これらを再判定するのではなく、改善提案や深い構造分析に注力してください。',
    '',
    ...lines,
  ].join('\n');
}

/** 写経元: lib/statement/review/statementPrompt.ts:buildStructureAnalysisSection */
function buildStructureAnalysisSection(analyses: StructureAnalysis[] | undefined): string {
  if (!analyses || analyses.length === 0) return '';
  const lines = analyses.map((a) => `${a.type}: ${a.score}`);
  return [
    '【既存構造分析】',
    '',
    ...lines,
    '',
    '以下は deterministic 構造分析結果です。',
    'これらを再判定するのではなく、改善提案や具体例作成に注力してください。',
  ].join('\n');
}

/**
 * 写経元: lib/prompts/additionalQuestionsPrompt.ts:buildThemeFrequencyQuestionSection
 *
 * ★ themeFrequencySection.ts（改善提案文脈）とは文言も目的も別物なので流用しない。
 *   legacy 側も同じ理由で local helper にしている。
 */
const THEME_FREQUENCY_MIN_DOCUMENTS = 3;
const THEME_FREQUENCY_MAX_OVERUSED = 3;

function buildThemeFrequencyQuestionSection(
  freq: ThemeFrequency | null | undefined,
): string {
  if (!freq) return '';
  const documentsConsidered = freq.basis?.documentsConsidered ?? 0;
  if (documentsConsidered < THEME_FREQUENCY_MIN_DOCUMENTS) return '';
  const themes = Array.isArray(freq.themes) ? freq.themes : [];
  const underused = Array.isArray(freq.underused) ? freq.underused : [];
  if (underused.length === 0) return '';

  const overused = themes
    .filter((t) => t.count > 0)
    .slice(0, THEME_FREQUENCY_MAX_OVERUSED)
    .map((t) => t.theme);

  const lines: string[] = ['【テーマ探索の参考】', ''];
  lines.push('以下は活動データから見えるテーマの頻度です（質問生成の参考情報）。');
  lines.push('');
  if (overused.length > 0) {
    lines.push('よく出ているテーマ:');
    lines.push(...overused.map((t) => `- ${t}`));
    lines.push('');
  }
  lines.push('まだ十分に掘られていないテーマ:');
  lines.push(...underused.map((t) => `- ${t}`));
  lines.push('');
  lines.push('・これらは質問生成の参考情報であり、本人の強みを断定するものではありません。');
  lines.push('・存在しない経験・強みを前提にしないでください。');
  lines.push(
    '・「まだ十分に掘られていないテーマ」は、本人の活動データから自然に接続できる場合のみ深掘り質問にしてください。接続できない場合は無視してください。',
  );
  lines.push('・活動データに登場しない情報を質問に書き込まないでください（generic 質問禁止・上記の質問品質要件を維持）。');
  return lines.join('\n');
}

/** 写経元: lib/interview/buildInterviewQuestionPrompt.ts（受験生情報 section） */
function buildApplicantProfileBasics(materials: InterviewQuestionMaterials): string {
  return [
    '【受験生情報】',
    `大学：${materials.university ?? 'なし'}`,
    `学部：${materials.faculty ?? 'なし'}`,
    `学科：${materials.department ?? 'なし'}`,
    `受験方式：${
      materials.examTypes.length > 0 ? materials.examTypes.join(' / ') : 'なし'
    }`,
  ].join('\n');
}

/** 写経元: lib/interview/buildInterviewQuestionPrompt.ts:buildSelfAnalysisSection */
function buildSelfAnalysisQuestionsSection(materials: InterviewQuestionMaterials): string {
  const { strengths, interests, futureGoals, applicantType } = materials;
  const lines: string[] = ['【自己分析サマリー】'];

  const hasAnyAnalysis =
    strengths.length > 0 || interests.length > 0 || futureGoals.length > 0;
  if (!hasAnyAnalysis) {
    lines.push('自己分析サマリーなし');
  } else {
    if (strengths.length > 0) {
      lines.push('強み:');
      for (const s of strengths) lines.push(`・${s}`);
    }
    if (interests.length > 0) {
      lines.push('興味・関心タグ:');
      for (const s of interests) lines.push(`・${s}`);
    }
    if (futureGoals.length > 0) {
      lines.push('将来とのつながり:');
      for (const s of futureGoals) lines.push(`・${s}`);
    }
  }

  if (applicantType) {
    lines.push(formatInterviewApplicantTypeHint(applicantType));
  }

  return lines.join('\n');
}

/** 写経元: lib/interview/buildInterviewQuestionPrompt.ts（出題バリエーション指示 v5） */
function buildQuestionVariationSection(dailySeed: string | null | undefined): string {
  const trimmedSeed = typeof dailySeed === 'string' ? dailySeed.trim() : '';
  if (trimmedSeed === '') return '';
  return [
    '【出題バリエーション指示（personalized の主題選び）】',
    `本日の出題シード：${trimmedSeed}`,
    '本指示は personalized 5 問の「主題の選び方」と「切り口」だけを seed に応じて少しずらすためのもの。【件数ルール】【personalized の方針（観点最低 1 問ずつ）】【category / sourceHint の許可値】【authenticity_check の作り方】【代筆禁止の最重要ルール】は完全に維持する。',
    '',
    '【固定重要枠（seed に依らず毎回必ず含める）】',
    '・志望理由 / 大学理解 / 将来像（既に personalized の必須 category として確定済み）。',
    '・「最重要エピソード」を主題にした質問を最低 1 問。',
    '  - 最重要エピソードの判定: 志望理由書サマリー / 活動サマリー / 自己分析サマリー の 2 つ以上で繰り返し参照される、または最も詳細に語られている本人エピソードのこと。',
    '  - 明確に特定できない場合は、「最も志望理由と接続度が高い本人エピソード」を代替指定とする。',
    '',
    '【日替わり深掘り枠（seed に応じて主題と問い方を少し動かす）】',
    '・本人材料に複数のエピソード（部活 / 留学 / 探究活動 / ボランティア / 資格 / 課外活動 / 失敗経験 等）がある場合、seed をハッシュ的に解釈してその日の主要 deep-dive 対象を 1 つ選ぶ。',
    '・activity / consistency_check / self_analysis 系の personalized 質問の anchor を、当日 deep-dive 対象寄りに調整する。',
    '・同じエピソードでも日によって angle を変える: 時系列 / 判断軸 / 失敗と修正 / 他者との衝突 / 動機の変化 / 学びと現在への接続 など。',
    '・seed は「どの活動を deep-dive するか」だけでなく、SYSTEM 側【personalized の問い方（観点）の分散】の観点バンクから、その日 5 問に割り当てる観点の組み合わせ・順序を回すためにも使う。前日と同じ観点の組に寄せず、別の組を選ぶ。',
    '・ただし観点を変えても、固定重要枠（志望理由 / 大学理解 / 将来像 / 最重要エピソード最低 1 問）と必須 category は維持する。',
    '',
    '【接続確認枠（毎回必ず含める）】',
    '・当日 deep-dive 対象として扱った経験を、志望理由 / 学部適性 / 将来像 のいずれかに接続させる consistency_check 質問を最低 1 問。',
    '',
    '【偏りと喪失の禁止】',
    '・personalized 5 問のうち、単一活動だけを扱う質問が 3 問を超えてはならない（「今日は部活だけ」「明日は留学だけ」のような偏りを禁止）。',
    '・同じ問い方（観点）の質問が 3 問を超えてはならない（活動の偏りだけでなく、問い方の偏り・「成長/学び」系への収束も禁止）。',
    '・最重要エピソードを日替わりで personalized から完全に消去してはならない。当日の deep-dive 対象から外れていても、最低 1 問は最重要エピソードを扱う。',
    '・本人材料に無い活動・経験を seed に合わせて捏造しない（素材外の新規エピソードを持ち込まない）。',
    '・seed そのもの（日付の数値文字列）を question / answerTip / intent / sourceHint に書かない。seed は AI 内部の主題選び基準としてのみ使う。',
  ].join('\n');
}

/** 写経元: lib/statement/review/statementPrompt.ts:buildStatementReviewPrompt（【今回の添削対象】） */
function buildStatementTargetSection(target: {
  university: string;
  faculty: string;
  department: string;
}): string {
  const departmentLine = target.department ? `\n志望学科：${target.department}` : '';
  return `【今回の添削対象】\n志望大学：${target.university || '（未入力）'}\n志望学部：${
    target.faculty || '（未入力）'
  }${departmentLine}`;
}

/** 写経元: lib/prompts/summarizePrompt.ts:buildSummarizePrompt（【AI分析】） */
function buildAnalysisResultSection(analysis: {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  futureConnections: string[];
}): string {
  return `【AI分析】\n活動の要約: ${analysis.summary}\n強み: ${analysis.strengths.join(
    '・',
  )}\n弱み・補強ポイント: ${analysis.weaknesses.join(
    '・',
  )}\n将来とのつながり: ${analysis.futureConnections.join('・')}`;
}

/** 写経元: lib/prompts/summarizePrompt.ts:buildSummarizePrompt（【深掘り質問と回答】） */
function buildAnalysisQaSection(
  questions: readonly string[],
  answers: readonly string[],
): string {
  const qa = questions
    .map((q, i) => `Q${i + 1}: ${q}\nA${i + 1}: ${answers[i]?.trim() || '（未回答）'}`)
    .join('\n\n');
  return `【深掘り質問と回答】\n${qa}`;
}

/** 写経元: lib/prompts/summarizePrompt.ts:buildSummarizePrompt（【受験生の追加深掘りメモ】） */
function buildDeepAnswersSection(deepAnswers: readonly string[] | null): string {
  const deepEntries = (deepAnswers ?? [])
    .map((d, idx) => ({ idx, text: (d ?? '').trim() }))
    .filter((e) => e.text !== '');
  if (deepEntries.length === 0) return '';
  const deepText = deepEntries
    .map((e) => `Q${e.idx + 1} に対する追加メモ: ${e.text}`)
    .join('\n');
  return `【受験生の追加深掘りメモ】\n${deepText}`;
}

/** 写経元: lib/prompts/additionalQuestionsPrompt.ts:buildAdditionalQuestionsPrompt（既出質問の本文） */
function buildExistingQuestionsBody(existingQuestions: readonly string[]): string {
  return existingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n');
}
