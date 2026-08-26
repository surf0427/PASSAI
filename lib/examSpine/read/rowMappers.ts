// PASSAI 受験版 Exam Spine — Stage 3 row mapper（純関数のみ / E-S20）。
//
// 責務: **server row → 同型の projection**。それ以上のことをしない。
//
// 禁止:
//   Supabase / fetch / localStorage / server auth / Date / Date.now / Math.random /
//   prompt 文言 / 日本語見出し / feature ラベル / storage / **隠れた既定値**
//
// ★ `max` / `maxItemLength` は必ず required argument で受け取る。
//   mapper 内に既定値を置くと「なぜその長さか」という feature 都合が mapper に埋まり、
//   policy-free でなくなる。値の正本は readSources.ts の EXAM_READ_FIELD_LIMITS。
//
// ★ jsonb / embedded relation は guards.ts を通してからしか読まない。

import {
  asFiniteNumber,
  asRecord,
  asString,
  toRecordArray,
  toStringArray,
  truncateString,
  unwrapEmbedded,
} from './guards';

/** mapper が使う長さ上限。すべての mapper が引数で受け取る。 */
export type ExamReadFieldLimits = {
  /** 短い text column（大学名 / 学部名 / status / 評定など）。 */
  shortText: number;
  /** 長い text column（要約 / 課題 / 本文）。 */
  longText: number;
  /** string[] の最大件数。 */
  arrayItems: number;
  /** string[] の 1 要素の最大長。 */
  arrayItemLength: number;
  /** record[] の最大件数（志望校リスト等）。 */
  recordItems: number;
};

// ── basic_info（E-P8）───────────────────────────────────────
//
// ★★ `name` は server row に存在しない ★★
//   basic_info_logs.payload は writer（lib/supabase/basicInfoLogs.ts）が氏名を strip して
//   書く契約であり、schema の COMMENT にも明記されている。したがってここでは:
//     - `name: ''` を fabricate しない
//     - fake name を作らない
//     - `as BasicInfo` の unsafe cast をしない（`BasicInfo` は name 必須）
//     - server row に無い field を mapper で生成しない
//   Stage 2 の `ExamContextInput.basicInfo: BasicInfo | null` との衝突を無理に埋めるために
//   Stage 2 contract を壊さない。server 側は **server row 固有 type** として扱い、
//   `name` は bridge 側に残す。統合は Stage 4 の mixed-source resolution が行う。
export type ExamBasicInfoServerRow = {
  /**
   * 型レベルの目印。`false` リテラルに固定してあるので、
   * 「server 由来 basicInfo に氏名がある」と書いたコードは型検査で落ちる。
   */
  readonly nameOnServer: false;
  grade: string | null;
  track: string | null;
  overallGpa: string | null;
  examTypes: string[];
  preferences: { university: string; faculty: string | null; department: string | null }[];
  subjectGrades: Record<string, string> | null;
  schemaVersion: string | null;
};

export function mapBasicInfoRow(
  row: unknown,
  limits: ExamReadFieldLimits,
): ExamBasicInfoServerRow | null {
  const rec = asRecord(row);
  if (!rec) return null;
  const payload = asRecord(rec.payload);

  const preferences: ExamBasicInfoServerRow['preferences'] = [];
  for (const pref of toRecordArray(payload?.preferences, limits.recordItems)) {
    const university = truncateString(pref.university, limits.shortText);
    // ★ ここで落とすのは「university が **string ですらない**」型不整合の行だけ。
    //   空文字（`university: ''`）は落とさない。「識別子が空の志望校を使うか」は
    //   consumer 側の判断であり、mapper が握ると policy が read layer に入り込む
    //   （legacy の prompt builder は空を落とすが、それは prompt 側の都合であって
    //    server row の事実ではない）。Stage 3 は事実をそのまま報告する。
    if (university === null) continue;
    preferences.push({
      university,
      faculty: truncateString(pref.faculty, limits.shortText),
      department: truncateString(pref.department, limits.shortText),
    });
  }

  let subjectGrades: Record<string, string> | null = null;
  const rawGrades = asRecord(payload?.subjectGrades);
  if (rawGrades) {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawGrades)) {
      const text = truncateString(value, limits.shortText);
      if (text !== null) out[key] = text;
    }
    subjectGrades = out;
  }

  return {
    nameOnServer: false,
    grade: truncateString(payload?.grade, limits.shortText),
    track: truncateString(payload?.track, limits.shortText),
    overallGpa: truncateString(payload?.overallGpa, limits.shortText),
    examTypes: toStringArray(payload?.examTypes, limits.arrayItems, limits.arrayItemLength),
    preferences,
    subjectGrades,
    schemaVersion: asString(rec.schema_version),
  };
}

