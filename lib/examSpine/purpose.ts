// PASSAI 受験版 Exam Spine — Purpose Registry（Stage 1 / 静的宣言のみ）。
//
// 「どの feature（purpose）で、どの context をどの程度 AI に渡しているか」を 1 箇所で宣言する。
// 純粋な型・定数のみ（I/O / env / secret / Supabase read なし）。
//
// ★★ Stage 1 の最重要ルール ★★
//   本 registry は **現行挙動の宣言**である。「将来こうしたい」ではない。
//   各値は現行の API route / prompt builder を実際に読んで決めている（推測禁止）。
//   registry は route の挙動を **一切強制しない**。Stage 1 の production runtime diff = 0。
//
//   例外は `profileTarget` の 1 field だけで、これは E-P4（氏名を後続 Stage で prompt から
//   落とす）の target を **現在値と混同しないよう別 field として**持つためにある。
//
// Upstream architecture reference（コードはコピーしない・runtime 依存も作らない）:
//   /Users/yk/PASSAI-CAREER/lib/careerContext/purpose.ts
//
// 関連 Decision: E-P4（氏名の prompt 除外）/ E-P7（移行時に context を減らさない）/
//               E-S10（quota / billing は Spine の外）。

import type { ExamContextPurpose } from './types';
import { EXAM_CONTEXT_BUDGETS } from './budget';

// ── Inclusion 語彙 ────────────────────────────────────────────────────

/**
 * 基本情報（BasicInfo 由来 section）の扱い。
 *   include … basicInfoPromptSection 相当を **氏名込み**で載せる（現行 11 route）。
 *   minimal … 基本情報は載せるが **氏名（構造化 PII）を含めない**。
 *   exclude … 基本情報を載せない。
 */
export type ProfileInclusion = 'include' | 'minimal' | 'exclude';

/**
 * 活動整理データの扱い。
 *   compact … 活動データ本体を整形して載せる（formatActivityData / buildActivityContext）。
 *   minimal … 活動由来の派生要約だけを載せる（activitySummary / unusedExperience 等）。
 *   exclude … 活動データを載せない。
 */
export type ActivityInclusion = 'compact' | 'minimal' | 'exclude';

/**
 * 他機能の直近成果（横断ログ）の扱い。
 *   include … 志望理由書添削履歴 / 面接記録 / 小論文レビュー履歴などを載せる。
 *   exclude … 載せない（同一 feature 内の状態は「横断ログ」に数えない）。
 */
export type LogsInclusion = 'include' | 'exclude';

/**
 * 大学情報の扱い。
 *   include         … 志望校 / 大学 DB 由来 section を載せる。
 *   admission_focus … 上記に加えて admissionFocus context を載せる。
 *   exclude         … 載せない。
 */
export type UniversityInclusion = 'include' | 'admission_focus' | 'exclude';

/** purpose ごとの context 方針（Stage 1 では宣言のみ・強制しない）。 */
export type ExamContextPolicy = {
  profile: ProfileInclusion;
  activity: ActivityInclusion;
  /** StudentProfile / WallHittingResult 由来の自己理解 section。 */
  selfUnderstanding: 'include' | 'exclude';
  recentLogs: LogsInclusion;
  university: UniversityInclusion;
  /** budget.ts が正本。ここは読み出し（値の二重管理を避ける）。 */
  maxContextChars: number;
  /**
   * E-P4 の target。現在値（`profile`）と **混同しない**ために別 field にしている。
   * 現状 `profile: 'include'`（＝氏名が prompt に乗っている）purpose にだけ付く。
   * Stage 1 では通電しない。実施は PROMPT_VERSION bump と同一 commit で行う（E-P4）。
   */
  profileTarget?: ProfileInclusion;
  notes?: string;
};

const B = EXAM_CONTEXT_BUDGETS;

// ── Registry ──────────────────────────────────────────────────────────
//
// 各 purpose の対応 route（監査済み）:
//   self_analysis             app/api/analysis/route.ts
//   self_analysis_additional  app/api/analysis/additional/route.ts
//   summarize                 app/api/summarize/route.ts
//   statement_prepare         app/api/statement-prepare/route.ts
//   statement_review          app/api/statement-review/route.ts
//   essay_themes              app/api/essay-themes/route.ts
//   essay_review              app/api/essay-review/route.ts
//   essay_chat                app/api/essay-chat/route.ts
//   essay_deep_questions      app/api/essay-deep-questions/route.ts
//   essay_improve_summary     app/api/essay-improve-summary/route.ts
//   interview_questions       app/api/interview-questions/route.ts
//   interview_feedback        app/api/interview-feedback/route.ts
//   interview_ai              app/api/interview-ai/{session,turn,complete}/route.ts
//   presentation_feedback     app/api/presentation/{theme,evaluate,qa}/route.ts
//   matching                  app/api/matching/route.ts
//   self_pr                   app/api/reason/route.ts
//   tutor                     app/api/tutor/route.ts
export const EXAM_CONTEXT_REGISTRY: Readonly<
  Record<ExamContextPurpose, ExamContextPolicy>
