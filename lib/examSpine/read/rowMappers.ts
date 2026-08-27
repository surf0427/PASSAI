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
  toIndexedRecordArray,
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
  /**
   * ★ 生 `preferences` 配列を **正規化せずに** 報告したもの（E-S51）★
   *
   *   `preferences` は「record でない要素を捨て、`university` が string でない行も捨てて
   *   詰めた」正規化列である。一方、legacy tutor consumer は同じ配列を
   *   「**生配列の先頭 N slot** を見て、その中の record だけを使う」規則で読む。
   *   詰めたあとの列からは「どの生 slot が捨てられた要素に消費されたか」も
   *   「捨てた行が持っていた faculty」も復元できないため、両者は原理的に一致しない。
   *
   *   ここでは record だった要素を **落とさず**、`sourceIndex`（生配列の index）を
   *   添えて報告する。これは payload に対する事実であって feature の方針ではないので
   *   read layer の責務に収まる（E-S20 / mapper は policy を持たない）。
   *   どの slot を採るか・`university` が無い行を使うかは consumer が決める。
   *
   *   ⚠️ AI-visible ではない。prompt / section / sync fingerprint のいずれにも入らない
   *     （`basicInfoSyncView` は `preferences` だけを見る `Pick` で受ける）。
   *   ⚠️ `preferences` と同じ走査・同じ cap（`limits.recordItems`）で作る。
   *     別 cap を持たせると 2 つ目の切り方が生まれる。
   */
  rawPreferences: readonly ExamBasicInfoRawPreference[];
  subjectGrades: Record<string, string> | null;
  schemaVersion: string | null;
};

/**
 * 生 `preferences` 配列の 1 slot（record だったものだけ）。
 *
 * `university` / `faculty` / `department` は **string でなければ `null`**。
 * `preferences` と違い、`university` が string でない行もここには残る
 * （その行が持つ `faculty` を legacy consumer が使っているため）。
 */
export type ExamBasicInfoRawPreference = {
  /** 生配列における index（詰めたあとの位置ではない）。 */
  readonly sourceIndex: number;
  readonly university: string | null;
  readonly faculty: string | null;
  readonly department: string | null;
};

