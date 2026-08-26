// PASSAI 受験版 Exam Spine — Stage 3 query shape（純関数・データのみ）。
//
// 各 kind の SELECT を「データ」として宣言する。実行はしない。
//
// ordering の正本（Stage 3 §Ordering）:
//   basic_info / activity / diagnosis  user_id UNIQUE → maybeSingle（ordering 不要）
//   self_analysis                      created_at DESC, id DESC
//   statement_review                   created_at DESC, id DESC   ※updated_at を recency に使わない
//   interview_record                   created_at DESC, id DESC
//   essay                              updated_at DESC, created_at DESC, id DESC
//                                      ※workspace->>'updatedAt' を ORDER BY に使わない
//   self_pr                            updated_at DESC, created_at DESC, id DESC
//                                      ※pr_index は表示順であって recency ではない
//   interview_ai                       result が実在する最新 record（E-S18）
//   presentation                       presentation_results created_at DESC, id DESC
//
// tie-break として必ず `id DESC` を最後に置く。created_at / updated_at は同一秒に複数行が
// 入り得るため、これが無いと PostgREST の返却順が不定になり結果が非決定的になる。
//
// ★ 「読まない列」も設計判断である（E-P5 / 最小権限）★
//   statement_review_history.essay                     … 志望理由書の本文
//   interview_practice_records.questions_asked/my_answers … 面接の逐語
//   interview_ai_turns（table ごと）                    … 面接の逐語
//   presentation_attempts.transcript / storage_path     … 逐語と Storage path
//   presentation_sessions.script / material_path        … 発表原稿と Storage path
//   *_mirrors（anonymous mirror）                       … owner scope を持たない
//   presentation_practice_records                       … dormant_no_author（E-S16）
//   これらは列配列に現れないことで構造的に保証され、Stage 3 QA が freeze する。

import type { ExamReadQuery } from './types';
import { EXAM_READ_CAPS } from './types';

const OWNER_COLUMN = 'user_id';

function owner(userId: string) {
  return { op: 'eq', column: OWNER_COLUMN, value: userId } as const;
}

/** created_at / updated_at の同値衝突を id で必ず解く。 */
const ID_TIEBREAK = { column: 'id', ascending: false } as const;

// ── snapshot 型（user_id UNIQUE / maybeSingle）─────────────────────────

function snapshotQuery(
  kind: 'basic_info' | 'activity' | 'diagnosis',
  table: string,
  userId: string,
): ExamReadQuery {
  return {
    kind,
    role: 'core',
    table,
    columns: ['payload', 'schema_version', 'source_hash', 'created_at', 'updated_at'],
    filters: [owner(userId)],
    order: [],
    limit: null,
    mode: 'maybeSingle',
  };
}

export function basicInfoQuery(userId: string): ExamReadQuery {
  return snapshotQuery('basic_info', 'basic_info_logs', userId);
}

export function activityQuery(userId: string): ExamReadQuery {
  return snapshotQuery('activity', 'activity_logs', userId);
}

export function diagnosisQuery(userId: string): ExamReadQuery {
  return snapshotQuery('diagnosis', 'diagnosis_logs', userId);
}

// ── history 型 ────────────────────────────────────────────────────────

export function selfAnalysisQuery(userId: string): ExamReadQuery {
  return {
    kind: 'self_analysis',
    role: 'core',
    table: 'self_analysis_logs',
    columns: [
      'id',
      'analysis',
      'summary',
      'displayed_questions',
      'answers',
      'deep_answers',
      'free_memo',
      'created_at',
    ],
    filters: [owner(userId)],
    order: [{ column: 'created_at', ascending: false }, ID_TIEBREAK],
    limit: EXAM_READ_CAPS.self_analysis + 1,
    mode: 'many',
  };
}

export function statementReviewQuery(userId: string): ExamReadQuery {
  return {
    kind: 'statement_review',
    role: 'core',
    table: 'statement_review_history',
    // essay（志望理由書の本文）は読まない。result は divergence の材料として必要。
    columns: [
      'id',
      'local_review_id',
      'university',
      'faculty',
      'department',
      'result',
      'created_at',
    ],
    filters: [owner(userId)],
    // updated_at は「行が触られた時刻」であって添削が行われた時刻ではないため recency に使わない。
    order: [{ column: 'created_at', ascending: false }, ID_TIEBREAK],
    limit: EXAM_READ_CAPS.statement_review + 1,
    mode: 'many',
  };
}

export function selfPrQuery(userId: string): ExamReadQuery {
  return {
    kind: 'self_pr',
    role: 'core',
    table: 'self_prs',
    columns: [
      'id',
      'local_pr_id',
      'pr_index',
      'title',
      'body',
      'latest_result',
      'created_at',
      'updated_at',
    ],
    filters: [owner(userId)],
    // 自己PR は in-place 編集されるため updated_at が recency の正本。
    // pr_index はカード表示順であって新しさではないので ORDER BY に使わない。
    order: [
      { column: 'updated_at', ascending: false },
      { column: 'created_at', ascending: false },
      ID_TIEBREAK,
    ],
    limit: EXAM_READ_CAPS.self_pr + 1,
    mode: 'many',
  };
}

