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
import type { ExamSourceKind } from './sourceData/types';
import { EXAM_SOURCE_KINDS } from './sourceData/types';
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
  /**
   * ★ Purpose gate（E-S28）★
   *   この purpose が Spine から読むことを許可される Layer 1 source kind の **全集合**。
   *   ここに無い kind について reader は query を発行しない（default deny）。
   *
   *   値の決め方（推測禁止）:
   *     現行の consumer（route / client page / context builder）が **実際に材料として
   *     使っている** kind だけを列挙する。route の body field 名ではなく、
   *     その context を組み立てるために読まれている storage / table を根拠にする。
   *     根拠は必ず `sourceEvidence` に 1 kind 1 行で書く。
   *
   *   ★ 「将来読みたい」を書かない。移行で必要になったらその時に Decision を起こす。
   */
  sources: readonly ExamSourceKind[];
  /** `sources` の各 kind の根拠（実ファイル:行 または関数名）。kind 数と一致させる。 */
  sourceEvidence: Readonly<Partial<Record<ExamSourceKind, string>>>;
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
    sources: [
      'basic_info',
      'activity',
    ],
    sourceEvidence: {
      basic_info:
        'app/api/analysis/route.ts:63 body.basicInfo -> buildWallHittingPrompt（basicInfoPromptSection / universityContext）',
      activity:
        'app/api/analysis/route.ts:61 body.activityData -> formatActivityData(activityText)',
    },
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
    sources: [
      'basic_info',
      'activity',
    ],
    sourceEvidence: {
      basic_info:
        'app/api/analysis/additional/route.ts（self_analysis と同構成）',
      activity:
        'themeFrequency は activityData のみから決定論派生（route が studentProfile: null を明示）',
    },
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
    sources: [
      'basic_info',
      'activity',
    ],
    sourceEvidence: {
      basic_info:
        'app/api/summarize/route.ts（self_analysis と同構成）',
      activity:
        '同上。activityText を材料にする',
    },
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
    sources: [
      'basic_info',
    ],
    sourceEvidence: {
      basic_info:
        'app/api/statement-prepare/route.ts。buildStatementUniversityContext() の大学 DB section のみ（basicInfo.preferences 由来）',
    },
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
    sources: [
      'basic_info',
      'activity',
      'self_analysis',
      'statement_review',
      'self_pr',
      'interview_record',
    ],
    sourceEvidence: {
      basic_info:
        'app/api/statement-review/route.ts:52 body.basicInfo',
      activity:
        'app/api/statement-review/route.ts:53 body.activityData ＋ app/statement/edit/page.tsx:513 buildUnusedExperience({activityData})',
      self_analysis:
        'app/api/statement-review/route.ts:54 body.wallHittingResult / studentProfile（self_analysis_logs.analysis から再構成可能・E-L5）',
      statement_review:
        'app/statement/edit/page.tsx:482 buildPreviousOutputSummary(loadReviewHistory()) ＋ :500 usedText の h.essay',
      self_pr:
        'app/statement/edit/page.tsx:501 usedText の loadSelfPRs().text（未使用経験の除外材料）',
      interview_record:
        'app/statement/edit/page.tsx:502-504 usedText の getInterviewRecords() myAnswers / questionsAsked',
    },
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
    sources: [
      'basic_info',
    ],
    sourceEvidence: {
      basic_info:
        'app/api/essay-themes/route.ts。basicInfoPromptSection + 志望校 label + アドミッションポリシー',
    },
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
    sources: [
      'basic_info',
    ],
    sourceEvidence: {
      basic_info:
        'app/api/essay-review/route.ts。basicInfoPromptSection + buildEssayUniversityContext(basicInfo.preferences[0])',
    },
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
    sources: [
      'basic_info',
    ],
    sourceEvidence: {
      basic_info:
        'app/api/essay-chat/route.ts。basicInfoPromptSection + buildEssayUniversityContext のみ',
    },
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
    sources: [
      'basic_info',
    ],
    sourceEvidence: {
      basic_info:
        'app/api/essay-deep-questions/route.ts。basicInfoPromptSection のみ（大学 DB section を持たない）',
    },
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
    sources: [
      'basic_info',
    ],
    sourceEvidence: {
      basic_info:
        'app/api/essay-improve-summary/route.ts。basicInfoPromptSection のみ',
    },
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
    sources: [
      'basic_info',
      'activity',
      'self_analysis',
    ],
    sourceEvidence: {
      basic_info:
        'lib/interview/buildInterviewQuestionMaterials.ts（氏名は取らない）+ buildInterviewUniversityContext',
      activity:
        'buildInterviewQuestionMaterials の activitySummary（800 字圧縮）',
      self_analysis:
        'buildInterviewQuestionMaterials の studentProfile（strengths / valueKeywords / futureConnections / applicantType）',
    },
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
    sources: [
      'basic_info',
      'activity',
      'self_analysis',
      'statement_review',
      'self_pr',
      'interview_record',
    ],
    sourceEvidence: {
      basic_info:
        'app/api/interview-feedback/route.ts:172 body.basicInfo',
      activity:
        'app/interview/record/components/InterviewRecordForm.tsx:199 buildUnusedExperience({activityData: loadActivityData()})',
      self_analysis:
        'app/api/interview-feedback/route.ts:187-192 studentProfile / wallHittingResult -> interviewStudentProfileContext',
      statement_review:
        'InterviewRecordForm.tsx:191 usedText の loadReviewHistory().essay',
      self_pr:
        'InterviewRecordForm.tsx:192 usedText の loadSelfPRs().text',
      interview_record:
        'InterviewRecordForm.tsx:151 buildPreviousOutputSummary(getInterviewRecords()) ＋ :187-190 usedText',
    },
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
    sources: [
      'self_analysis',
      'activity',
      'statement_review',
      'essay',
      'interview_record',
    ],
    sourceEvidence: {
      self_analysis:
        'app/interview/ai/sourceData.ts:19 loadWallHittingResult',
      activity:
        'app/interview/ai/sourceData.ts:20 loadActivityData',
      statement_review:
        'app/interview/ai/sourceData.ts:21 loadDraft / loadReviewHistory',
      essay:
        'app/interview/ai/sourceData.ts:22 loadEssayWorkspaces',
      interview_record:
        'app/interview/ai/sourceData.ts:23 getInterviewRecords',
    },
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
    sources: [
      'presentation',
    ],
    sourceEvidence: {
      presentation:
        'app/api/presentation/{theme,evaluate,qa}/route.ts。presentation_sessions の university_name / faculty_name / theme / admission_type / presentation_format / university_notes のみ',
    },
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
    sources: [
      'basic_info',
      'activity',
      'self_analysis',
    ],
    sourceEvidence: {
      basic_info:
        'app/api/matching/route.ts:345 body.basicInfo（rerank prompt でも再使用）',
      activity:
        'app/api/matching/route.ts:347 body.activityData -> buildActivityContext',
      self_analysis:
        'app/api/matching/route.ts:383 studentProfile -> matchingStudentProfileContext',
    },
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
    sources: [
      'activity',
      'self_analysis',
      'self_pr',
      'statement_review',
      'interview_record',
    ],
    sourceEvidence: {
      activity:
        'app/api/reason/route.ts:49,53 themeFrequency / unusedExperience（いずれも activityData 由来の決定論統計）',
      self_analysis:
        'app/self-pr/page.tsx:538-543 usedText / themeFrequency の studentProfile',
      self_pr:
        'app/self-pr/page.tsx:531 usedText の loadSelfPRs().text',
      statement_review:
        'app/self-pr/page.tsx:532 usedText の loadReviewHistory().essay',
      interview_record:
        'app/self-pr/page.tsx:533-535 usedText の getInterviewRecords()',
    },
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
    sources: [
      'basic_info',
      'self_analysis',
      'diagnosis',
      'activity',
      'interview_ai',
      'presentation',
      'statement_review',
      'essay',
      'interview_record',
    ],
    sourceEvidence: {
      basic_info:
        'lib/contextBuilders/tutorContext.ts runBasicInfoUnit（basic_info_logs / server read 実績あり）',
      self_analysis:
        '同 runSelfAnalysisUnit（self_analysis_logs）',
      diagnosis:
        '同 runDiagnosisUnit（diagnosis_logs）',
      activity:
        '同 runActivityUnit（activity_logs）',
      interview_ai:
        '同 runInterviewAiUnit（interview_ai_sessions + results）',
      presentation:
        '同 runPresentationUnit（presentation_results + attempts + sessions）',
      statement_review:
        'Phase 3.5 parity source（statement_review_history / canary ON 時のみ）',
      essay:
        'Phase 3.5 parity source（essay_workspaces）',
      interview_record:
        'Phase 3.5 parity source（interview_practice_records）',
    },
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

