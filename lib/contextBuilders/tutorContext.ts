// 受験チューターAI 用「Supabase 保存済み生徒情報」context builder（server-only）。
//
// STEP-TUTOR-SUPABASE-CONTEXT-OUTPUT-01 / STEP-TUTOR-CONTEXT-PHASE2-CONNECT-01:
//   /api/tutor の Claude 呼び出し前に、Supabase 側に保存済みの生徒情報を server-side で
//   読み取り、受験相談に使える短いテキスト section へ要約して prompt に差し込む層。
//
// ── Exam Spine Phase 2 以降の構成 ───────────────────────────────────
//   Supabase の **読み取り** は lib/contextBuilders/tutor/serverRead/* へ移設した。本ファイルに残るのは
//   「読んだ row を Tutor 用にどう解釈・要約・整形するか」という **Tutor 固有の方針**のみ。
//
//     lib/contextBuilders/tutor/serverRead/reader.server.ts        … SELECT / fail-open / 並列実行 / 観測
//     lib/contextBuilders/tutor/serverRead/rowMappers.ts           … jsonb の shape guard（方針を持たない純関数）
//     lib/contextBuilders/tutor/serverRead/snapshotCache.server.ts … per-user TTL cache の器
//     本ファイル                                                   … truncate 方針 / 表示ラベル / hint 文言 / section 整形
//
//   Spine 側へ移してはいけないもの（＝ここに残す理由）:
//     MAX_* の truncate 件数・文字数     … 「受験相談で何を何件見せるか」は Tutor の判断
//     DIAGNOSIS_TYPE_HINTS 等の日本語文言 … prompt へ出る Tutor の言い回しそのもの
//     ACTIVITY / PRESENTATION の表示ラベル … 表示都合
//     buildTutorSupabaseContextSection    … section header と利用ルールを含む prompt 整形
//
// 既存の body 由来 context（lib/contextBuilders/tutorStudentContext.ts +
// lib/tutor/tutorPrompt.ts:buildTutorStudentContextSection）とは別レイヤー:
//   - 既存: client が localStorage から読んで body で送るデータを要約（canonical 経路）。
//   - 本層: server が Supabase の auth-scoped 永続層から読む（端末跨ぎ / body 欠落時の補完）。
//   ⚠️ 両者は現状 /api/tutor の system block 2 / block 3 として **併存**している。
//      一本化は Phase 3 の課題であり、Phase 2 では意図的に手を付けていない。
//
// 【データソース】
//   いずれも auth-scoped durable table（owner SELECT RLS / user_id scope）。
//     - self_analysis_logs（§32-§34, 履歴型）… analysis / summary（Phase1 で接続済）
//     - basic_info_logs   （§41-§43, snapshot 型）… 学年 / 受験方式 / 志望校・志望分野
//     - diagnosis_logs    （§44-§46, snapshot 型）… 受験タイプ → 会話補助 hint へ言い換え
//     - activity_logs     （§47-§49, snapshot 型）… カテゴリ別件数のみ（narrative は読まない）
//     - interview_ai_sessions / interview_ai_results … 最新の completed AI 面接 1 件
//     - presentation_results / attempts / sessions   … 最新の evaluated プレゼン 1 件
//   anonymous mirror（*_mirrors）は user_id も SELECT policy も無く read 不可のため使わない。
//
// 設計要件:
//   - server-only（Spine reader が 'server-only' を持つため client からは import 不可）。
//   - userId scope で取得する（RLS は auth.uid()=user_id で閉じるが、明示 .eq も付ける）。
//   - 取得失敗・未ログイン・データ不足・**SQL 未 apply で table 不存在**でも throw しない。
//     console.warn のみ。Promise.allSettled で部分成功を許容（一部 source 失敗でも他は使う）。
//   - row JSON を丸ごと返さない。受験相談に必要な field だけを抽出・truncate する。
//   - basic_info の PII（氏名 / 評定 / 欠席等）や activity の narrative 本文は読まない。
//
// 関連:
//   - lib/contextBuilders/tutor/serverRead/*（Supabase 読み取り層）
//   - app/api/tutor/route.ts (consumer / 接続位置は維持)

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveDiagnosisTypeHint } from '@/lib/examDiagnosis/tutorHints';
import { summarizeActivityCategories } from '@/lib/activityCategories';
// AI 面接モードのラベル（純データモジュール。server-only 依存なし）。
import {
  INTERVIEW_TYPE_LABELS,
  isInterviewType,
} from '@/lib/interviewAi/interviewTypes';

// Exam Spine — read 層。
import {
  asRecord,
  toTrimmedString,
  toStringArray,
  truncate,
  unwrapEmbedded,
} from '@/lib/contextBuilders/tutor/serverRead/rowMappers';
import {
  loadExamSources,
  readActivitySnapshot,
  readBasicInfoSnapshot,
  readDiagnosisSnapshot,
  readLatestInterviewAiRow,
  readLatestPresentationResultRow,
  readLatestSelfAnalysisRow,
  readLatestStatementReviewRow,
  readLatestEssayReviewsRow,
  readLatestInterviewPracticeRow,
  readPresentationSessionByAttempt,
  resolveExamSpineClient,
  type ExamSpineReadOptions,
} from '@/lib/contextBuilders/tutor/serverRead/reader.server';
import { createExamSpineSnapshotCache } from '@/lib/contextBuilders/tutor/serverRead/snapshotCache.server';
import { sourceValueOrNull } from '@/lib/contextBuilders/tutor/serverRead/sourceState';

// ── 型 ───────────────────────────────────────────────────────────