// ── activity ──────────────────────────────────────────────────────────
//
// payload は ActivityData 全体の snapshot。**中身を解釈しない**
// （カテゴリの日本語ラベル・表示順・件数の見せ方はすべて feature の責務）。
// 件数だけは「配列 value の length」という構造的事実なので、key を固定せずに数える。
export type ExamActivityServerRow = {
  payload: Record<string, unknown> | null;
  /** payload 内で配列だった key → その長さ。カテゴリ名を Spine 側で固定しない。 */
  categoryCounts: Record<string, number>;
  schemaVersion: string | null;
};

export function mapActivityRow(row: unknown): ExamActivityServerRow | null {
  const rec = asRecord(row);
  if (!rec) return null;
  const payload = asRecord(rec.payload);

  const categoryCounts: Record<string, number> = {};
  if (payload) {
    for (const [key, value] of Object.entries(payload)) {
      if (Array.isArray(value)) categoryCounts[key] = value.length;
    }
  }
  return { payload, categoryCounts, schemaVersion: asString(rec.schema_version) };
}

// ── diagnosis ─────────────────────────────────────────────────────────
//
// ★ Stage 2 の ExamContextInput に diagnosis 用 slot は無い（現行 prompt に diagnosis 由来
//   block が存在しないため）。Stage 3 は「読めること」だけを担保し、payload を解釈しない。
//   どう使うかは Stage 4 / Stage 2 follow-up の判断であり、ここで先取りしない。
export type ExamDiagnosisServerRow = {
  payload: Record<string, unknown> | null;
  schemaVersion: string | null;
};

export function mapDiagnosisRow(row: unknown): ExamDiagnosisServerRow | null {
  const rec = asRecord(row);
  if (!rec) return null;
  return { payload: asRecord(rec.payload), schemaVersion: asString(rec.schema_version) };
}

// ── self_analysis ─────────────────────────────────────────────────────

export type ExamSelfAnalysisServerRow = {
  id: string | null;
  createdAt: string | null;
  /** WallHittingResult 相当の jsonb。type assertion はしない。 */
  analysis: Record<string, unknown> | null;
  /** SummaryResult 相当の jsonb。 */
  summary: Record<string, unknown> | null;
  displayedQuestions: string[];
  answers: string[];
  deepAnswers: string[];
  freeMemo: string | null;
};

export function mapSelfAnalysisRow(
  row: unknown,
  limits: ExamReadFieldLimits,
): ExamSelfAnalysisServerRow | null {
  const rec = asRecord(row);
  if (!rec) return null;
  return {
    id: asString(rec.id),
    createdAt: asString(rec.created_at),
    analysis: asRecord(rec.analysis),
    summary: asRecord(rec.summary),
    displayedQuestions: toStringArray(rec.displayed_questions, limits.arrayItems, limits.longText),
    answers: toStringArray(rec.answers, limits.arrayItems, limits.longText),
    deepAnswers: toStringArray(rec.deep_answers, limits.arrayItems, limits.longText),
    freeMemo: truncateString(rec.free_memo, limits.longText),
  };
}

// ── statement_review ──────────────────────────────────────────────────

export type ExamStatementReviewServerRow = {
  id: string | null;
  localReviewId: string | null;
  university: string | null;
  faculty: string | null;
  department: string | null;
  /** StatementResult 相当の jsonb。 */
  result: Record<string, unknown> | null;
  createdAt: string | null;
};

export function mapStatementReviewRow(
  row: unknown,
  limits: ExamReadFieldLimits,
): ExamStatementReviewServerRow | null {
  const rec = asRecord(row);
  if (!rec) return null;
  return {
    id: asString(rec.id),
    localReviewId: asString(rec.local_review_id),
    university: truncateString(rec.university, limits.shortText),
    faculty: truncateString(rec.faculty, limits.shortText),
    department: truncateString(rec.department, limits.shortText),
    result: asRecord(rec.result),
    createdAt: asString(rec.created_at),
  };
}