// ── Purpose gate（E-S28）─────────────────────────────────────────────
//
// 「どの purpose が、どの Layer 1 source kind を読んでよいか」の唯一の判定点。
//
// ★ default deny ★
//   registry に無い purpose、registry の `sources` に無い kind は **すべて拒否**する。
//   unknown purpose に対して「全部読む」「基本情報だけ読む」等の暗黙の特権拡大をしない。
//
// ★ 宣言のみ。I/O を持たない ★
//   ここは純関数と定数だけで、Supabase / env / fetch / Date / Math.random を持たない。
//   実際に query を発行しないことは read layer（readSources.ts）が保証する。

/** 全 purpose の allowed kind の和集合（QA 用。ここが 10 kind を超えることはない）。 */
export const EXAM_PURPOSE_GATED_KINDS: readonly ExamSourceKind[] = EXAM_SOURCE_KINDS.filter(
  (kind) =>
    (Object.keys(EXAM_CONTEXT_REGISTRY) as ExamContextPurpose[]).some((p) =>
      EXAM_CONTEXT_REGISTRY[p].sources.includes(kind),
    ),
);

/**
 * purpose が読んでよい kind。**未知の purpose では空配列**（default deny）。
 * 外部由来の文字列をそのまま渡してよい（narrowing は内部で行う）。
 */