export type TutorStudentContext = {
  // self_analysis_logs 由来（最新 1 件）。
  selfAnalysis?: {
    summary?: string;
    strengths?: string[];
    weaknesses?: string[];
    futureConnections?: string[];
    appealPoints?: string;
  };
  // basic_info_logs 由来（snapshot）。PII（氏名 / 評定 / 欠席）は含めない。
  basicInfo?: {
    grade?: string;
    // 文系 / 理系 / 未定。basic_info_logs.payload に durable に存在する
    // （境界が strip するのは name のみ）。Phase 3.5 で projection へ復帰。
    track?: string;
    examType?: string;
    targetSchools?: string[];
    targetFields?: string[];
  };
  // diagnosis_logs 由来（snapshot）。タイプ名は出さず会話補助 hint に言い換える。
  diagnosis?: {
    typeHint?: string;
    summary?: string;
  };
  // activity_logs 由来（snapshot）。件数集計のみ。narrative は含めない。
  activity?: {
    totalCount: number;
    categoryCounts: Record<string, number>;
  };
  // interview_ai_results 由来（最新の completed AI 面接 1 件）。結果画面と同じ保存済み feedback を読む。
  //   - turn 履歴 / 音声 / STT 全文は含めない（結果サマリのみ）。
  //   - 直近 3 件へ拡張する場合は reader の limit を上げて配列化すればよい
  //     （type を配列にし、section builder で複数 block を出す）。MVP は最新 1 件のみ。
  interviewAi?: {
    modeLabel: string; // 面接モード（INTERVIEW_TYPE_LABELS）
    date?: string; // 実施日時（JST の年月日）
    overall?: string; // 総合評価
    goodPoints?: string[]; // 良かった点
    improvements?: string[]; // 改善点
    nextPractice?: string[]; // 次に練習すべきこと
  };
  // presentation_results 由来（最新の evaluated プレゼン 1 件）。結果画面と同じ保存済み feedback を読む。
  //   - 録画動画 / Storage URL / STT 全文 / 発表後 Q&A 履歴は含めない（結果サマリのみ）。
  //   - 直近 3 件へ拡張する場合は reader の limit を上げて配列化すればよい。MVP は最新 1 件のみ。
  presentation?: {
    date?: string; // 実施日時（JST の年月日）
    university?: string; // 大学名
    faculty?: string; // 学部名
    theme?: string; // 発表テーマ
    overall?: string; // 総合評価（overallComment）
    goodPoints?: string[]; // 良かった点
    improvements?: string[]; // 改善点
    nextPractice?: string[]; // 次に練習すると良い点
    // カテゴリ評価（存在時のみ）。weak/normal/strong を日本語ラベル化済み。
    categories?: { label: string; level: string }[];
  };
  // statement_review_history 由来（最新 1 件）。Phase 3.5 parity source。
  //   - 志望理由書の本文 / 点数 / 良かった点は含めない。課題（weaknesses）のみ。
  statementReview?: {
    weaknesses: string[];
  };
  // essay_workspaces 由来（最新 workspace の最新 review）。Phase 3.5 parity source。
  //   - 小論文本文 / essayBodySnapshot / 点数は含めない。課題（weakPoints）のみ。
  essay?: {
    weakPoints: string[];
  };
  // interview_practice_records 由来（対人の面接練習・最新 1 件）。Phase 3.5 parity source。
  //   ⚠️ interviewAi（AI 面接）とは別。Q&A 本文 / betterAnswer は含めない。
  interviewPractice?: {
    issues: string[];
  };
  // どの source が取得できたかの真偽サマリ（section 構築・観測用）。
  sourceSummary: {
    hasSelfAnalysis: boolean;
    hasBasicInfo: boolean;
    hasDiagnosis: boolean;
    hasActivity: boolean;
    hasInterviewAi: boolean;
    hasPresentation: boolean;
    // Phase 3.5 parity source（canary OFF では常に false = 読みに行かない）。
    hasStatementReview: boolean;
    hasEssay: boolean;
    hasInterviewPractice: boolean;
  };
};

// ── truncation 定数（section 全体を最大 1200 字に収めるため）──────────
//
// ⚠️ Tutor の方針。Spine（lib/contextBuilders/tutor/serverRead/*）へ移さないこと。
//    「受験相談の system block に何を何件載せるか」という feature の判断であり、
//    他 feature が同じ切り方を強制される理由は無い。
const MAX_STRENGTHS = 3;
const MAX_WEAKNESSES = 2;
const MAX_FUTURE = 2;
const MAX_TARGETS = 3;
const MAX_ITEM_LENGTH = 40;
const MAX_SUMMARY_LENGTH = 120;
const MAX_TOTAL_LENGTH = 1200;
// AI 面接結果サマリの件数上限（turn 履歴は渡さない。結果画面の主要項目だけ短く渡す）。
const MAX_INTERVIEW_AI_GOOD = 3;
const MAX_INTERVIEW_AI_IMPROVE = 3;
const MAX_INTERVIEW_AI_NEXT = 2;
// Phase 3.5 parity source の上限。legacy block2（lib/contextBuilders/tutorStudentContext.ts）
// と同じ件数・文字数にそろえる。ここを変えると canary ON の prompt 文言が変わる。
const MAX_REVIEW_WEAKNESSES = 2; // 志望理由書レビューの課題（legacy と同じ）
const MAX_REVIEW_WEAKNESS_LENGTH = 60;
const MAX_ESSAY_WEAKPOINTS = 1; // 小論文添削の課題（legacy は先頭 1 件のみ）
const MAX_PRACTICE_ITEMS = 3; // 対人面接練習の課題
const MAX_PRACTICE_ITEM_LENGTH = 80;
// canary ON では parity source の分だけ section が伸びる。OFF の既定 1200 のままだと
// 末尾の「この生徒情報の扱い方」（AI への指示）が hard cut されうるため、ON だけ広げる。
const MAX_TOTAL_LENGTH_PARITY = 1800;

// プレゼン結果サマリの件数上限（録画 / STT 全文 / Q&A 履歴は渡さない。結果画面の主要項目だけ短く渡す）。
const MAX_PRESENTATION_GOOD = 3;
const MAX_PRESENTATION_IMPROVE = 3;
const MAX_PRESENTATION_NEXT = 2;

// プレゼン評価カテゴリ key → 日本語ラベル（結果画面 CATEGORY_ORDER と一致）。
const PRESENTATION_CATEGORY_LABELS: Record<string, string> = {
  composition: '構成力',
  persuasion: '説得力',
  concreteness: '具体性',
  clarity: 'わかりやすさ',
  timeManagement: '時間配分',
  completeness: '完成度',
  materialConsistency: '資料整合性',
};
// プレゼン評価カテゴリの順序（資料整合性は存在時のみ末尾に付与）。
const PRESENTATION_CATEGORY_ORDER: readonly string[] = [
  'composition',
  'persuasion',
  'concreteness',
  'clarity',
  'timeManagement',
  'completeness',
  'materialConsistency',
];
// weak/normal/strong → 日本語ラベル（結果画面 LEVEL_LABEL と一致）。
const PRESENTATION_LEVEL_LABELS: Record<string, string> = {
  weak: '要改善',
  normal: '標準',
  strong: '良い',
};