// ── self_pr ───────────────────────────────────────────────────────────

export type ExamSelfPrServerRow = {
  id: string | null;
  localPrId: string | null;
  prIndex: number | null;
  title: string | null;
  body: string | null;
  latestResult: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export function mapSelfPrRow(
  row: unknown,
  limits: ExamReadFieldLimits,
): ExamSelfPrServerRow | null {
  const rec = asRecord(row);
  if (!rec) return null;
  return {
    id: asString(rec.id),
    localPrId: asString(rec.local_pr_id),
    prIndex: asFiniteNumber(rec.pr_index),
    title: truncateString(rec.title, limits.shortText),
    body: truncateString(rec.body, limits.longText),
    latestResult: truncateString(rec.latest_result, limits.longText),
    createdAt: asString(rec.created_at),
    updatedAt: asString(rec.updated_at),
  };
}

// ── essay ─────────────────────────────────────────────────────────────

export type ExamEssayServerRow = {
  id: string | null;
  localWorkspaceId: string | null;
  /**
   * EssayWorkspace 全体の jsonb。
   * ★ 本人の本文と AI レビューが同居するため、ここで 1 つの provenance ラベルを付けない。
   *   block 単位の provenance 判断は Stage 2 の責務（essay = ai_derived は必ず嘘になる）。
   */
  workspace: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export function mapEssayRow(row: unknown): ExamEssayServerRow | null {
  const rec = asRecord(row);
  if (!rec) return null;
  return {
    id: asString(rec.id),
    localWorkspaceId: asString(rec.local_workspace_id),
    workspace: asRecord(rec.workspace),
    createdAt: asString(rec.created_at),
    updatedAt: asString(rec.updated_at),
  };
}

// ── interview_record ──────────────────────────────────────────────────

export type ExamInterviewRecordServerRow = {
  id: string | null;
  localRecordId: string | null;
  practiceDate: string | null;
  universityName: string | null;
  facultyName: string | null;
  examType: string | null;
  mainQuestion: string | null;
  improvementSummary: string | null;
  whatWentWrong: string | null;
  feedbackReceived: string | null;
  selfNoted: string | null;
  /** InterviewFeedback 相当の jsonb。 */
  feedback: Record<string, unknown> | null;
  createdAt: string | null;
};

export function mapInterviewRecordRow(
  row: unknown,
  limits: ExamReadFieldLimits,
): ExamInterviewRecordServerRow | null {
  const rec = asRecord(row);
  if (!rec) return null;
  return {
    id: asString(rec.id),
    localRecordId: asString(rec.local_record_id),
    practiceDate: truncateString(rec.practice_date, limits.shortText),
    universityName: truncateString(rec.university_name, limits.shortText),
    facultyName: truncateString(rec.faculty_name, limits.shortText),
    examType: truncateString(rec.exam_type, limits.shortText),
    mainQuestion: truncateString(rec.main_question, limits.longText),
    improvementSummary: truncateString(rec.improvement_summary, limits.longText),
    whatWentWrong: truncateString(rec.what_went_wrong, limits.longText),
    feedbackReceived: truncateString(rec.feedback_received, limits.longText),
    selfNoted: truncateString(rec.self_noted, limits.longText),
    feedback: asRecord(rec.feedback_json),
    createdAt: asString(rec.created_at),
  };
}

// ── interview_ai ──────────────────────────────────────────────────────

export type ExamInterviewAiSessionProjection = {
  id: string | null;
  status: string | null;
  interviewType: string | null;
  source: string | null;
  createdAt: string | null;
};

export type ExamInterviewAiServerRow = {
  id: string | null;
  sessionId: string | null;
  /** InterviewFeedback 相当の jsonb。 */
  feedback: Record<string, unknown> | null;
  strengths: string[];
  improvements: string[];
  nextPractice: string[];
  createdAt: string | null;
  /**
   * embed した親 session。`!inner` なので本来必ず存在するが、
   * PostgREST は object / 配列 / null のいずれでも返し得るため guard を通す。
   * 取れなかった場合は null（呼び出し側が「所有を確認できていない」として扱う）。
   */
  session: ExamInterviewAiSessionProjection | null;
};

export function mapInterviewAiRow(
  row: unknown,
  limits: ExamReadFieldLimits,
): ExamInterviewAiServerRow | null {
  const rec = asRecord(row);
  if (!rec) return null;
  const sessionRec = unwrapEmbedded(rec.session);
  return {
    id: asString(rec.id),
    sessionId: asString(rec.session_id),
    feedback: asRecord(rec.feedback),
    strengths: toStringArray(rec.strengths, limits.arrayItems, limits.arrayItemLength),
    improvements: toStringArray(rec.improvements, limits.arrayItems, limits.arrayItemLength),
    nextPractice: toStringArray(rec.next_practice, limits.arrayItems, limits.arrayItemLength),
    createdAt: asString(rec.created_at),
    session: sessionRec
      ? {
          id: asString(sessionRec.id),
          status: truncateString(sessionRec.status, limits.shortText),
          interviewType: truncateString(sessionRec.interview_type, limits.shortText),
          source: truncateString(sessionRec.source, limits.shortText),
          createdAt: asString(sessionRec.created_at),
        }
      : null,
  };
}

// ── presentation ──────────────────────────────────────────────────────

export type ExamPresentationResultProjection = {
  id: string | null;
  attemptId: string | null;
  feedback: Record<string, unknown> | null;
  categories: Record<string, unknown> | null;
  qaSummary: Record<string, unknown> | null;
  finalReport: Record<string, unknown> | null;
  createdAt: string | null;
};

export type ExamPresentationAttemptProjection = {
  id: string | null;
  sessionId: string | null;
  attemptIndex: number | null;
  durationSec: number | null;
  status: string | null;
  createdAt: string | null;
};

export type ExamPresentationSessionProjection = {
  id: string | null;
  universityName: string | null;
  facultyName: string | null;
  departmentName: string | null;
  admissionType: string | null;
  presentationFormat: string | null;
  theme: string | null;
  universityNotes: string | null;
  createdAt: string | null;
};

/** core（result）+ enrichment（attempt / session）。enrichment は取れなければ null。 */
export type ExamPresentationServerRow = {
  result: ExamPresentationResultProjection;
  attempt: ExamPresentationAttemptProjection | null;
  session: ExamPresentationSessionProjection | null;
};

export function mapPresentationResultRow(
  row: unknown,
): ExamPresentationResultProjection | null {
  const rec = asRecord(row);
  if (!rec) return null;
  return {
    id: asString(rec.id),
    attemptId: asString(rec.attempt_id),
    feedback: asRecord(rec.feedback),
    categories: asRecord(rec.categories),
    qaSummary: asRecord(rec.qa_summary),
    finalReport: asRecord(rec.final_report),
    createdAt: asString(rec.created_at),
  };
}

export function mapPresentationAttemptRow(
  row: unknown,
  limits: ExamReadFieldLimits,
): ExamPresentationAttemptProjection | null {
  const rec = asRecord(row);
  if (!rec) return null;
  return {
    id: asString(rec.id),
    sessionId: asString(rec.session_id),
    attemptIndex: asFiniteNumber(rec.attempt_index),
    durationSec: asFiniteNumber(rec.duration_sec),
    status: truncateString(rec.status, limits.shortText),
    createdAt: asString(rec.created_at),
  };
}

export function mapPresentationSessionRow(
  row: unknown,
  limits: ExamReadFieldLimits,
): ExamPresentationSessionProjection | null {
  const rec = asRecord(row);
  if (!rec) return null;
  return {
    id: asString(rec.id),
    universityName: truncateString(rec.university_name, limits.shortText),
    facultyName: truncateString(rec.faculty_name, limits.shortText),
    departmentName: truncateString(rec.department_name, limits.shortText),
    admissionType: truncateString(rec.admission_type, limits.shortText),
    presentationFormat: truncateString(rec.presentation_format, limits.shortText),
    theme: truncateString(rec.theme, limits.longText),
    universityNotes: truncateString(rec.university_notes, limits.longText),
    createdAt: asString(rec.created_at),
  };
}
