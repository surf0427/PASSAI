// PASSAI 受験版 Exam Spine — Stage 4 Wave 2 / kind 別 sync view（純関数）。
//
//   raw record（reader projection） → sync view → normalize → fingerprint → observation
//
// ★ view の形が contract の凍結点である ★
//   registry.ts の `contentFields` と、ここで作る object の key 集合は **一致していなければ
//   ならない**（QA が検査する）。宣言だけ変えて実装が追随しない、あるいはその逆を防ぐ。
//
// ★ 引数の型は「view input shape」であって server row 型そのものではない ★
//   `Pick<Exam*ServerRow, …>` にしてあるので、Stage 3 の projection をそのまま渡せる一方、
//   device canonical 側（Wave 3）が localStorage の domain 型から同じ shape を作れば
//   **同一の関数**を通せる。E-P6（client / server で同一の pure selector を使う）を
//   view 層でも満たすための形。
//
// ★ この file は adoption を持たない ★
//   view を作るだけで、どちらを使うかも、どちらが新しいかも返さない。
//
// 非依存: I/O / clock / random / logging / network / DB / AI。

import type { ExamSourceKind } from '../../sourceData/types';
import { EXAM_READ_FIELD_LIMITS } from '../../read/readSources';
import type {
  ExamBasicInfoServerRow,
  ExamActivityServerRow,
  ExamDiagnosisServerRow,
  ExamSelfAnalysisServerRow,
  ExamStatementReviewServerRow,
  ExamSelfPrServerRow,
  ExamInterviewRecordServerRow,
  ExamEssayServerRow,
  ExamEssayReviewServerRow,
} from '../../read/rowMappers';
import { EXAM_SYNC_ADAPTER_CONTRACTS, EXAM_SYNC_VIEW_VERSION } from './registry';
import type { ExamSyncSupportedKind } from './registry';
import {
  EXAM_SYNC_NORMALIZE_VERSION,
  normalizeSyncTimestamp,
  sortSyncItems,
  syncFingerprint,
} from './normalize';
import type { ExamSyncObservation, ExamSyncSourceIdentity } from './types';
import { NO_SYNC_REVISION } from './types';

// ── snapshot kind（単数）──────────────────────────────────────────────

export type ExamBasicInfoSyncInput = Pick<
  ExamBasicInfoServerRow,
  'grade' | 'track' | 'overallGpa' | 'examTypes' | 'preferences' | 'subjectGrades' | 'schemaVersion'
>;

/**
 * ★ `name` は view に入らない ★
 *   writer（lib/supabase/basicInfoLogs.ts stripName）が書き込み前に落とすため server に
 *   存在しない。device 側の view も同じく落とすこと（入れると永久不一致になる）。
 *
 * `examTypes` / `preferences` の配列順は jsonb が verbatim で往復するため保持する（sort しない）。
 */
export function basicInfoSyncView(row: ExamBasicInfoSyncInput): Record<string, unknown> {
  return {
    grade: row.grade,
    track: row.track,
    overallGpa: row.overallGpa,
    examTypes: row.examTypes,
    preferences: row.preferences,
    subjectGrades: row.subjectGrades,
    schemaVersion: row.schemaVersion,
  };
}

export type ExamActivitySyncInput = Pick<ExamActivityServerRow, 'payload' | 'schemaVersion'>;

/** `categoryCounts` は payload の純粋な導出物なので入れない（registry の宣言どおり）。 */
export function activitySyncView(row: ExamActivitySyncInput): Record<string, unknown> {
  return { payload: row.payload, schemaVersion: row.schemaVersion };
}

export type ExamDiagnosisSyncInput = Pick<ExamDiagnosisServerRow, 'payload' | 'schemaVersion'>;

export function diagnosisSyncView(row: ExamDiagnosisSyncInput): Record<string, unknown> {
  return { payload: row.payload, schemaVersion: row.schemaVersion };
}

// ── history kind（multiset）───────────────────────────────────────────

export type ExamSelfAnalysisSyncInput = Pick<
  ExamSelfAnalysisServerRow,
  'createdAt' | 'analysis' | 'summary' | 'displayedQuestions' | 'answers' | 'deepAnswers' | 'freeMemo'
>;