// 受験タイプ診断 resultType(legacy 1-4) → 会話補助 hint（ラベル名そのものは出さない）。
// app/diagnosis/page.tsx:RESULT_TYPES の 4 タイプの趣旨を、断定しない支援方針へ言い換える。
// ★ 言い換えの正本は lib/examDiagnosis/tutorHints.ts へ移した（Stage 5.2）★
//   Canonical Exam Context の diagnosis block が同じ hint を使うため、
//   2 箇所に置くと同じ診断結果から違う prompt が出る。値は変えていない。

// 受験タイプ診断 9タイプ（ExamType）の hint は lib/examDiagnosis/tutorHints.ts に集約
// （Tutor へ渡してよい傾向 hint のみ。タイプ名 / score / 推薦大学 / NG生文は渡さない）。

// activity カテゴリ key → 表示ラベル（lib/contextBuilders/tutorStudentContext.ts と一致）。
// ★ ラベル表と件数集計の正本は lib/activityCategories.ts へ移した（Stage 5.3）★
//   Canonical Exam Context の activity block が同じ集計を使うため、
//   2 箇所に置くと同じ活動データから違う prompt が出る。値は変えていない。

// Spine reader へ渡す観測ラベル。既存の運用ログ文言を 1 文字も変えないために明示する。
const TUTOR_READ_OPTIONS: ExamSpineReadOptions = {
  logLabel: 'tutor supabase context',
};

// ── projection: row → TutorStudentContext の部分（すべて純関数）──────
//
// 「読む」は Spine、「Tutor 向けにどう解釈するか」はここ。
// 各関数は該当 source が使えないとき {} を返す（= sourceSummary が false のまま）。

function projectSelfAnalysis(
  rec: Record<string, unknown> | null,
): Partial<TutorStudentContext> {
  if (!rec) return {};

  const analysis = asRecord(rec.analysis);
  const summary = asRecord(rec.summary);

  const summaryText = truncate(
    toTrimmedString(analysis?.summary) ||
      toTrimmedString(summary?.activitySummary),
    MAX_SUMMARY_LENGTH,
  );
  const strengths = toStringArray(analysis?.strengths, MAX_STRENGTHS, MAX_ITEM_LENGTH);
  const weaknesses = toStringArray(analysis?.weaknesses, MAX_WEAKNESSES, MAX_ITEM_LENGTH);
  const futureConnections = toStringArray(
    analysis?.futureConnections,
    MAX_FUTURE,
    MAX_ITEM_LENGTH,
  );
  const appealPoints = truncate(
    toTrimmedString(summary?.appealPoints),
    MAX_SUMMARY_LENGTH,
  );

  const hasAny =
    summaryText !== '' ||
    strengths.length > 0 ||
    weaknesses.length > 0 ||
    futureConnections.length > 0 ||
    appealPoints !== '';
  if (!hasAny) return {};

  return {
    selfAnalysis: {
      ...(summaryText !== '' ? { summary: summaryText } : {}),
      ...(strengths.length > 0 ? { strengths } : {}),
      ...(weaknesses.length > 0 ? { weaknesses } : {}),
      ...(futureConnections.length > 0 ? { futureConnections } : {}),
      ...(appealPoints !== '' ? { appealPoints } : {}),
    },
  };
}

// 含める: 学年 / 受験方式 / 志望校 / 志望分野（各最大 3）。
// 含めない: 氏名・高校名・メール・電話・住所・評定平均・欠席日数（= name/subjectGrades/
//           overallGpa は参照しない。氏名は書込時に strip 済だが念のため参照しない）。
function projectBasicInfo(
  payload: Record<string, unknown> | null,
): Partial<TutorStudentContext> {
  if (!payload) return {};

  const grade = truncate(toTrimmedString(payload.grade), MAX_ITEM_LENGTH);
  // track（文系 / 理系 / 未定）。payload に durable に存在する。
  // ⚠️ 同じ payload にある overallGpa / subjectGrades / name は評定・PII のため読まない。
  const track = truncate(toTrimmedString(payload.track), MAX_ITEM_LENGTH);
  const examType = toStringArray(payload.examTypes, MAX_TARGETS, MAX_ITEM_LENGTH).join('・');

  const prefs = Array.isArray(payload.preferences) ? payload.preferences : [];
  const targetSchools: string[] = [];
  const targetFields: string[] = [];
  for (const p of prefs.slice(0, MAX_TARGETS)) {
    const pr = asRecord(p);
    if (!pr) continue;
    const uni = truncate(toTrimmedString(pr.university), MAX_ITEM_LENGTH);
    const fac = truncate(toTrimmedString(pr.faculty), MAX_ITEM_LENGTH);
    if (uni !== '') targetSchools.push(uni);
    if (fac !== '') targetFields.push(fac);
  }

  const hasAny =
    grade !== '' ||
    track !== '' ||
    examType !== '' ||
    targetSchools.length > 0 ||
    targetFields.length > 0;
  if (!hasAny) return {};

  return {
    basicInfo: {
      ...(grade !== '' ? { grade } : {}),
      ...(track !== '' ? { track } : {}),
      ...(examType !== '' ? { examType } : {}),
      ...(targetSchools.length > 0 ? { targetSchools } : {}),
      ...(targetFields.length > 0 ? { targetFields } : {}),
    },
  };
}

// resultType を会話補助 hint へ言い換える。2 系統を typeof で判別:
//   - number（legacy 1-4）→ DIAGNOSIS_TYPE_HINTS。
//   - string（ExamType 9種）→ resolveDiagnosisTypeHint（lib/examDiagnosis/tutorHints.ts が単一の正本）。
// どちらの系統でも、固定タイプ名 / catchphrase / score / answers / 推薦大学 / NG生文は渡さない。
function projectDiagnosis(
  payload: Record<string, unknown> | null,
): Partial<TutorStudentContext> {
  if (!payload) return {};

  const hint = resolveDiagnosisTypeHint(payload.resultType);
  if (!hint) return {};

  return { diagnosis: { typeHint: truncate(hint, MAX_SUMMARY_LENGTH) } };
}

// 件数集計のみ。narrative 本文 / 固有名詞 / raw payload は一切含めない。
function projectActivity(
  payload: Record<string, unknown> | null,
): Partial<TutorStudentContext> {
  if (!payload) return {};

  const summary = summarizeActivityCategories(payload);
  if (!summary) return {};

  return { activity: { totalCount: summary.totalCount, categoryCounts: summary.categoryCounts } };
}