export function sourcesForPurpose(purpose: unknown): readonly ExamSourceKind[] {
  if (typeof purpose !== 'string') return [];
  if (!Object.prototype.hasOwnProperty.call(EXAM_CONTEXT_REGISTRY, purpose)) return [];
  return EXAM_CONTEXT_REGISTRY[purpose as ExamContextPurpose].sources;
}

/** purpose がその kind を読んでよいか。未知の purpose / kind は false。 */
export function purposeAllowsSource(purpose: unknown, kind: ExamSourceKind): boolean {
  return sourcesForPurpose(purpose).includes(kind);
}

export type ExamPurposeGateResult = {
  /** 実際に読んでよい kind（要求 ∩ 許可）。要求順を保つ。 */
  allowed: readonly ExamSourceKind[];
  /** 要求されたが purpose の許可範囲外だった kind。観測用（enum のみ・PII を含まない）。 */
  denied: readonly ExamSourceKind[];
};

/**
 * 要求 kind を purpose の許可範囲へ絞り込む純関数。
 *
 * ★ 拡張しない ★
 *   許可されているが要求されていない kind を勝手に足さない。
 *   gate は「減らす方向」にしか働かない（Canon §55 / fail-open の定義と同じ向き）。
 */
export function gateExamSourceKinds(
  purpose: unknown,
  requested: readonly ExamSourceKind[],
): ExamPurposeGateResult {
  const allowedSet = new Set(sourcesForPurpose(purpose));
  const allowed: ExamSourceKind[] = [];
  const denied: ExamSourceKind[] = [];
  const seen = new Set<ExamSourceKind>();
  for (const kind of requested) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    if (allowedSet.has(kind)) allowed.push(kind);
    else denied.push(kind);
  }
  return { allowed, denied };
}