> = {
  self_analysis: {
    profile: 'include',
    profileTarget: 'minimal',
    activity: 'compact',
    selfUnderstanding: 'exclude',
    recentLogs: 'exclude',
    university: 'include',
    maxContextChars: B.self_analysis.maxContextChars,
    notes:
      '壁打ち分析。buildWallHittingPrompt に basicInfo（氏名込み）/ universityContext / formatActivityData(activityText) を渡す。この route は StudentProfile を **生成する側**なので selfUnderstanding は載らない。',
  },
  self_analysis_additional: {
    profile: 'include',
    profileTarget: 'minimal',
    activity: 'compact',
    selfUnderstanding: 'exclude',
    recentLogs: 'exclude',
    university: 'include',
    maxContextChars: B.self_analysis_additional.maxContextChars,
    notes:
      '追加質問生成。self_analysis と同構成 + themeFrequency（activityData のみから決定論派生。route が studentProfile: null を明示的に渡すため selfUnderstanding は exclude）。existingQuestions は同一 feature 内の状態。',
  },
  summarize: {
    profile: 'include',
    profileTarget: 'minimal',
    activity: 'compact',
    selfUnderstanding: 'exclude',
    recentLogs: 'exclude',
    university: 'include',
    maxContextChars: B.summarize.maxContextChars,
    notes:
      '壁打ち要約。self_analysis と同構成。analysis / answers / freeMemo は feature 入力。出力（SummaryResult）が toStudentProfile の材料になる。',
  },
  statement_prepare: {
    profile: 'exclude',
    activity: 'exclude',
    selfUnderstanding: 'exclude',
    recentLogs: 'exclude',
    university: 'include',
    maxContextChars: B.statement_prepare.maxContextChars,
    notes:
      '志望理由書 整理メモ。Spine 由来は buildStatementUniversityContext() の大学 DB section のみ。基本情報 section も StudentProfile も載せない（現行の実装どおり）。',
  },
  statement_review: {
    profile: 'include',
    profileTarget: 'minimal',
    activity: 'compact',
    selfUnderstanding: 'include',
    recentLogs: 'include',
    university: 'include',
    maxContextChars: B.statement_review.maxContextChars,
    notes:
      '志望理由書 添削。basicInfo（氏名込み）/ activityData / canonical studentProfile（無ければ wallHittingResult から派生）/ 大学 DB section / previousOutputSummary / themeFrequency。admissionFocusContext は **未接続**（route の PR9 marker。接続済みなのは interview_feedback のみ）。',
  },
  essay_themes: {
    profile: 'include',
    profileTarget: 'minimal',
    activity: 'exclude',
    selfUnderstanding: 'exclude',
    recentLogs: 'exclude',
    university: 'include',
    maxContextChars: B.essay_themes.maxContextChars,
    notes:
      '小論文テーマ生成。basicInfoPromptSection + 志望校 label + アドミッションポリシー + カテゴリ bias。既出テーマ / 既出カテゴリは同一 feature 内の状態。',
  },
  essay_review: {
    profile: 'include',
    profileTarget: 'minimal',
    activity: 'exclude',
    selfUnderstanding: 'exclude',
    recentLogs: 'include',
    university: 'include',
    maxContextChars: B.essay_review.maxContextChars,
    notes:
      '小論文 添削。basicInfoPromptSection + buildEssayUniversityContext(basicInfo.preferences[0] 由来) + examTypeGuidance + previousOutputSummary（過去レビュー履歴＝横断ログ）。',
  },
  essay_chat: {
    profile: 'include',
    profileTarget: 'minimal',
    activity: 'exclude',
    selfUnderstanding: 'exclude',
    recentLogs: 'exclude',
    university: 'include',
    maxContextChars: B.essay_chat.maxContextChars,
    notes:
      '小論文 相談。basicInfoPromptSection + buildEssayUniversityContext のみ。履歴 section は無い。',
  },
  essay_deep_questions: {
    profile: 'include',
    profileTarget: 'minimal',
    activity: 'exclude',
    selfUnderstanding: 'exclude',
    recentLogs: 'exclude',
    university: 'exclude',
    maxContextChars: B.essay_deep_questions.maxContextChars,
    notes:
      '小論文 深掘り質問。basicInfoPromptSection のみ。大学 DB section を **持たない**（sibling の essay_review / essay_chat とはここが異なる）。previousFeedback / existingQuestions は同一 feature 内の状態。',
  },
  essay_improve_summary: {
    profile: 'include',
    profileTarget: 'minimal',
    activity: 'exclude',
    selfUnderstanding: 'exclude',
    recentLogs: 'exclude',
    university: 'exclude',
    maxContextChars: B.essay_improve_summary.maxContextChars,
    notes:
      '小論文 改善方針要約。basicInfoPromptSection のみ。works / deepQuestions / answers は同一 feature 内の入力。',
  },
  interview_questions: {
    // ★ 現時点で既に氏名を載せていない。buildInterviewQuestionMaterials は
    //   basicInfo から examTypes / subjectGrades / preferences しか取らない。
    profile: 'minimal',
    activity: 'minimal',
    selfUnderstanding: 'include',
    recentLogs: 'include',
    university: 'include',
    maxContextChars: B.interview_questions.maxContextChars,
    notes:
      '面接 質問生成。buildInterviewQuestionMaterials（basicInfo は氏名を取らない / activitySummary は 800 字圧縮 / studentProfile の strengths・valueKeywords・futureConnections・applicantType / statementDraft 本文 1200 字圧縮）+ buildInterviewUniversityContext。admissionFocus は route が意図的に非接続（PR8b marker）。statementDraft は structural bridge（E-P3）。',
  },
  interview_feedback: {
    profile: 'include',
    profileTarget: 'minimal',
    activity: 'minimal',
    selfUnderstanding: 'include',
    recentLogs: 'include',
    university: 'admission_focus',
    maxContextChars: B.interview_feedback.maxContextChars,
    notes:
      '面接 フィードバック。**admissionFocusContext が通電している唯一の route**（faculty が解決できたときのみ）。basicInfo（氏名込み）+ buildInterviewUniversityContext + interviewStudentProfileContext + previousOutputSummary + unusedExperience + 決定論 heuristic。生の activityData は受け取らず、unusedExperience（活動由来の派生）だけが載る。',
  },
  interview_ai: {
    profile: 'exclude',
    activity: 'minimal',
    selfUnderstanding: 'include',
    recentLogs: 'include',
    university: 'exclude',
    maxContextChars: B.interview_ai.maxContextChars,
    notes:
      'AI 面接。Spine 由来 context は client が組み立てた 1 本の文字列 target_ref.sourceContext に凍結されており（app/interview/ai/sourceData.ts）、中身は自己分析 + 活動行 + 志望理由書履歴/下書き + 小論文 + 面接記録。基本情報 section と大学 DB section は載らない。SD-3 / E-P5 違反の既存負債であり Stage 9 で廃止予定。',
  },
  presentation_feedback: {
    profile: 'exclude',
    activity: 'exclude',
    selfUnderstanding: 'exclude',
    recentLogs: 'exclude',
    university: 'include',
    maxContextChars: B.presentation_feedback.maxContextChars,
    notes:
      'プレゼン お題生成 / 評価 / 質疑。server_authoritative な presentation_sessions の university_name / faculty_name / theme / admission_type / presentation_format / university_notes だけを使う。学生の人格データ（基本情報 / 活動 / StudentProfile / 横断ログ）は一切載っていない。',
  },
  matching: {
    profile: 'include',
    profileTarget: 'minimal',
    activity: 'compact',
    selfUnderstanding: 'include',
    recentLogs: 'exclude',
    university: 'include',
    maxContextChars: B.matching.maxContextChars,
    notes:
      '志望校マッチング。basicInfoPromptSection（rerank prompt でも再度使う）+ buildActivityContext + matchingStudentProfileContext + universityContext section。admissionFocus は route が意図的に非接続（PR9d-2 / C2 marker）。総合スコア・順位は決定的エンジンが別計算。',
  },
  self_pr: {
    profile: 'exclude',
    activity: 'minimal',
    selfUnderstanding: 'exclude',
    recentLogs: 'exclude',
    university: 'exclude',
    maxContextChars: B.self_pr.maxContextChars,
    notes:
      '自己PR 添削（app/api/reason）。route が受け取る Spine 由来は themeFrequency と unusedExperience の 2 section のみで、いずれも client が activityData / studentProfile から決定論派生した統計である。StudentProfile 本体は prompt に載らない。なお下書き自体は client 側 buildSelfPRDraftSeed(profile, analyzeSummary) の出力をユーザーが編集したものであり、feature 入力 `text` として届く。',
  },
  tutor: {
    profile: 'include',
    profileTarget: 'minimal',
    activity: 'compact',
    selfUnderstanding: 'include',
    recentLogs: 'include',
    university: 'include',
    maxContextChars: B.tutor.maxContextChars,
    notes:
      'チューター。受験版で **唯一 server 経路を持つ** purpose（loadTutorStudentContextCached が 6 source を owner-scoped read + 60 秒 cache）。加えて body 由来の buildTutorPromptContext（intent 別）と tutorStudentContext（SYSTEM block 2）があり、同じ人格データが最大 3 経路で入る。三重投入の解消は Stage 6。',
  },
};

/** purpose に対応する policy を返す（純関数・union 全網羅のため fallback 不要）。 */
export function getExamContextPolicy(
  purpose: ExamContextPurpose,
): ExamContextPolicy {
  return EXAM_CONTEXT_REGISTRY[purpose];
}