function projectInterviewAi(
  rec: Record<string, unknown> | null,
): Partial<TutorStudentContext> {
  if (!rec) return {};

  // embed（PostgREST）は配列 or 単体で返りうる（UNIQUE(session_id) なので実質 0/1 件）。
  const resultRec = unwrapEmbedded(rec.interview_ai_results);
  const feedback = asRecord(resultRec?.feedback);
  if (!feedback) return {};

  const overall = truncate(
    toTrimmedString(feedback.overallEvaluation),
    MAX_SUMMARY_LENGTH,
  );
  const goodPoints = toStringArray(
    feedback.goodPoints,
    MAX_INTERVIEW_AI_GOOD,
    MAX_ITEM_LENGTH,
  );
  const improvements = toStringArray(
    feedback.improvements,
    MAX_INTERVIEW_AI_IMPROVE,
    MAX_ITEM_LENGTH,
  );
  const nextPractice = toStringArray(
    feedback.nextPractice,
    MAX_INTERVIEW_AI_NEXT,
    MAX_ITEM_LENGTH,
  );

  const hasAny =
    overall !== '' ||
    goodPoints.length > 0 ||
    improvements.length > 0 ||
    nextPractice.length > 0;
  if (!hasAny) return {};

  const typeRaw = toTrimmedString(rec.interview_type) || 'free';
  const modeLabel = isInterviewType(typeRaw)
    ? INTERVIEW_TYPE_LABELS[typeRaw]
    : INTERVIEW_TYPE_LABELS.free;
  const date = formatDateJst(toTrimmedString(rec.created_at));

  return {
    interviewAi: {
      modeLabel,
      ...(date !== '' ? { date } : {}),
      ...(overall !== '' ? { overall } : {}),
      ...(goodPoints.length > 0 ? { goodPoints } : {}),
      ...(improvements.length > 0 ? { improvements } : {}),
      ...(nextPractice.length > 0 ? { nextPractice } : {}),
    },
  };
}

/** プレゼン core feedback の projection。enrichment 前に「使えるか」を判定する。 */
function projectPresentationCore(rec: Record<string, unknown> | null): {
  usable: boolean;
  attemptId: string;
  built?: NonNullable<TutorStudentContext['presentation']>;
} {
  if (!rec) return { usable: false, attemptId: '' };
  const attemptId = toTrimmedString(rec.attempt_id);

  const feedback = asRecord(rec.feedback);
  if (!feedback) return { usable: false, attemptId };

  const overall = truncate(
    toTrimmedString(feedback.overallComment),
    MAX_SUMMARY_LENGTH,
  );
  const goodPoints = toStringArray(
    feedback.goodPoints,
    MAX_PRESENTATION_GOOD,
    MAX_ITEM_LENGTH,
  );
  const improvements = toStringArray(
    feedback.improvements,
    MAX_PRESENTATION_IMPROVE,
    MAX_ITEM_LENGTH,
  );
  const nextPractice = toStringArray(
    feedback.nextPractice,
    MAX_PRESENTATION_NEXT,
    MAX_ITEM_LENGTH,
  );

  // カテゴリ評価（存在時のみ）。weak/normal/strong を日本語ラベルへ。資料整合性は付いていれば末尾に。
  const cats = asRecord(feedback.categories);
  const categories: { label: string; level: string }[] = [];
  if (cats) {
    for (const key of PRESENTATION_CATEGORY_ORDER) {
      const level = PRESENTATION_LEVEL_LABELS[toTrimmedString(cats[key])];
      if (level) {
        categories.push({ label: PRESENTATION_CATEGORY_LABELS[key], level });
      }
    }
  }

  const hasAny =
    overall !== '' ||
    goodPoints.length > 0 ||
    improvements.length > 0 ||
    nextPractice.length > 0 ||
    categories.length > 0;
  if (!hasAny) return { usable: false, attemptId };

  const date = formatDateJst(toTrimmedString(rec.created_at));

  return {
    usable: true,
    attemptId,
    built: {
      ...(date !== '' ? { date } : {}),
      ...(overall !== '' ? { overall } : {}),
      ...(goodPoints.length > 0 ? { goodPoints } : {}),
      ...(improvements.length > 0 ? { improvements } : {}),
      ...(nextPractice.length > 0 ? { nextPractice } : {}),
      ...(categories.length > 0 ? { categories } : {}),
    },
  };
}

/** attempt → session の付随情報（大学名 / 学部名 / テーマ）の projection。 */
function projectPresentationSession(
  attemptRec: Record<string, unknown> | null,
): { university: string; faculty: string; theme: string } {
  const sess = unwrapEmbedded(attemptRec?.presentation_sessions);
  if (!sess) return { university: '', faculty: '', theme: '' };
  return {
    university: truncate(toTrimmedString(sess.university_name), MAX_ITEM_LENGTH),
    faculty: truncate(toTrimmedString(sess.faculty_name), MAX_ITEM_LENGTH),
    theme: truncate(toTrimmedString(sess.theme), MAX_SUMMARY_LENGTH),
  };
}

// ── projection: Phase 3.5 parity source ───────────────────────────
//
// legacy block2（lib/contextBuilders/tutorStudentContext.ts）と同じ意味論・同じ上限で
// 課題だけを取り出す。本文・点数・良かった点は載せない。

// statement_review_history.result（StatementResult）→ 課題 2 件。
// legacy: buildStatementWeaknessLine（weaknesses 上位 2 件 / 各 60 字）。
function projectStatementReview(
  rec: Record<string, unknown> | null,
): Partial<TutorStudentContext> {
  if (!rec) return {};
  const result = asRecord(rec.result);
  if (!result) return {};
  const weaknesses = toStringArray(
    result.weaknesses,
    MAX_REVIEW_WEAKNESSES,
    MAX_REVIEW_WEAKNESS_LENGTH,
  );
  if (weaknesses.length === 0) return {};
  return { statementReview: { weaknesses } };
}

// essay_workspaces の reviews 配列 → 最新 review の課題 1 件。
// legacy: buildEssayWeaknessLine（weakPoints 先頭 1 件 / 60 字）。
//
// reviews は append-only なので **末尾が最新**。
// PostgREST の `->` は json / text のどちらで返ることもあるため両方を受ける。
function projectEssay(
  rec: Record<string, unknown> | null,
): Partial<TutorStudentContext> {
  if (!rec) return {};

  let raw: unknown = rec.reviews;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) return {};

  const latest = asRecord(raw[raw.length - 1]);
  if (!latest) return {};

  const weakPoints = toStringArray(
    latest.weakPoints,
    MAX_ESSAY_WEAKPOINTS,
    MAX_REVIEW_WEAKNESS_LENGTH,
  );
  if (weakPoints.length === 0) return {};
  return { essay: { weakPoints } };
}