export function essayQuery(userId: string): ExamReadQuery {
  return {
    kind: 'essay',
    role: 'core',
    table: 'essay_workspaces',
    columns: ['id', 'local_workspace_id', 'workspace', 'created_at', 'updated_at'],
    filters: [owner(userId)],
    // workspace->>'updatedAt'（jsonb 内の値）は index も型保証も無く NULL 順序も不定。
    // recency は column の updated_at を正本にする。
    order: [
      { column: 'updated_at', ascending: false },
      { column: 'created_at', ascending: false },
      ID_TIEBREAK,
    ],
    limit: EXAM_READ_CAPS.essay + 1,
    mode: 'many',
  };
}

export function interviewRecordQuery(userId: string): ExamReadQuery {
  return {
    kind: 'interview_record',
    role: 'core',
    table: 'interview_practice_records',
    // questions_asked / my_answers（逐語）は読まない。
    columns: [
      'id',
      'local_record_id',
      'practice_date',
      'university_name',
      'faculty_name',
      'exam_type',
      'main_question',
      'improvement_summary',
      'what_went_wrong',
      'feedback_received',
      'self_noted',
      'feedback_json',
      'created_at',
    ],
    filters: [owner(userId)],
    order: [{ column: 'created_at', ascending: false }, ID_TIEBREAK],
    limit: EXAM_READ_CAPS.interview_record + 1,
    mode: 'many',
  };
}

/**
 * interview_ai（E-S18）。
 *
 * ★ 旧方式は使わない ★
 *   「最新の completed session を取り、その session の result を探す」という順は、
 *   production の実形状（completed session が多数 / result は少数）では空振りが常態化する。
 *   最新 session に result が無いだけで、実在する過去の result まで一切見えなくなる。
 *
 * ★ canonical: **result が実在する最新 record を driver にする** ★
 *   driver table = interview_ai_results。session は embed で解決する。
 *
 * ★ ownership は session 側で確認する ★
 *   results 側にも user_id は複製されているが、RLS（schema §60）は
 *   「親 interview_ai_sessions が自分のものか」を EXISTS で判定する設計である。
 *   同じ保証を query 側でも構造化するため `!inner` + `session.user_id` の filter を置き、
 *   「親が自分のものである result」だけに閉じる。results 側の eq(user_id) も併記する（二重防御）。
 *
 * ★ interview_ai_turns（逐語）は SELECT しない。
 */
export function interviewAiQuery(userId: string): ExamReadQuery {
  return {
    kind: 'interview_ai',
    role: 'core',
    table: 'interview_ai_results',
    columns: [
      'id',
      'session_id',
      'feedback',
      'strengths',
      'improvements',
      'next_practice',
      'created_at',
    ],
    embed: {
      alias: 'session',
      table: 'interview_ai_sessions',
      inner: true,
      columns: ['id', 'user_id', 'status', 'interview_type', 'source', 'created_at'],
    },
    filters: [owner(userId), { op: 'eq', column: 'session.user_id', value: userId }],
    order: [{ column: 'created_at', ascending: false }, ID_TIEBREAK],
    limit: EXAM_READ_CAPS.interview_ai + 1,
    mode: 'many',
  };
}

// ── presentation ──────────────────────────────────────────────────────
//
//   presentation_results ──attempt_id──▶ presentation_attempts ──session_id──▶ presentation_sessions
//   （core）                              （enrichment 1）                      （enrichment 2）
//
// core が空なら enrichment query は 0 本。enrichment の失敗で core を失敗扱いにしない。
// embed で 1 発にしないのは、その 2 つの性質を明示的に分けて持つため
// （embed だと親の失敗が行ごと落とし、core だけ活かす経路が作れない）。

export function presentationCoreQuery(userId: string): ExamReadQuery {
  return {
    kind: 'presentation',
    role: 'core',
    table: 'presentation_results',
    columns: [
      'id',
      'attempt_id',
      'feedback',
      'categories',
      'qa_summary',
      'final_report',
      'created_at',
    ],
    filters: [owner(userId)],
    order: [{ column: 'created_at', ascending: false }, ID_TIEBREAK],
    limit: EXAM_READ_CAPS.presentation + 1,
    mode: 'many',
  };
}

/** enrichment 1: attempt。transcript / storage_path は読まない。 */
export function presentationAttemptsQuery(
  userId: string,
  attemptIds: readonly string[],
): ExamReadQuery {
  return {
    kind: 'presentation',
    role: 'enrichment',
    table: 'presentation_attempts',
    columns: ['id', 'session_id', 'attempt_index', 'duration_sec', 'status', 'created_at'],
    filters: [owner(userId), { op: 'in', column: 'id', values: attemptIds }],
    order: [{ column: 'id', ascending: true }],
    limit: attemptIds.length,
    mode: 'many',
  };
}

/** enrichment 2: session。script / material_path は読まない。 */
export function presentationSessionsQuery(
  userId: string,
  sessionIds: readonly string[],
): ExamReadQuery {
  return {
    kind: 'presentation',
    role: 'enrichment',
    table: 'presentation_sessions',
    columns: [
      'id',
      'university_name',
      'faculty_name',
      'department_name',
      'admission_type',
      'presentation_format',
      'theme',
      'university_notes',
      'created_at',
    ],
    filters: [owner(userId), { op: 'in', column: 'id', values: sessionIds }],
    order: [{ column: 'id', ascending: true }],
    limit: sessionIds.length,
    mode: 'many',
  };
}
