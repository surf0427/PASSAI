// PASSAI 受験版 Exam Spine — Layer 2 Block Registry（Stage 2 / 静的宣言のみ）。
//
// 「block id は何を意味し、誰が書いた情報で、legacy のどの formatter が正本か」を 1 箇所で宣言する。
// 純粋な型・定数のみ（I/O / AI / Date 非依存）。
//
// ★ 本 registry は **現行挙動の宣言**であり、将来こうしたいではない。
//   legacySource は実コードを読んで書いている（推測禁止）。Stage 2 の byte-equivalence QA
//   （scripts/exam-spine-stage2-check.ts）が、ここの宣言と実際の出力の一致を機械的に検証する。
//
// headingOwner の意味（byte-equivalence に直結する）:
//   'block'  … heading（【…】）を legacy formatter が content 内に含めて返す。
//              render 側で heading を足すと二重になる。
//   'render' … heading は caller（= prompt builder）が付けている。
//              Stage 2 では purpose ごとの render contract の slot heading が担当する。
//   'none'   … heading を持たない素材（行配列 / 1 行）。

import type { ExamSourceKind } from '../sourceData/types';
import type {
  ExamContextBlockId,
  ExamContentDerivation,
  ExamDataProvenance,
} from './types';

export type ExamContextBlockSpec = {
  /** Layer 1 source kind。feature 入力 block は持たない。 */
  sourceKind?: ExamSourceKind;
  provenance: ExamDataProvenance;
  derivation: ExamContentDerivation;
  headingOwner: 'block' | 'render' | 'none';
  /** 何の section か（人間向け）。 */
  meaning: string;
  /** 現行の実装位置。移行時の追跡と QA の根拠。 */
  legacySource: string;
  /** provenance が mixed のとき、なぜ分割できないかを必ず書く。 */
  mixedReason?: string;
  /**
   * headingOwner='block' なのに、**さらに外側から heading で包む purpose がある**場合に立てる。
   * 通常は二重 heading は実装ミスなので QA が禁止しているが、legacy が実際にそう書いている
   * ケースだけは事実として許可する（挙動を変えないのが Stage 2 の前提）。
   */
  renderMayWrap?: boolean;
};

export const EXAM_CONTEXT_BLOCK_REGISTRY: Readonly<
  Record<ExamContextBlockId, ExamContextBlockSpec>