// interview_practice_records → 対人面接練習の課題。
// legacy: buildInterviewLine の優先順位をそのまま踏襲する。
//   1. feedback_json.improvements（AI フィードバックの改善点）
//   2. 自己記録（improvement_summary → what_went_wrong）
//   3. どちらも無ければ出さない
function projectInterviewPractice(
  rec: Record<string, unknown> | null,
): Partial<TutorStudentContext> {
  if (!rec) return {};

  // 優先順位 1: feedback_json.improvements
  //   column は jsonb。文字列で入っている旧データも考慮して両方を受ける。
  let feedbackRaw: unknown = rec.feedback_json;
  if (typeof feedbackRaw === 'string') {
    try {
      feedbackRaw = JSON.parse(feedbackRaw);
    } catch {
      feedbackRaw = null;
    }
  }
  const feedback = asRecord(feedbackRaw);
  if (feedback) {
    const improvements = toStringArray(
      feedback.improvements,
      MAX_PRACTICE_ITEMS,
      MAX_PRACTICE_ITEM_LENGTH,
    );
    if (improvements.length > 0) {
      return { interviewPractice: { issues: improvements } };
    }
  }

  // 優先順位 2: 自己記録
  const selfNoted = [
    toTrimmedString(rec.improvement_summary),
    toTrimmedString(rec.what_went_wrong),
  ]
    .filter((v) => v !== '')
    .slice(0, MAX_PRACTICE_ITEMS)
    .map((v) => truncate(v, MAX_PRACTICE_ITEM_LENGTH));
  if (selfNoted.length > 0) {
    return { interviewPractice: { issues: selfNoted } };
  }

  return {};
}

// ISO 文字列 → JST の年月日（不正値は ''）。section builder は純粋関数のため日時整形はここで行う。
function formatDateJst(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return '';
  }
}

// ── source unit: read（Spine）+ project（Tutor）────────────────────
//
// 1 unit = 1 kind の「読んで Tutor 向けに解釈する」まで。
// enrichment を伴う presentation も 1 unit に閉じるため、並列性と query 本数は移設前と同じ。

async function runSelfAnalysisUnit(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  const state = await readLatestSelfAnalysisRow(client, userId, TUTOR_READ_OPTIONS);
  return projectSelfAnalysis(sourceValueOrNull(state));
}

async function runBasicInfoUnit(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  const state = await readBasicInfoSnapshot(client, userId, TUTOR_READ_OPTIONS);
  return projectBasicInfo(sourceValueOrNull(state));
}

async function runDiagnosisUnit(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  const state = await readDiagnosisSnapshot(client, userId, TUTOR_READ_OPTIONS);
  return projectDiagnosis(sourceValueOrNull(state));
}

async function runActivityUnit(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  const state = await readActivitySnapshot(client, userId, TUTOR_READ_OPTIONS);
  return projectActivity(sourceValueOrNull(state));
}

async function runInterviewAiUnit(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  const state = await readLatestInterviewAiRow(client, userId, TUTOR_READ_OPTIONS);
  return projectInterviewAi(sourceValueOrNull(state));
}

// core → （使えるときだけ）enrichment の 2 段。
//   - core が空 / feedback が使えない場合は enrichment の query を発行しない。
//   - enrichment 失敗は無視（core feedback のみで section を出す）。
async function runPresentationUnit(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  const coreState = await readLatestPresentationResultRow(
    client,
    userId,
    TUTOR_READ_OPTIONS,
  );
  const core = projectPresentationCore(sourceValueOrNull(coreState));
  if (!core.usable || !core.built) return {};

  let university = '';
  let faculty = '';
  let theme = '';
  if (core.attemptId) {
    const sessionState = await readPresentationSessionByAttempt(
      client,
      core.attemptId,
    );
    const projected = projectPresentationSession(sourceValueOrNull(sessionState));
    university = projected.university;
    faculty = projected.faculty;
    theme = projected.theme;
  }

  const { date, overall, goodPoints, improvements, nextPractice, categories } =
    core.built;

  return {
    presentation: {
      ...(date !== undefined ? { date } : {}),
      ...(university !== '' ? { university } : {}),
      ...(faculty !== '' ? { faculty } : {}),
      ...(theme !== '' ? { theme } : {}),
      ...(overall !== undefined ? { overall } : {}),
      ...(goodPoints !== undefined ? { goodPoints } : {}),
      ...(improvements !== undefined ? { improvements } : {}),
      ...(nextPractice !== undefined ? { nextPractice } : {}),
      ...(categories !== undefined ? { categories } : {}),
    },
  };
}

async function runStatementReviewUnit(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  const state = await readLatestStatementReviewRow(client, userId, TUTOR_READ_OPTIONS);
  return projectStatementReview(sourceValueOrNull(state));
}

async function runEssayUnit(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  const state = await readLatestEssayReviewsRow(client, userId, TUTOR_READ_OPTIONS);
  return projectEssay(sourceValueOrNull(state));
}

async function runInterviewPracticeUnit(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  const state = await readLatestInterviewPracticeRow(client, userId, TUTOR_READ_OPTIONS);
  return projectInterviewPractice(sourceValueOrNull(state));
}

// ── 主 entry: loadTutorStudentContext ────────────────────────────
//
// userId scope で Supabase の各 auth-scoped durable から保存済み生徒情報を取得し、
// TutorStudentContext を返す。throw しない。各 source は allSettled で部分成功を許容し、
// 失敗は console.warn のみ。client は 1 回だけ生成して全 unit で共有する。

function emptyTutorStudentContext(): TutorStudentContext {
  return {
    sourceSummary: {
      hasSelfAnalysis: false,
      hasBasicInfo: false,
      hasDiagnosis: false,
      hasActivity: false,
      hasInterviewAi: false,
      hasPresentation: false,
      hasStatementReview: false,
      hasEssay: false,
      hasInterviewPractice: false,
    },
  };
}

