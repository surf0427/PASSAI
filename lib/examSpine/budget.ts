// PASSAI 受験版 Exam Spine — purpose 別 context budget（Stage 1 / 宣言のみ）。
//
// 純粋な型・定数のみ。**Stage 1 では runtime enforcement をしない**。
// ここは「purpose ごとの Spine 由来 context の上限を 1 箇所で宣言する」ための足場であり、
// 値は現行実装の実サイズから導出する（推測で置かない）。
//
// ★ 値を現行より小さくしない。E-P7（移行時に context を減らさない）に従う。
//   budget を実適用するのは後続 Stage であり、そのときも「減らす」目的では使わない。
//
// Upstream architecture reference:
//   /Users/yk/PASSAI-CAREER/lib/careerContext/purpose.ts（maxContextChars の宣言方式）

import type { ExamContextPurpose } from './types';

// ── 現行コードに実在する上限定数の写し ────────────────────────────────
//
// すべて受験版リポジトリ内の実在する定数 / 実測値である。値を変えるときは
// 参照元のコードと同時に更新すること（片側だけ動かすと budget が嘘になる）。
export const EXAM_OBSERVED_CONTEXT_CAPS = {
  /** INPUT_MAX_LENGTHS.ACTIVITY_TOTAL — lib/validation/inputLimits.ts。formatActivityData() 後の活動データ全体。 */
  activityTotal: 12000,
  /** SOURCE_CONTEXT_MAX_CHARS — app/api/interview-ai/session/route.ts。server 側の実 clip 値（client 側は 6000）。 */
  interviewAiSourceContext: 6500,
  /** MAX_TOTAL_LENGTH — lib/contextBuilders/tutorStudentContext.ts。tutor SYSTEM block 2 の総量上限。 */
  tutorStudentContext: 2500,
  /** MAX_TOTAL_LENGTH — lib/contextBuilders/tutorContext.ts。tutor の Supabase 由来 section 上限。 */
  tutorSupabaseContext: 1200,
  /** STATEMENT_TEXT_MAX_CHARS — lib/interview/buildInterviewQuestionMaterials.ts。 */
  interviewStatementSummary: 1200,
  /** ACTIVITY_SUMMARY_MAX_CHARS — 同上。 */
  interviewActivitySummary: 800,
  /** STRING_ITEM_MAX_CHARS(200) × STUDENT_PROFILE_LIST_MAX(5) × 3 list（strengths / interests / futureGoals）— 同上。 */
  interviewProfileLists: 3000,
  /** app/api/interview-feedback/route.ts の H4 marker が実測として記録している上限（~400-600）。 */
  admissionFocusContext: 600,
  /** INPUT_MAX_LENGTHS.LABEL — lib/validation/inputLimits.ts。大学 / 学部 / 学科名など。 */
  label: 200,
} as const;

// ── Budget contract ───────────────────────────────────────────────────

/**
 * purpose 1 件あたりの Spine 由来 context の宣言上限。
 *
 * 対象は **Spine 由来のブロック**（profile / activity / selfUnderstanding / recentLogs /
 * university）であり、ユーザーが今回入力した本文（志望理由書 / 小論文 / 質問と回答 /
 * チャットメッセージ）は含めない。後者は messages 側に置く feature 固有入力である。
 */
export type ExamContextBudget = {
  /** 宣言上限（文字数）。Stage 1 では強制しない。必ず finite かつ > 0。 */
  maxContextChars: number;
  /**
   * この値の性質。
   *   code_enforced … 現行コードが実際にこの値で clip / 検証している（そのまま検証に使える）。
   *   observed_only … 上限を持たない block を含むため、実測 + 構造上限からの見積り。
   *                   後続 Stage で truncation に使う前に必ず実測し直すこと。
   */
  basis: 'code_enforced' | 'observed_only';
  /** 導出根拠。どの定数 / どの実測から来た値かを必ず書く（推測でないことの記録）。 */
  derivation: string;
};

const C = EXAM_OBSERVED_CONTEXT_CAPS;

/**
 * purpose 別 budget。`purpose.ts` の EXAM_CONTEXT_REGISTRY がここから maxContextChars を読む
 * （値の二重管理を避けるため、数値の正本はこのファイル 1 箇所）。
 */
export const EXAM_CONTEXT_BUDGETS: Readonly<
  Record<ExamContextPurpose, ExamContextBudget>