> = {
  // ── 基本情報 ──────────────────────────────────────────────────────
  basic_profile: {
    sourceKind: 'basic_info',
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【生徒の基本情報】氏名 / 学年 / 文理 / 評定平均 / 受験方式 / 志望校 / 科目別評定',
    legacySource: 'lib/buildBasicInfoPromptSection.ts:buildBasicInfoPromptSection',
  },
  subject_grades: {
    sourceKind: 'basic_info',
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【科目別評定・出席状況】。basic_profile 内にも埋め込まれるが、interview_questions は単独 section として使う',
    legacySource: 'lib/buildBasicInfoPromptSection.ts:buildSubjectGradesPromptLines',
  },
  applicant_profile_basics: {
    sourceKind: 'basic_info',
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【受験生情報】大学 / 学部 / 学科 / 受験方式。氏名を含まない（interview_questions 専用の minimal profile）',
    legacySource: 'lib/interview/buildInterviewQuestionPrompt.ts:buildInterviewQuestionUserPrompt（受験生情報 section）',
  },

  // ── 大学・受験方式 ────────────────────────────────────────────────
  university_context: {
    sourceKind: 'basic_info',
    provenance: 'mixed',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【志望先の文脈】志望大学・学部・学科（本人入力）+ アドミッションポリシー等（大学 DB）',
    legacySource: 'lib/buildUniversityContext.ts:buildUniversityContextPromptSection',
    mixedReason:
      '本人が入力した志望先（user_authored）と大学 DB の enrichment（system_metadata）が 1 つの section に交互に並ぶ。行単位で分割すると legacy の行順・改行が崩れ byte-equivalence を失う。',
  },
  statement_university_context: {
    provenance: 'system_metadata',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '志望理由書添削用の大学 DB section',
    legacySource: 'lib/statement/review/buildStatementUniversityContext.ts:buildStatementUniversityContext',
  },
  interview_university_context: {
    provenance: 'system_metadata',
    derivation: 'verbatim',
    headingOwner: 'block',
    // ★ interview_feedback はこの section をそのまま載せるが、interview_questions は
    //   さらに 【大学DB情報】 で包んでから載せている（legacy の実装がそうなっている）。
    //   統合すると prompt byte が変わるため Stage 2 では事実として許可する。
    renderMayWrap: true,
    meaning: '面接用の大学 DB section（interview_questions / interview_feedback が共有）',
    legacySource: 'lib/buildInterviewUniversityContext.ts:buildInterviewUniversityContext',
  },
  essay_university_context: {
    provenance: 'system_metadata',
    derivation: 'verbatim',
    headingOwner: 'block',
    meaning: '小論文用の大学 DB section',
    legacySource: 'lib/buildEssayUniversityContext.ts',
  },
  admission_focus: {
    provenance: 'system_metadata',
    derivation: 'verbatim',
    headingOwner: 'block',
    meaning: '大学側の評価軸（入試タイプ推定）context。現状 interview_feedback だけが通電している',
    legacySource: 'app/api/interview-feedback/route.ts:admissionFocusContext（getAdmissionFocusContextForUser 由来）',
  },
  exam_type_guidance_statement: {
    sourceKind: 'basic_info',
    provenance: 'system_metadata',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【受験方式に応じた添削方針】examTypes から決まる志望理由書専用ルール',
    legacySource: 'lib/statement/review/statementPrompt.ts:buildExamTypeStatementGuidance（module-private）',
  },
  exam_type_guidance_interview: {
    sourceKind: 'basic_info',
    provenance: 'system_metadata',
    derivation: 'verbatim',
    headingOwner: 'render',
    meaning: '面接向け受験方式ガイダンス。caller が 【受験方式に関するガイダンス】 heading を付ける',
    legacySource: 'app/api/interview-questions/route.ts → buildInterviewQuestionUserPrompt(examTypeGuidance)',
  },

  // ── 活動 ──────────────────────────────────────────────────────────
  activity_text: {
    sourceKind: 'activity',
    provenance: 'user_authored',
    derivation: 'verbatim',
    headingOwner: 'render',
    meaning: '活動整理データを整形した本文。heading は purpose ごとに違う（【活動データ】/【活動情報】）',
    legacySource: 'lib/formatActivity.ts 由来の activityText を各 prompt builder が heading 付きで載せる',
  },
  activity_context: {
    sourceKind: 'activity',
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【活動概要】カテゴリ別の件数・主要ラベルだけに圧縮した活動 section',
    legacySource: 'lib/statement/review/statementPrompt.ts:buildActivityContext（module-private）',
  },
  activity_context_matching: {
    sourceKind: 'activity',
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning:
      '【活動整理の概要】matching 用。activity_context と行の作り方は完全に同一で heading だけが違う',
    legacySource: 'lib/matching/matchingPrompt.ts:buildActivityContext（module-private）',
  },
  activity_summary: {
    sourceKind: 'activity',
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'render',
    meaning: '活動サマリー（800 字圧縮）。interview_questions の materials 経由',
    legacySource: 'lib/interview/buildInterviewQuestionMaterials.ts:compressBody(activitySummary)',
  },

  // ── 自己理解 ──────────────────────────────────────────────────────
  //
  // ★ StudentProfile 自体は AI 生成（ai_derived）だが、各 feature 向けの整形は決定論。
  //   3 つに分けているのは「同じ意味だが legacy の整形が実際に違う」ため
  //   （件数上限・bullet joiner・applicantType hint の有無がすべて異なる）。
  self_analysis_statement: {
    sourceKind: 'self_analysis',
    provenance: 'ai_derived',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【自己分析サマリー】志望理由書添削向け（強み3/弱み2/価値観6 + applicantType hint）',
    legacySource: 'lib/contextBuilders/statementContext.ts:buildStatementStudentProfileContext',
  },
  self_analysis_interview: {
    sourceKind: 'self_analysis',
    provenance: 'ai_derived',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【自己分析サマリー（面接用・最小コンテキスト）】weaknesses を意図的に外す',
    legacySource: 'lib/contextBuilders/interviewContext.ts:buildInterviewStudentProfileContext',
  },
  self_analysis_matching: {
    sourceKind: 'self_analysis',
    provenance: 'ai_derived',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【自己分析サマリー（matching 用）】最も広く使う（強み5/弱み2/将来3/価値観8/代表例3）',
    legacySource: 'lib/contextBuilders/matchingContext.ts:buildMatchingStudentProfileContext',
  },
  self_analysis_questions: {
    sourceKind: 'self_analysis',
    provenance: 'ai_derived',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【自己分析サマリー】面接質問生成向け（強み / 興味・関心タグ / 将来とのつながり）',
    legacySource: 'lib/interview/buildInterviewQuestionPrompt.ts:buildSelfAnalysisSection（module-private）',
  },

  activity_category_counts: {
    sourceKind: 'activity',
    // 件数だけを数えた決定論集計。活動名 / テーマ / 説明といった narrative は含まない。
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'none',
    meaning:
      '活動整理のカテゴリ別件数（部活動2件・ボランティア1件 …）。本文は含まない',
    legacySource:
      'lib/contextBuilders/tutorContext.ts:loadActivityContext（activity.categoryCounts / totalCount）＋ ' +
      'buildTutorSupabaseContextSection の「・活動整理には、… が保存されています（計N件）。」1 行',
  },

  // ── 面接 ──────────────────────────────────────────────────────────
  interview_issue_line: {
    sourceKind: 'interview_record',
    // ★ mixed ではない ★
    //   材料は「本人の自己記録」または「面接官/AI が返した改善点」で、
    //   どちらが採用されたかは優先順位で決まる 1 択であり、1 行に融合していない。
    //   ただし後者は生成物なので、安全側の ai_derived を宣言する。
    provenance: 'ai_derived',
    derivation: 'deterministic',
    headingOwner: 'none',
    meaning:
      '直近 1 件の面接練習から抽出した課題の圧縮要約（先頭3件 / 各80字 / 全体500字）。' +
      '面接本文・Q&A・スコア・日付は含まない',
    legacySource:
      'lib/contextBuilders/tutorStudentContext.ts:buildInterviewLine（正本を共有）＋ ' +
      'app/tutor/page.tsx:423 の getInterviewRecords()[0] を材料とする「面接練習の課題」1 行',
  },

  // ── 診断 ──────────────────────────────────────────────────────────
  diagnosis_type_hint: {
    sourceKind: 'diagnosis',
    // ★ resultType の言い換えであって AI 生成物ではない ★
    //   app 製の固定 hint 表（lib/examDiagnosis/tutorHints.ts）を引くだけなので
    //   system_metadata。診断の回答（answers）は user_authored だが block に入らない。
    provenance: 'system_metadata',
    derivation: 'deterministic',
    // heading を持たない素の 1 文。legacy 側の「・保存情報からは、…。」という
    // 行装飾は tutor section の書式であって情報そのものではないため block に含めない。
    headingOwner: 'none',
    meaning:
      '診断タイプから導いた会話補助 hint 1 文。タイプ名 / catchphrase / score / answers / 推薦大学は含まない',
    legacySource:
      'lib/contextBuilders/tutorContext.ts:loadDiagnosisContext（diagnosis.typeHint）＋ ' +
      'buildTutorSupabaseContextSection の「・保存情報からは、{hint}。」1 行',
  },

  // ── divergence（探索 context）─────────────────────────────────────
  previous_output_summary: {
    sourceKind: 'statement_review',
    provenance: 'ai_derived',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【過去に提示済みのフィードバック】過去 AI 出力の反復論点',
    legacySource:
      'lib/contextBuilders/divergence/buildPreviousOutputSummary.ts + previousOutputSummarySection.ts',
  },
  theme_frequency: {
    provenance: 'mixed',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【テーマの偏り（参考）】改善提案文脈向け（statement_review / self_pr）',
    legacySource:
      'lib/contextBuilders/divergence/buildThemeFrequency.ts + themeFrequencySection.ts',
    mixedReason:
      '集計 document が activityData（user_authored）と StudentProfile（ai_derived）の両方から作られる。theme 名 1 語には由来が残らないため、block を分けても provenance を復元できない。',
  },
  theme_frequency_questions: {
    provenance: 'mixed',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【テーマ探索の参考】追加質問生成文脈向け。theme_frequency とは文言も目的も別',
    legacySource:
      'lib/prompts/additionalQuestionsPrompt.ts:buildThemeFrequencyQuestionSection（module-private）',
    mixedReason: 'theme_frequency と同じ ThemeFrequency を材料にするため同じ理由で分割できない。',
  },
  unused_experience: {
    sourceKind: 'activity',
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【まだ活用できていない可能性のある経験】未使用の活動カード候補',
    legacySource:
      'lib/contextBuilders/divergence/buildUnusedExperience.ts + unusedExperienceSection.ts',
  },

  // ── 決定論解析 ────────────────────────────────────────────────────
  //
  // ★ AI を使わない。対象は本人が書いた志望理由書本文なので provenance は user_authored。
  //   system_metadata（参照データ）ではない点に注意。
  ng_issues: {
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【既知のNG指摘候補】本文に対する rule-based NG 検出結果',
    legacySource: 'lib/statement/review/statementPrompt.ts:buildNgIssuesSection（module-private）',
  },
  structure_analysis: {
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【既存構造分析】本文に対する 6 要素の決定論スコア',
    legacySource:
      'lib/statement/review/statementPrompt.ts:buildStructureAnalysisSection（module-private）',
  },

  // ── 横断要約 ──────────────────────────────────────────────────────
  tutor_student_context: {
    provenance: 'mixed',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【PASSAI内の生徒情報】チューター向けの横断 1 本要約 + 利用ルール instruction',
    legacySource:
      'lib/contextBuilders/tutorStudentContext.ts:buildTutorStudentContext + lib/tutor/tutorPrompt.ts:buildTutorStudentContextSection',
    mixedReason:
      '志望校（user_authored）/ StudentProfile 要約（ai_derived）/ 添削・面接の課題（ai_derived）/ 活動件数（user_authored）/ マイページ利用状況（system_metadata）を「・ラベル: 値」の 1 本の行集合に融合している。行単位に割ると legacy の 1 block 構造が壊れる。Stage 6 の三重投入解消と同時に分割を検討する。',
  },

  // ── feature 入力（Spine source ではない）──────────────────────────
  //
  // ★ E-P5 は「Layer 2 に feature artifact を持ち込まない」だが、それは **Spine が
  //   横断 context として配る対象にしない** という意味である。ここに置く block は
  //   purpose 自身の入力であり、他 purpose へは決して選択されない（selection contract で保証）。
  //   prompt 全体の byte 再現に必要なため block として明示的に扱う。
  statement_target: {
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【今回の添削対象】志望大学 / 学部 / 学科',
    legacySource: 'lib/statement/review/statementPrompt.ts:buildStatementReviewPrompt（inline）',
  },
  statement_summary: {
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'render',
    meaning: '志望理由書下書き本文の 1200 字圧縮（interview_questions materials 経由）',
    legacySource: 'lib/interview/buildInterviewQuestionMaterials.ts:compressBody(statementText)',
  },
  statement_body: {
    provenance: 'user_authored',
    derivation: 'verbatim',
    headingOwner: 'render',
    meaning: '【志望理由書本文】添削対象の本文そのもの',
    legacySource: 'lib/statement/review/statementPrompt.ts:buildStatementReviewPrompt（inline）',
  },
  self_pr_body: {
    provenance: 'user_authored',
    derivation: 'verbatim',
    headingOwner: 'render',
    meaning: '【自己PR】添削対象の自己PR本文',
    legacySource: 'lib/prompts.ts:buildReasonPrompt（inline）',
  },
  analysis_result: {
    provenance: 'ai_derived',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【AI分析】壁打ち分析の結果（要約 / 強み / 弱み / 将来とのつながり）',
    legacySource: 'lib/prompts/summarizePrompt.ts:buildSummarizePrompt（inline）',
  },
  analysis_qa: {
    provenance: 'mixed',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【深掘り質問と回答】AI が作った質問と本人の回答の交互列',
    legacySource: 'lib/prompts/summarizePrompt.ts:buildSummarizePrompt（inline）',
    mixedReason:
      'Q（ai_derived）と A（user_authored）が Q1/A1/Q2/A2 の順で 1 block に交互配置される。legacy の対応関係を保ったまま分割できない。',
  },
  deep_answers: {
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【受験生の追加深掘りメモ】',
    legacySource: 'lib/prompts/summarizePrompt.ts:buildSummarizePrompt（inline）',
  },
  free_memo: {
    provenance: 'user_authored',
    derivation: 'deterministic',
    headingOwner: 'render',
    meaning: '【受験生の自由メモ】',
    legacySource: 'lib/prompts/summarizePrompt.ts:buildSummarizePrompt（inline）',
  },
  existing_questions: {
    provenance: 'ai_derived',
    derivation: 'deterministic',
    headingOwner: 'render',
    meaning: '【すでに出している質問（重複禁止）】同一 feature 内の既出質問',
    legacySource: 'lib/prompts/additionalQuestionsPrompt.ts:buildAdditionalQuestionsPrompt（inline）',
  },
  question_variation_seed: {
    provenance: 'system_metadata',
    derivation: 'deterministic',
    headingOwner: 'block',
    meaning: '【出題バリエーション指示】日次 seed に応じた出題方針（v5 の 4 ブロック構造）',
    legacySource: 'lib/interview/buildInterviewQuestionPrompt.ts:buildInterviewQuestionUserPrompt（inline）',
  },
};

/** block id の spec を返す（純関数・union 全網羅のため fallback 不要）。 */
export function getExamContextBlockSpec(id: ExamContextBlockId): ExamContextBlockSpec {
  return EXAM_CONTEXT_BLOCK_REGISTRY[id];
}