/** Phase 3.5: canary ON のときだけ読む parity source を含めるかどうか。 */
export type LoadTutorStudentContextOptions = {
  /**
   * true … statement_review / essay / interview_record も読む（canary ON 用）。
   * false（既定）… Phase 3 までの 6 source のみ。**query を 3 本増やさない。**
   */
  includeParitySources?: boolean;
};

export async function loadTutorStudentContext(
  userId: string,
  // STEP-TUTOR-ROUTING-AUDIT-01 (P0): user-scoped supabase client を外から注入できる。
  //   route 側で auth 済の client を渡すと、本関数内での client 再生成
  //   （= cookie 再パース）を避けられる。未指定なら従来どおり自前で生成する（後方互換）。
  //   ⚠️ 注入してよいのは anon key + RLS の user-scoped client のみ（service_role 禁止）。
  injectedClient?: SupabaseClient | null,
  options?: LoadTutorStudentContextOptions,
): Promise<TutorStudentContext> {
  const empty = emptyTutorStudentContext();

  if (!userId) return empty;

  const client = await resolveExamSpineClient(injectedClient);
  if (!client) {
    // env 未設定 / cookie 無し（未ログイン相当）。静かに空を返す。
    return empty;
  }

  // 並列実行 + 所要時間の観測は Spine 側（loadExamSources）。
  // unit の並び・timingKey・ログ label は移設前と同一に保つ。
  const settled = await loadExamSources<Partial<TutorStudentContext>>(
    [
      { timingKey: 'selfAnalysis_ms', run: () => runSelfAnalysisUnit(client, userId) },
      { timingKey: 'basicInfo_ms', run: () => runBasicInfoUnit(client, userId) },
      { timingKey: 'diagnosis_ms', run: () => runDiagnosisUnit(client, userId) },
      { timingKey: 'activity_ms', run: () => runActivityUnit(client, userId) },
      { timingKey: 'interviewAi_ms', run: () => runInterviewAiUnit(client, userId) },
      { timingKey: 'presentation_ms', run: () => runPresentationUnit(client, userId) },
      // Phase 3.5 parity source。canary OFF では unit ごと積まない = query ゼロ。
      ...(options?.includeParitySources
        ? [
            {
              timingKey: 'statementReview_ms',
              run: () => runStatementReviewUnit(client, userId),
            },
            { timingKey: 'essay_ms', run: () => runEssayUnit(client, userId) },
            {
              timingKey: 'interviewPractice_ms',
              run: () => runInterviewPracticeUnit(client, userId),
            },
          ]
        : []),
    ],
    {
      timingLabel: '[TutorContextSources]',
      logMeta: { clientInjected: injectedClient != null },
    },
  );
  if (!settled) return empty;

  const merged: TutorStudentContext = {
    sourceSummary: { ...empty.sourceSummary },
  };
  for (const r of settled) {
    if (r.status !== 'fulfilled') {
      console.warn('tutor supabase context: source rejected');
      continue;
    }
    const v = r.value;
    if (v.selfAnalysis) {
      merged.selfAnalysis = v.selfAnalysis;
      merged.sourceSummary.hasSelfAnalysis = true;
    }
    if (v.basicInfo) {
      merged.basicInfo = v.basicInfo;
      merged.sourceSummary.hasBasicInfo = true;
    }
    if (v.diagnosis) {
      merged.diagnosis = v.diagnosis;
      merged.sourceSummary.hasDiagnosis = true;
    }
    if (v.activity) {
      merged.activity = v.activity;
      merged.sourceSummary.hasActivity = true;
    }
    if (v.interviewAi) {
      merged.interviewAi = v.interviewAi;
      merged.sourceSummary.hasInterviewAi = true;
    }
    if (v.presentation) {
      merged.presentation = v.presentation;
      merged.sourceSummary.hasPresentation = true;
    }
    if (v.statementReview) {
      merged.statementReview = v.statementReview;
      merged.sourceSummary.hasStatementReview = true;
    }
    if (v.essay) {
      merged.essay = v.essay;
      merged.sourceSummary.hasEssay = true;
    }
    if (v.interviewPractice) {
      merged.interviewPractice = v.interviewPractice;
      merged.sourceSummary.hasInterviewPractice = true;
    }
  }

  return merged;
}

// ── per-user context cache（STEP-TUTOR-ROUTING-AUDIT-01 P0）──────────
//
// loadTutorStudentContext の結果を userId 単位で短期キャッシュする。
// 目的: 同一会話の連続ターンで Supabase の read を毎ターン繰り返さず、pre-Claude の
//       レイテンシを削る。取得「内容」は intent / feature に依存しないため userId だけを key にする。
//
// 器は Spine（lib/contextBuilders/tutor/serverRead/snapshotCache.server.ts）。TTL と「保存してよいか」の
// 判断だけを Tutor 側で与える。意味論は移設前と同一:
//   - TTL 60 秒。生徒情報は分単位では変わらないため品質中立（prompt 側も「参考情報・
//     古い可能性あり・最新発言優先」と明記済み）。
//   - 全 source 空はキャッシュしない。loadTutorStudentContext は never-throw で一時的失敗も
//     空に倒れるため、空を 60 秒 hit として固定すると生徒情報を隠してしまう。
//   - invalidation は TTL のみ。保存情報の更新は最大 60 秒で反映される。
//   - truncation / 要約 / tiering はしない（品質は cache 有無で不変）。
const CONTEXT_CACHE_TTL_MS = 60_000;

function hasAnySource(ctx: TutorStudentContext): boolean {
  const s = ctx.sourceSummary;
  return (
    s.hasSelfAnalysis ||
    s.hasBasicInfo ||
    s.hasDiagnosis ||
    s.hasActivity ||
    s.hasInterviewAi ||
    s.hasPresentation ||
    s.hasStatementReview ||
    s.hasEssay ||
    s.hasInterviewPractice
  );
}

const contextCache = createExamSpineSnapshotCache<TutorStudentContext>({
  ttlMs: CONTEXT_CACHE_TTL_MS,
  shouldCache: hasAnySource,
});

/**
 * loadTutorStudentContext の 60 秒 per-user キャッシュ付きラッパ。
 * 戻り値に cacheHit を含め、呼び出し側でレイテンシログに使えるようにする。
 * throw しない（内部の loadTutorStudentContext が never-throw）。
 *
 * ⚠️ cache hit は認可の代替ではない。呼び出し側（route）は毎 request 認証・quota を
 *    評価したうえで本関数を呼ぶこと。
 */