/**
 * `createdAt` は **timestamptz column** なので instant へ正規化する。
 *   client:    `2026-08-26T09:12:33.123Z`（toISOString）
 *   PostgREST: `2026-08-26T09:12:33.123+00:00`
 * offset を持たない値は正規化せず文字列のまま残す（UTC と仮定しない）。
 *
 * 他 3 kind と違い `createdAt` を content に含めるのは、
 * `SelfAnalysisLog.createdAt` が **必須** かつ writer が無条件に送るため
 * （types/selfAnalysisLog.ts / lib/supabase/selfAnalysisLogs.ts:116）。
 *
 * item 内部の配列（displayedQuestions / answers / deepAnswers）は jsonb が verbatim で
 * 往復し、順序自体が意味を持つ（実表示順）ため **sort しない**。
 */
export function selfAnalysisItemView(row: ExamSelfAnalysisSyncInput): Record<string, unknown> {
  return {
    createdAt: normalizeSyncTimestamp(row.createdAt),
    analysis: row.analysis,
    summary: row.summary,
    displayedQuestions: row.displayedQuestions,
    answers: row.answers,
    deepAnswers: row.deepAnswers,
    freeMemo: row.freeMemo,
  };
}

export type ExamStatementReviewSyncInput = Pick<
  ExamStatementReviewServerRow,
  'localReviewId' | 'university' | 'faculty' | 'department' | 'result'
>;

export function statementReviewItemView(
  row: ExamStatementReviewSyncInput,
): Record<string, unknown> {
  return {
    localReviewId: row.localReviewId,
    university: row.university,
    faculty: row.faculty,
    department: row.department,
    result: row.result,
  };
}

export type ExamSelfPrSyncInput = Pick<
  ExamSelfPrServerRow,
  'localPrId' | 'prIndex' | 'title' | 'body' | 'latestResult'
>;

export function selfPrItemView(row: ExamSelfPrSyncInput): Record<string, unknown> {
  return {
    localPrId: row.localPrId,
    prIndex: row.prIndex,
    title: row.title,
    body: row.body,
    latestResult: row.latestResult,
  };
}

export type ExamInterviewRecordSyncInput = Pick<
  ExamInterviewRecordServerRow,
  | 'localRecordId'
  | 'practiceDate'
  | 'universityName'
  | 'facultyName'
  | 'examType'
  | 'mainQuestion'
  | 'improvementSummary'
  | 'whatWentWrong'
  | 'feedbackReceived'
  | 'selfNoted'
  | 'feedback'
>;

/**
 * ★ `feedback` の非対称性（Wave 3 の device view が守ること）★
 *   device canonical は `StoredInterviewRecord.feedbackJson?: string`（JSON **文字列**）を持ち、
 *   writer が `JSON.parse` して jsonb で保存する
 *   （lib/supabase/interviewPracticeRecords.ts:77 parseFeedbackJson / :113）。
 *   したがって device 側の view は `JSON.parse(feedbackJson)` の結果を渡す。
 *   parse 失敗 / 欠落は writer と同じく `null` に倒す。
 */
export function interviewRecordItemView(
  row: ExamInterviewRecordSyncInput,
): Record<string, unknown> {
  return {
    localRecordId: row.localRecordId,
    practiceDate: row.practiceDate,
    universityName: row.universityName,
    facultyName: row.facultyName,
    examType: row.examType,
    mainQuestion: row.mainQuestion,
    improvementSummary: row.improvementSummary,
    whatWentWrong: row.whatWentWrong,
    feedbackReceived: row.feedbackReceived,
    selfNoted: row.selfNoted,
    feedback: row.feedback,
  };
}

// ── essay（E-S27 / Wave 2.5 で contract 確定）─────────────────────────

/**
 * review 1 件の content field。`bodyOnServer`（型目印）は入れない。
 * QA がこの宣言と実 view の key 集合の一致を検査する。
 */
export const ESSAY_REVIEW_CONTENT_FIELDS = [
  'totalScore',
  'verdict',
  'improvement',
  'goodPoints',
  'weakPoints',
  'createdAt',
  'source',
  'parseError',
] as const;

export type ExamEssayReviewSyncInput = Pick<
  ExamEssayReviewServerRow,
  'totalScore' | 'verdict' | 'improvement' | 'goodPoints' | 'weakPoints' | 'createdAt' | 'source' | 'parseError'
>;

/**
 * review 1 件。
 *
 * ★ `createdAt` はここでは正規化しない ★
 *   これは timestamptz column ではなく **jsonb の中の文字列**であり、Postgres が
 *   verbatim で往復させる（`ReviewEntry.createdAt`、types/essay.ts:48）。
 *   触ると学生側の値を書き換えることになる（normalize.ts の方針どおり）。
 */