> = {
  self_analysis: {
    maxContextChars: C.activityTotal + 2000,
    basis: 'observed_only',
    derivation:
      'activityText は validateAnalysisInput で ACTIVITY_TOTAL(12000) 上限。basicInfoPromptSection と universityContext には code 上限が無いため +2000 の見積り（Stage 0 fixture F1 実測 basicInfoPromptSection=256）。',
  },
  self_analysis_additional: {
    maxContextChars: C.activityTotal + 2000,
    basis: 'observed_only',
    derivation:
      'self_analysis と同構成（validateAdditionalQuestionInput も ACTIVITY_TOTAL(12000)）。existingQuestions は feature 状態であり Spine 対象外。',
  },
  summarize: {
    maxContextChars: C.activityTotal + 2000,
    basis: 'observed_only',
    derivation:
      'self_analysis と同構成（validateSummarizeInput も ACTIVITY_TOTAL(12000)）。analysis / answers / freeMemo は feature 入力であり Spine 対象外。',
  },
  statement_prepare: {
    maxContextChars: 2000,
    basis: 'observed_only',
    derivation:
      'Spine 由来は buildStatementUniversityContext() の大学 DB section のみ（app/api/statement-prepare/route.ts）。profile / activity / StudentProfile / 横断ログを一切載せない。',
  },
  statement_review: {
    maxContextChars: C.activityTotal + 4000,
    basis: 'observed_only',
    derivation:
      'activityData が最大構成（ESSAY 本文は feature 入力のため除外）。加えて basicInfoPromptSection / StudentProfile section / 大学 DB section / previousOutputSummary / themeFrequency が乗るため +4000（Stage 0 fixture 実測 statementStudentProfileContext=221 / divergencePreviousOutputSummary=159 / divergenceThemeFrequency=504）。',
  },
  essay_themes: {
    maxContextChars: 3000,
    basis: 'observed_only',
    derivation:
      'basicInfoPromptSection + 志望校 label + アドミッションポリシー + 既出テーマ(最大30件) から見積り（lib/prompts/essayThemesPrompt.ts）。活動 / StudentProfile は載らない。',
  },
  essay_review: {
    maxContextChars: 3000,
    basis: 'observed_only',
    derivation:
      'basicInfoPromptSection + buildEssayUniversityContext + examTypeGuidance + previousOutputSummary（Stage 0 fixture 実測 159）から見積り。essayBody / structureSection は feature 入力。',
  },
  essay_chat: {
    maxContextChars: 2000,
    basis: 'observed_only',
    derivation:
      'basicInfoPromptSection + buildEssayUniversityContext のみ（app/api/essay-chat/route.ts）。横断ログ無し。',
  },
  essay_deep_questions: {
    maxContextChars: 2000,
    basis: 'observed_only',
    derivation:
      'basicInfoPromptSection のみ（lib/prompts/essayDeepQuestionsPrompt.ts）。大学 DB section も横断ログも載らない。',
  },
  essay_improve_summary: {
    maxContextChars: 2000,
    basis: 'observed_only',
    derivation:
      'basicInfoPromptSection のみ（app/api/essay-improve-summary/route.ts buildUserMessage）。works / deepQuestions は feature 入力。',
  },
  interview_questions: {
    maxContextChars:
      C.interviewStatementSummary + C.interviewActivitySummary + C.interviewProfileLists + 1000,
    basis: 'observed_only',
    derivation:
      'buildInterviewQuestionMaterials の実 cap の総和（statementSummary 1200 + activitySummary 800 + strengths/interests/futureGoals 200×5×3=3000）+ subjectGradesLines / buildInterviewUniversityContext / examTypeGuidance ぶんの +1000。',
  },
  interview_feedback: {
    maxContextChars: 4000,
    basis: 'observed_only',
    derivation:
      'basicInfoPromptSection + buildInterviewUniversityContext + admissionFocusContext(実測 400-600 / route の H4 marker) + interviewStudentProfileContext(Stage 0 fixture 実測 356) + previousOutputSummary + unusedExperience + heuristicSection から見積り。questionsAndAnswers は feature 入力。',
  },
  interview_ai: {
    maxContextChars: C.interviewAiSourceContext,
    basis: 'code_enforced',
    derivation:
      'app/api/interview-ai/session/route.ts の SOURCE_CONTEXT_MAX_CHARS=6500 で server が実際に clip している（client 側 app/interview/ai/sourceData.ts は MAX_CONTEXT_CHARS=6000）。Spine context は target_ref.sourceContext 1 本に凍結されている（SD-3 / Stage 9 で廃止予定）。',
  },
  presentation_feedback: {
    maxContextChars: 2000,
    basis: 'observed_only',
    derivation:
      'presentation_sessions 由来の university_name / faculty_name / theme / admission_type / presentation_format / university_notes のみ。SHORT_FIELD_MAX_CHARS=200（app/api/presentation/session/route.ts）× 短文フィールド群 + notes から見積り。script / transcript は feature 入力。',
  },
  matching: {
    maxContextChars: 8000,
    basis: 'observed_only',
    derivation:
      'basicInfoPromptSection + buildActivityContext（matchingPrompt.ts の圧縮済み活動 section）+ matchingStudentProfileContext（Stage 0 fixture 実測 308）+ universityContext section から見積り。5 大学並列呼び出しのため 1 回あたりの base を絞っている現行構成に合わせる。',
  },
  self_pr: {
    maxContextChars: 1500,
    basis: 'observed_only',
    derivation:
      'app/api/reason/route.ts が受け取る Spine 由来は themeFrequency（Stage 0 fixture 実測 504）と unusedExperience（同 313）の 2 section のみ。本文 text は feature 入力。',
  },
  tutor: {
    maxContextChars: C.tutorStudentContext + C.tutorSupabaseContext + 2000,
    basis: 'observed_only',
    derivation:
      'tutorStudentContext の MAX_TOTAL_LENGTH=2500 と tutorContext の MAX_TOTAL_LENGTH=1200 の実 cap 合算に、buildTutorPromptContext の contextString（intent 別 / 個別 cap は lib/contextBuilders/tutor/types.ts、総量 cap は無し）ぶん +2000。',
  },
};