export function mapBasicInfoRow(
  row: unknown,
  limits: ExamReadFieldLimits,
): ExamBasicInfoServerRow | null {
  const rec = asRecord(row);
  if (!rec) return null;
  const payload = asRecord(rec.payload);

  // ★ 走査は 1 回だけ ★ `preferences`（正規化列）と `rawPreferences`（事実列）は
  //   同じ record 集合・同じ cap から作る。別々に走査すると 2 つの切り方が生まれる。
  const preferences: ExamBasicInfoServerRow['preferences'] = [];
  const rawPreferences: ExamBasicInfoRawPreference[] = [];
  for (const { sourceIndex, record: pref } of toIndexedRecordArray(
    payload?.preferences,
    limits.recordItems,
  )) {
    const university = truncateString(pref.university, limits.shortText);
    const faculty = truncateString(pref.faculty, limits.shortText);
    const department = truncateString(pref.department, limits.shortText);
    // ★ 事実列は 1 行も落とさない（E-S51）★
    //   `university` が string でない行も、その行が持つ `faculty` を legacy consumer が
    //   使っている。落とすとその事実が消え、consumer 側で復元できない。
    rawPreferences.push({ sourceIndex, university, faculty, department });
    // ★ 正規化列で落とすのは「university が **string ですらない**」型不整合の行だけ。
    //   空文字（`university: ''`）は落とさない。「識別子が空の志望校を使うか」は
    //   consumer 側の判断であり、mapper が握ると policy が read layer に入り込む
    //   （legacy の prompt builder は空を落とすが、それは prompt 側の都合であって
    //    server row の事実ではない）。Stage 3 は事実をそのまま報告する。
    if (university === null) continue;
    preferences.push({ university, faculty, department });
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
    rawPreferences,
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

// ── essay（E-S27）─────────────────────────────────────────────────────
//
// ★★ 小論文の本文は server projection に入らない ★★
//   `essay_workspaces.workspace` は EssayWorkspace 全体の jsonb であり、
//     workspace.body                      … 小論文本文（正本）
//     workspace.reviews[*].essayBodySnapshot … 添削時点の本文の複製（最大 20 件）
//     workspace.improvementInProgress.rewriteDraft … 改善後リライト本文
//     workspace.sparring.answers[]        … 壁打ちへの本人回答
//   を含む。これを丸ごと projection へ載せると、AI context に必要のない本文が
//   1 read あたり最大「本文 × (1 + reviews 件数)」だけ bundle に載る。
//   Canon §55（Privacy Boundary）/ §56（Token Efficiency）/ E-P5 に反する。
//
//   query 側は `workspace->reviews` へ絞り（queries.ts:essayQuery）、
//   mapper 側は reviews の各 entry から **本文 snapshot を落として**採る。
//   `bodyOnServer: false` を型で固定してあるので、
//   「server 由来 essay に本文がある」と書いたコードは型検査で落ちる（E-P8 と同じ手法）。
//
// ★ reviews は append-only。**末尾が最新**（types/essay.ts:ReviewEntry / 最大 20 件）。
//   ここでは新しい順に並べ替えて `limits.recordItems` 件まで採る。
//   並べ替えは配列反転のみで、時刻の再解釈をしない（mapper は Date を持たない）。

export type ExamEssayReviewServerRow = {
  /** ★ essayBodySnapshot を持たないことの型レベルの目印。 */
  readonly bodyOnServer: false;
  totalScore: number | null;
  verdict: string | null;
  improvement: string | null;
  goodPoints: string[];
  weakPoints: string[];
  createdAt: string | null;
  /** 'ai' | 'partial' | 'fallback'。fallback は AI が正常出力していないことの印。 */
  source: string | null;
  parseError: boolean | null;
};

export type ExamEssayServerRow = {
  /** ★ workspace 本文（body / rewriteDraft / sparring answers）を持たない。 */
  readonly bodyOnServer: false;
  id: string | null;
  localWorkspaceId: string | null;
  /** 新しい順。`limits.recordItems` 件まで。 */
  reviews: ExamEssayReviewServerRow[];
  /** cap 前の元件数。`reviews.length` との差で truncation を検出できる。 */
  reviewCount: number;
  reviewsTruncated: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

/**
 * PostgREST の `->` は json / text のどちらでも返り得るため両方を受ける。
 * 解釈できなければ空配列（= 「reviews が無い」）に倒し、throw しない。
 */
function readReviewsArray(value: unknown): unknown[] {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

function mapEssayReview(
  value: unknown,
  limits: ExamReadFieldLimits,
): ExamEssayReviewServerRow | null {
  const rec = asRecord(value);
  if (!rec) return null;
  return {
    bodyOnServer: false,
    totalScore: asFiniteNumber(rec.totalScore),
    verdict: truncateString(rec.verdict, limits.shortText),
    improvement: truncateString(rec.improvement, limits.longText),
    goodPoints: toStringArray(rec.goodPoints, limits.arrayItems, limits.arrayItemLength),
    weakPoints: toStringArray(rec.weakPoints, limits.arrayItems, limits.arrayItemLength),
    createdAt: asString(rec.createdAt),
    source: truncateString(rec.source, limits.shortText),
    parseError: typeof rec.parseError === 'boolean' ? rec.parseError : null,
    // ★ essayBodySnapshot / breakdown / sourceIssueId は意図的に採らない。
  };
}

export function mapEssayRow(
  row: unknown,
  limits: ExamReadFieldLimits,
): ExamEssayServerRow | null {
  const rec = asRecord(row);
  if (!rec) return null;

  const all = readReviewsArray(rec.reviews);
  // 新しい順（append-only なので反転）。cap は元件数に対して判定する。
  const newestFirst = [...all].reverse();
  const reviews: ExamEssayReviewServerRow[] = [];
  for (const entry of newestFirst) {
    const mapped = mapEssayReview(entry, limits);
    if (!mapped) continue;
    reviews.push(mapped);
    if (reviews.length >= limits.recordItems) break;
  }

  return {
    bodyOnServer: false,
    id: asString(rec.id),
    localWorkspaceId: asString(rec.local_workspace_id),
    reviews,
    reviewCount: all.length,
    reviewsTruncated: all.length > limits.recordItems,
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