export function essayReviewView(review: ExamEssayReviewSyncInput): Record<string, unknown> {
  return {
    totalScore: review.totalScore,
    verdict: review.verdict,
    improvement: review.improvement,
    goodPoints: review.goodPoints,
    weakPoints: review.weakPoints,
    createdAt: review.createdAt,
    source: review.source,
    parseError: review.parseError,
  };
}

export type ExamEssaySyncInput = Pick<
  ExamEssayServerRow,
  'localWorkspaceId' | 'reviews' | 'reviewCount' | 'createdAt'
>;

/**
 * workspace 1 件。
 *
 * ★ `reviews` の順序は sequence（sort しない）★
 *   `mapEssayRow` は append-only 配列を **位置で反転**して新しい順にし、
 *   `limits.recordItems` 件で cap する。時刻の再解釈をしないため、device 側も
 *   同じ配列に同じ位置操作を適用すれば同じ並びを再現できる。
 *   ＝ kind 単位の list（multiset）とは違い、ここは順序が往復する。
 *
 * `reviewCount` は cap 前の元件数。cap されると `reviews` からは復元できないため
 *   独立した content として含める（`reviewsTruncated` は reviewCount からの導出なので外す）。
 *
 * `createdAt` は timestamptz column なので instant へ正規化する
 *   （`EssayWorkspace.createdAt` は必須で、writer が無条件に送る）。
 */
export function essaySyncView(row: ExamEssaySyncInput): Record<string, unknown> {
  return {
    localWorkspaceId: row.localWorkspaceId,
    reviews: row.reviews.map(essayReviewView),
    reviewCount: row.reviewCount,
    createdAt: normalizeSyncTimestamp(row.createdAt),
  };
}

/**
 * history kind の list view。
 *
 * ★ ここでだけ sort する ★
 *   server 側の順序は `ORDER BY created_at DESC, id DESC` で決まり、tie-break の `id` は
 *   DB 生成 uuid なので device 側に存在しない。＝ 順序は query の産物であって source の内容
 *   ではない（registry.ts の証明）。item fingerprint 昇順で決定的に正規化する。
 */
export function listSyncView<T>(
  rows: readonly T[],
  itemView: (row: T) => Record<string, unknown>,
): unknown[] {
  return sortSyncItems(rows.map(itemView));
}

// ── observation ───────────────────────────────────────────────────────

/**
 * fingerprint の envelope。
 *
 * 含める理由:
 *   v / n    … view 構成や正規化規則を変えたときに、旧 claim が **誤って一致しない**ようにする
 *   kind     … 別 kind の view が偶然同じ形になっても混同しない（mixed-origin の値レベル防御）
 *   limits   … projection の打ち切り長が変われば内容表現も変わる。`EXAM_READ_FIELD_LIMITS` を
 *              envelope に入れることで、限界値の変更が **黙った不一致**ではなく
 *              全 claim の不一致（＝ veto・可視）として現れる
 */
function envelope(kind: ExamSourceKind, view: unknown): Record<string, unknown> {
  return {
    v: EXAM_SYNC_VIEW_VERSION,
    n: EXAM_SYNC_NORMALIZE_VERSION,
    kind,
    limits: EXAM_READ_FIELD_LIMITS,
    view,
  };
}

/**
 * sync view → observation（1 kind × 1 source identity）。
 *
 * revision は registry の宣言から取る。現時点で全 kind `absent` であり、
 * **無い revision を生成しない**（Wave 2 の方針）。
 */
export function examSyncObservation(input: {
  readonly kind: ExamSyncSupportedKind;
  readonly source: ExamSyncSourceIdentity;
  readonly view: unknown;
}): ExamSyncObservation {
  const contract = EXAM_SYNC_ADAPTER_CONTRACTS[input.kind];
  if (contract.revision.form !== 'absent') {
    // 宣言だけ先行して実装が無い状態を runtime で通さない。
    // revision を持つ kind が現れたら、その抽出規則をここへ実装してから宣言を変えること。
    throw new Error(
      `[examSpine/sync] revision contract declared but not implemented: kind=${input.kind}`,
    );
  }
  return {
    kind: input.kind,
    source: input.source,
    fingerprint: syncFingerprint(envelope(input.kind, input.view)),
    revision: NO_SYNC_REVISION,
  };
}