export async function loadTutorStudentContextCached(
  userId: string,
  injectedClient?: SupabaseClient | null,
  options?: LoadTutorStudentContextOptions,
): Promise<{ context: TutorStudentContext; cacheHit: boolean }> {
  if (!userId) return { context: emptyTutorStudentContext(), cacheHit: false };

  // cache key に parity mode を含める。含めないと canary OFF で作られた
  // 「parity source 抜き」の context を ON の request へ配ってしまう（逆も同様）。
  const cacheKey = options?.includeParitySources ? `${userId}|parity` : userId;

  // now は load の前後で共有する（load 後に取り直すと実効 TTL が伸びる）。
  const now = Date.now();
  const cached = contextCache.get(cacheKey, now);
  if (cached) return { context: cached, cacheHit: true };

  const context = await loadTutorStudentContext(userId, injectedClient, options);
  contextCache.set(cacheKey, context, now);
  return { context, cacheHit: false };
}

// ── buildTutorSupabaseContextSection ─────────────────────────────
//
// TutorStudentContext を SYSTEM prompt 追加用の単一 section 文字列へ整形する純粋関数。
// 4 source（basic_info / self_analysis / activity / diagnosis）を 1 つの
// 【保存済みの生徒情報】 section に統合する（source ごとに block を増やさない）。
//
// 規約:
//   - 全 source 空なら '' を返す（route 側は空なら block ごと省略する）。
//   - 空 source は行ごと省略する。
//   - 冒頭に「参考情報 / 最新発言優先 / 矛盾時は確認」を必ず入れる。
//   - raw JSON を出さない。断定しない（「あなたは〜です」禁止）。
//   - 「保存情報では」「過去入力では」を使う。section 全体 1200 字以内。
//
// 純粋関数: fetch / Supabase / Date / Math.random なし。
/**
 * Tutor context section の文字数上限（characters。token ではない）。
 *   default … canary OFF。Phase 3 までと同じ 1200。
 *   parity  … canary ON。parity source の分だけ広げた 1800。
 *
 * QA から参照できるよう export する（cap を test 側で重複定義して drift させないため）。
 */
export const TUTOR_CONTEXT_SECTION_CAPS = {
  default: MAX_TOTAL_LENGTH,
  parity: MAX_TOTAL_LENGTH_PARITY,
} as const;

/**
 * 可変の生徒情報行を、与えられた budget（characters）に収まるところまで残す。
 *
 * 方針:
 *   - **行単位で落とす。** 行の途中で slice しない。
 *     日本語 / サロゲートペア / 「」の対応が壊れないことをこれで保証する。
 *   - 前から詰めて、入らなくなった時点で以降を落とす（順序＝重要度）。
 *     lines は basicInfo → selfAnalysis → activity → diagnosis → interviewAi →
 *     presentation → parity の順に積まれているため、素性に近い情報ほど残る。
 *   - 省略マーカーは付けない。既存 truncate helper にマーカーの慣習が無く、
 *     ここで独自表現を足すと prompt 文言を増やすことになるため。
 *     落ちた行は「未入力」と同じく **情報が無い**ものとして扱われ、
 *     rulesBlock の「推測・補完しない」「未入力を責めない」で安全側に倒れる。
 *
 * @param budget 使ってよい文字数。0 以下なら空文字。
 */
function fitContextLines(lines: readonly string[], budget: number): string {
  if (budget <= 0) return '';

  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    // 2 行目以降は連結する改行 1 文字も予算に含める。
    const cost = kept.length === 0 ? line.length : line.length + 1;
    if (used + cost > budget) break;
    kept.push(line);
    used += cost;
  }
  return kept.join('\n');
}

export type BuildTutorSupabaseContextSectionOptions = {
  /**
   * Phase 3.5: canary ON のときだけ true。
   *   true  … track と parity source（志望理由書 / 小論文 / 対人面接練習）を描画し、
   *           section 全体の上限を MAX_TOTAL_LENGTH_PARITY へ広げる。
   *   false（既定）… Phase 3 までと **byte-identical** な出力（rollback path）。
   */
  includeParity?: boolean;
};

export function buildTutorSupabaseContextSection(
  context: TutorStudentContext,
  options?: BuildTutorSupabaseContextSectionOptions,
): string {
  const includeParity = options?.includeParity === true;
  const lines: string[] = [];

  // 1. 基本情報（学年 / 受験方式 / 志望校 / 志望分野）
  const bi = context.basicInfo;
  if (bi) {
    const head: string[] = [];
    if (bi.grade) head.push(bi.grade);
    // track は Phase 3.5 で復帰。OFF では描画しない（legacy 出力を 1 byte も変えない）。
    if (includeParity && bi.track) head.push(bi.track);
    if (bi.examType) head.push(`受験方式は${bi.examType}`);
    if (head.length > 0) {
      lines.push(`・保存情報では、${head.join('・')} のようです。`);
    }
    if (bi.targetSchools && bi.targetSchools.length > 0) {
      lines.push(
        `・過去入力では、志望校として${bi.targetSchools
          .map((s) => `「${s}」`)
          .join('')}が挙がっています。`,
      );
    }
    if (bi.targetFields && bi.targetFields.length > 0) {
      lines.push(
        `・保存情報では、志望分野として${bi.targetFields
          .map((s) => `「${s}」`)
          .join('')}への関心が見られます。`,
      );
    }
  }

  // 2. 自己分析（強み / 課題 / 将来の方向性 / 要約）
  const sa = context.selfAnalysis;
  if (sa) {
    if (sa.strengths && sa.strengths.length > 0) {
      lines.push(
        `・保存情報では、強みとして${sa.strengths
          .map((s) => `「${s}」`)
          .join('')}が整理されています。`,
      );
    }
    if (sa.weaknesses && sa.weaknesses.length > 0) {
      lines.push(
        `・過去入力では、課題として${sa.weaknesses
          .map((s) => `「${s}」`)
          .join('')}が挙がっています。`,
      );
    }
    if (sa.futureConnections && sa.futureConnections.length > 0) {
      lines.push(
        `・保存情報では、将来の方向性として${sa.futureConnections
          .map((s) => `「${s}」`)
          .join('')}が見られます。`,
      );
    }
    if (sa.summary) {
      lines.push(`・自己分析の要約: ${sa.summary}`);
    } else if (sa.appealPoints) {
      lines.push(`・自己PR で使えそうな要点: ${sa.appealPoints}`);
    }
  }

  // 3. 活動（カテゴリ別件数のみ）
  const ac = context.activity;
  if (ac) {
    const parts = Object.entries(ac.categoryCounts).map(
      ([label, n]) => `${label}${n}件`,
    );
    if (parts.length > 0) {
      lines.push(
        `・活動整理には、${parts.join('・')} が保存されています（計${ac.totalCount}件）。`,
      );
    }
  }

  // 4. 診断（タイプ名は出さず会話補助 hint）
  const dg = context.diagnosis;
  if (dg?.typeHint) {
    lines.push(`・保存情報からは、${dg.typeHint}。`);
  }

  // 5. 直近の AI 面接練習の結果（結果画面と同じ保存済み feedback。turn 履歴は含めない）。
  const ia = context.interviewAi;
  if (ia) {
    const head = ia.date ? `${ia.date}実施の${ia.modeLabel}` : ia.modeLabel;
    lines.push(`・直近のAI面接練習（${head}）の結果が保存されています。`);
    if (ia.overall) {
      lines.push(`  - 総合評価: ${ia.overall}`);
    }
    if (ia.goodPoints && ia.goodPoints.length > 0) {
      lines.push(
        `  - 良かった点: ${ia.goodPoints.map((s) => `「${s}」`).join('')}`,
      );
    }
    if (ia.improvements && ia.improvements.length > 0) {
      lines.push(
        `  - 改善点: ${ia.improvements.map((s) => `「${s}」`).join('')}`,
      );
    }
    if (ia.nextPractice && ia.nextPractice.length > 0) {
      lines.push(
        `  - 次に練習すると良い点: ${ia.nextPractice.map((s) => `「${s}」`).join('')}`,
      );
    }
  }

  // 6. 直近のプレゼン練習の結果（結果画面と同じ保存済み feedback。録画 / STT 全文 / Q&A 履歴は含めない）。
  const pr = context.presentation;
  if (pr) {
    const headParts: string[] = [];
    if (pr.date) headParts.push(`${pr.date}実施`);
    if (pr.university) {
      headParts.push(pr.faculty ? `${pr.university} ${pr.faculty}` : pr.university);
    }
    const head = headParts.join('・');
    lines.push(
      `・直近のプレゼン練習${head ? `（${head}）` : ''}の結果が保存されています。`,
    );
    if (pr.theme) {
      lines.push(`  - 発表テーマ: ${pr.theme}`);
    }
    if (pr.overall) {
      lines.push(`  - 総合評価: ${pr.overall}`);
    }
    if (pr.categories && pr.categories.length > 0) {
      lines.push(
        `  - カテゴリ評価: ${pr.categories.map((c) => `${c.label}=${c.level}`).join(' / ')}`,
      );
    }
    if (pr.goodPoints && pr.goodPoints.length > 0) {
      lines.push(
        `  - 良かった点: ${pr.goodPoints.map((s) => `「${s}」`).join('')}`,
      );
    }
    if (pr.improvements && pr.improvements.length > 0) {
      lines.push(
        `  - 改善点: ${pr.improvements.map((s) => `「${s}」`).join('')}`,
      );
    }
    if (pr.nextPractice && pr.nextPractice.length > 0) {
      lines.push(
        `  - 次に練習すると良い点: ${pr.nextPractice.map((s) => `「${s}」`).join('')}`,
      );
    }
  }

  // 6. Phase 3.5 parity source（canary ON のみ）。
  //    legacy block2 と同じ意味論。本文・点数は載せず課題だけを短く出す。
  if (includeParity) {
    const sr = context.statementReview;
    if (sr && sr.weaknesses.length > 0) {
      lines.push(
        `・志望理由書レビューの直近の課題: ${sr.weaknesses.join(' / ')}`,
      );
    }
    const es = context.essay;
    if (es && es.weakPoints.length > 0) {
      lines.push(`・小論文添削の直近の課題: ${es.weakPoints.join(' / ')}`);
    }
    const ip = context.interviewPractice;
    if (ip && ip.issues.length > 0) {
      lines.push(`・面接練習（対人）の課題: ${ip.issues.join(' / ')}`);
    }
  }

  if (lines.length === 0) return '';

  // ── 組み立て（固定領域は truncate 対象にしない）────────────────────
  //
  // 以前は header + 可変行 + 扱い方ルール を 1 本に連結してから section 全体を
  // truncate していた。その結果、保存情報が多い生徒では **末尾のルールが丸ごと
  // 消え**、AI に「生徒データだけ渡してその扱い方を渡さない」状態が起きていた
  // （canary 以前からの本番不具合）。
  //
  // 削ってよいのは生徒ごとに伸び縮みする可変行だけで、ルールは常に完全に残す。
  // そのため先にルール分の budget を確保し、残りを可変行に割り当てる。
  const headerBlock = [
    '【保存済みの生徒情報】',
    '以下は過去の入力に基づく参考情報です。最新のユーザー発言を常に最優先してください。',
    '保存情報と最新の発言が食い違う場合は、断定せず確認質問をしてください。',
    '',
  ].join('\n');

  // ⚠️ この block は atomic。1 行たりとも欠けさせない・文言を書き換えない。
  //    AI の振る舞いを制御するルールであり、内容改善ではなく「必ず残す」が目的。
  const rulesBlock = [
    '・注意: 志望校・進路・学力は変わる可能性があるため、断定せず必要に応じて確認してください。',
    '',
    'この生徒情報の扱い方:',
    '・参考情報です。古い可能性があるため断定せず、必要なときだけ自然に参照してください。',
    '・ここに無い個人情報を推測・補完したり、「未入力」を責めたりしないでください。',
  ].join('\n');

  // parity ON では出力が増えるため上限を広げる。既定（OFF）は 1200 のまま。
  const cap = includeParity ? MAX_TOTAL_LENGTH_PARITY : MAX_TOTAL_LENGTH;

  // 可変行に使える文字数。固定 2 block と、それらを繋ぐ改行 2 文字を先に引く。
  const budget = cap - headerBlock.length - rulesBlock.length - 2;
  const body = fitContextLines(lines, budget);

  // 可変行が 1 行も入らないなら section 自体を出さない。
  // 「生徒情報」と言いながら中身が無い block を prompt に置かないため
  //   （lines.length === 0 のときに '' を返す既存挙動と同じ意味論）。
  if (body === '') return '';

  return [headerBlock, body, rulesBlock].join('\n');
}
