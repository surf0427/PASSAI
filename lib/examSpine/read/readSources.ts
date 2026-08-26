// PASSAI 受験版 Exam Spine — Stage 3 canonical reader。
//
//   durable server source → canonical reader → ExamSourceBundle + 10 kind の status
//
// ★ この層は Supabase を知らない ★
//   I/O は `ExamReadExecutor` 1 本だけを通す。実際に PostgREST を叩くのは
//   supabaseExecutor.server.ts であり、QA は fake executor を渡す（実ネットワーク 0 / 実 DB 0）。
//
// ★ 出力は未 verify な server candidate である（E-S17）★
//   `device_canonical_mirrored` の 8 kind について「server row が在る == canonical」と
//   解釈してはいけない。Stage 3 の結果だけを理由に bridge / client source を排除しない。
//   Source-Sync / revision / verified / mismatch / veto は Stage 4 の責務。
//
// fail-open（E-S1 / E-S8）:
//   1 source の失敗で全体を throw しない。失敗した kind だけ slot=null / status='error' にし、
//   他の source は継続する。fail-open は「**context を減らす**」ことであって、
//   stale cache / 前 request / 古い成功値 / fallback table への置換ではない。

import type { ExamSourceKind, ExamSourceReadStatus } from '../sourceData/types';
import { EMPTY_EXAM_SOURCE_BUNDLE, EXAM_SOURCE_KINDS } from '../sourceData/types';
import type { ExamSourceBundle } from '../sourceData/types';
import type {
  ExamReadExecutor,
  ExamReadLogEntry,
  ExamReadQuery,
  ExamSourceReadOutcome,
} from './types';
import { EXAM_READ_CAPS, isExamCappedSourceKind } from './types';
import type { ExamReadFieldLimits, ExamPresentationServerRow } from './rowMappers';
import {
  mapActivityRow,
  mapBasicInfoRow,
  mapDiagnosisRow,
  mapEssayRow,
  mapInterviewAiRow,
  mapInterviewRecordRow,
  mapPresentationAttemptRow,
  mapPresentationResultRow,
  mapPresentationSessionRow,
  mapSelfAnalysisRow,
  mapSelfPrRow,
  mapStatementReviewRow,
} from './rowMappers';
import * as Q from './queries';

/**
 * read layer が使う長さ上限の正本（E-S19）。
 *
 * ★ mapper 側に既定値を置かず、ここから明示的に渡す。
 *   これは「server から 1 request でどれだけ読むか」という **read 側の上限**であって、
 *   prompt の budget enforcement ではない（Stage 2 の budget は依然 enforce しない）。
 */
export const EXAM_READ_FIELD_LIMITS: ExamReadFieldLimits = {
  shortText: 200,
  longText: 4000,
  arrayItems: 20,
  arrayItemLength: 400,
  recordItems: 10,
};

export type ExamReadRequest = {
  /**
   * ★ server auth の結果から渡す。
   *   body / query string / 任意 JSON から読んではいけない（E-L3 / E-L4）。
   *   この関数は userId の出所を検証できないので、呼び出し側の契約として固定する。
   */
  userId: string;
  /** この request で必要な kind。指定されなかった kind は status='skipped'。 */
  kinds: readonly ExamSourceKind[];
  executor: ExamReadExecutor;
  /**
   * duration 計測用の時計。**注入されたときだけ**計測する。
   * read layer 自身は Date / Date.now / Math.random を持たない（決定論を壊さないため）。
   */
  clock?: () => number;
};

export type ExamReadResult = {
  bundle: ExamSourceBundle;
  /** 10 kind すべてを毎回返す。 */
  statuses: Readonly<Record<ExamSourceKind, ExamSourceReadStatus>>;
  outcomes: Readonly<Record<ExamSourceKind, ExamSourceReadOutcome>>;
  /** PII-free。型で閉じてあるので free text を載せられない（E-S12 / E-S13）。 */
  log: readonly ExamReadLogEntry[];
};

/** 1 kind の読み取り結果（内部表現）。 */
type KindResult = {
  /** bundle slot に入れる値。`null` は「未取得（skipped / error）」だけを意味する。 */
  value: unknown;
  outcome: ExamSourceReadOutcome;
  rowCount: number;
};

const SKIPPED_OUTCOME: ExamSourceReadOutcome = {
  status: 'skipped',
  queryCount: 0,
  truncated: false,
  enrichmentFailed: false,
};

/**
 * kind → ExamSourceBundle の slot 名。Stage 1 の bundle contract をそのまま使う。
 * requestSnapshot が per-kind の値を bundle へ再構成するために export する。
 */
export const EXAM_BUNDLE_SLOT: Readonly<Record<ExamSourceKind, keyof ExamSourceBundle>> = {
  basic_info: 'basicInfo',
  activity: 'activity',
  diagnosis: 'diagnosis',
  self_analysis: 'selfAnalysisLogs',
  statement_review: 'statementReviews',
  self_pr: 'selfPrs',
  essay: 'essayWorkspaces',
  interview_record: 'interviewRecords',
  interview_ai: 'interviewAi',
  presentation: 'presentation',
};

// ── entry ─────────────────────────────────────────────────────────────

export async function readExamSources(request: ExamReadRequest): Promise<ExamReadResult> {
  const requested = new Set(request.kinds);
  const bundle: Record<string, unknown> = { ...EMPTY_EXAM_SOURCE_BUNDLE };
  const statuses: Record<string, ExamSourceReadStatus> = {};
  const outcomes: Record<string, ExamSourceReadOutcome> = {};
  const log: ExamReadLogEntry[] = [];

  // 非 requested kind も必ず status を持つ（10 kind 全部を毎回返す契約）。
  for (const kind of EXAM_SOURCE_KINDS) {
    statuses[kind] = 'skipped';
    outcomes[kind] = SKIPPED_OUTCOME;
  }

  const targets = EXAM_SOURCE_KINDS.filter((k) => requested.has(k));

  // ★ allSettled による source isolation。1 source の失敗が他を巻き込まない。
  const settled = await Promise.allSettled(
    targets.map(async (kind) => {
      const started = request.clock?.();
      const result = await readKind(kind, request);
      const durationMs =
        started === undefined ? undefined : (request.clock?.() ?? started) - started;
      return { result, durationMs };
    }),
  );

  for (let i = 0; i < settled.length; i++) {
    const kind = targets[i];
    const entry = settled[i];

    if (entry.status === 'rejected') {
      // reader は throw しない設計だが、想定外の throw でも「その kind だけ error」に閉じる。
      const outcome: ExamSourceReadOutcome = {
        status: 'error',
        queryCount: 0,
        truncated: false,
        enrichmentFailed: false,
      };
      statuses[kind] = 'error';
      outcomes[kind] = outcome;
      bundle[EXAM_BUNDLE_SLOT[kind]] = null;
      log.push({ kind, status: 'error', queryCount: 0, rowCount: 0, truncated: false, enrichmentFailed: false });
      continue;
    }

    const { result, durationMs } = entry.value;
    statuses[kind] = result.outcome.status;
    outcomes[kind] = result.outcome;
    bundle[EXAM_BUNDLE_SLOT[kind]] = result.value;
    log.push({
      kind,
      status: result.outcome.status,
      queryCount: result.outcome.queryCount,
      rowCount: result.rowCount,
      truncated: result.outcome.truncated,
      enrichmentFailed: result.outcome.enrichmentFailed,
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  }

  return {
    bundle: bundle as ExamSourceBundle,
    statuses: statuses as Record<ExamSourceKind, ExamSourceReadStatus>,
    outcomes: outcomes as Record<ExamSourceKind, ExamSourceReadOutcome>,
    log,
  };
}

// ── kind dispatch ─────────────────────────────────────────────────────

async function readKind(kind: ExamSourceKind, req: ExamReadRequest): Promise<KindResult> {
  const L = EXAM_READ_FIELD_LIMITS;
  switch (kind) {
    case 'basic_info':
      return readSnapshot(req, Q.basicInfoQuery(req.userId), (row) => mapBasicInfoRow(row, L));
    case 'activity':
      return readSnapshot(req, Q.activityQuery(req.userId), (row) => mapActivityRow(row));
    case 'diagnosis':
      return readSnapshot(req, Q.diagnosisQuery(req.userId), (row) => mapDiagnosisRow(row));
    case 'self_analysis':
      return readList(req, Q.selfAnalysisQuery(req.userId), (row) => mapSelfAnalysisRow(row, L));
    case 'statement_review':
      return readList(req, Q.statementReviewQuery(req.userId), (row) =>
        mapStatementReviewRow(row, L),
      );
    case 'self_pr':
      return readList(req, Q.selfPrQuery(req.userId), (row) => mapSelfPrRow(row, L));
    case 'essay':
      return readList(req, Q.essayQuery(req.userId), (row) => mapEssayRow(row));
    case 'interview_record':
      return readList(req, Q.interviewRecordQuery(req.userId), (row) =>
        mapInterviewRecordRow(row, L),
      );
    case 'interview_ai':
      return readInterviewAi(req);
    case 'presentation':
      return readPresentation(req);
  }
}

// ── snapshot（user_id UNIQUE / maybeSingle）─────────────────────────────
//
// 「読めたが行が無い」を `null` にすると status='ok' と組んで **null + ok** になる。
// それを避けるため present / absent を明示する（`null` は未取得だけを意味する）。

async function readSnapshot(
  req: ExamReadRequest,
  query: ExamReadQuery,
  map: (row: unknown) => unknown,
): Promise<KindResult> {
  const res = await req.executor(query);
  if (res.error || res.rows === null) {
    return { value: null, outcome: failure(1), rowCount: 0 };
  }
  const mapped = res.rows.length > 0 ? map(res.rows[0]) : null;
  return {
    value: mapped === null ? { state: 'absent' } : { state: 'present', row: mapped },
    outcome: { status: 'ok', queryCount: 1, truncated: false, enrichmentFailed: false },
    rowCount: mapped === null ? 0 : 1,
  };
}

// ── history / array（cap + 1 で truncated を判定）───────────────────────

async function readList(
  req: ExamReadRequest,
  query: ExamReadQuery,
  map: (row: unknown) => unknown,
): Promise<KindResult> {
  const res = await req.executor(query);
  if (res.error || res.rows === null) {
    return { value: null, outcome: failure(1), rowCount: 0 };
  }
  const { rows, truncated } = applyCap(res.rows, capOf(query.kind));
  const mapped = rows.map(map).filter((v) => v !== null);
  return {
    value: mapped,
    outcome: {
      status: truncated ? 'truncated' : 'ok',
      queryCount: 1,
      truncated,
      enrichmentFailed: false,
    },
    rowCount: mapped.length,
  };
}

// ── interview_ai（E-S18）───────────────────────────────────────────────
//
// driver は **result が実在する最新 record**。旧経路（最新 completed session → その result を
// 期待する）は、completed session が多く result が少ない production 形状で空振りする。
//
// ownership は embed した親 session 側で確認する。session を解決できない row は
// 「所有を確認できていない」ものとして採用しない（fail-open = context を減らす）。

async function readInterviewAi(req: ExamReadRequest): Promise<KindResult> {
  const res = await req.executor(Q.interviewAiQuery(req.userId));
  if (res.error || res.rows === null) {
    return { value: null, outcome: failure(1), rowCount: 0 };
  }
  const { rows, truncated } = applyCap(res.rows, EXAM_READ_CAPS.interview_ai);
  const mapped = rows
    .map((row) => mapInterviewAiRow(row, EXAM_READ_FIELD_LIMITS))
    .filter((v) => v !== null)
    .filter((v) => v.session !== null);
  return {
    value: mapped,
    outcome: {
      status: truncated ? 'truncated' : 'ok',
      queryCount: 1,
      truncated,
      enrichmentFailed: false,
    },
    rowCount: mapped.length,
  };
}

// ── presentation ──────────────────────────────────────────────────────
//
// core = presentation_results。core が取れたときだけ attempts → sessions を enrichment として読む。
// core が空なら enrichment query は **0 本**。enrichment の失敗で core を失敗扱いにしない。

async function readPresentation(req: ExamReadRequest): Promise<KindResult> {
  const coreRes = await req.executor(Q.presentationCoreQuery(req.userId));
  if (coreRes.error || coreRes.rows === null) {
    return { value: null, outcome: failure(1), rowCount: 0 };
  }

  const { rows, truncated } = applyCap(coreRes.rows, EXAM_READ_CAPS.presentation);
  const results = rows.map(mapPresentationResultRow).filter((v) => v !== null);
  const baseStatus: ExamSourceReadStatus = truncated ? 'truncated' : 'ok';

  // core が空 → enrichment を一切発行しない。
  if (results.length === 0) {
    return {
      value: [],
      outcome: { status: baseStatus, queryCount: 1, truncated, enrichmentFailed: false },
      rowCount: 0,
    };
  }

  let queryCount = 1;
  let enrichmentFailed = false;

  const attemptIds = dedupe(results.map((r) => r.attemptId));
  const attemptsById = new Map<string, NonNullable<ReturnType<typeof mapPresentationAttemptRow>>>();
  if (attemptIds.length > 0) {
    queryCount += 1;
    const res = await req.executor(Q.presentationAttemptsQuery(req.userId, attemptIds));
    if (res.error || res.rows === null) {
      enrichmentFailed = true;
    } else {
      for (const row of res.rows) {
        const attempt = mapPresentationAttemptRow(row, EXAM_READ_FIELD_LIMITS);
        if (attempt?.id) attemptsById.set(attempt.id, attempt);
      }
    }
  }

  const sessionIds = dedupe([...attemptsById.values()].map((a) => a.sessionId));
  const sessionsById = new Map<string, NonNullable<ReturnType<typeof mapPresentationSessionRow>>>();
  if (sessionIds.length > 0) {
    queryCount += 1;
    const res = await req.executor(Q.presentationSessionsQuery(req.userId, sessionIds));
    if (res.error || res.rows === null) {
      enrichmentFailed = true;
    } else {
      for (const row of res.rows) {
        const session = mapPresentationSessionRow(row, EXAM_READ_FIELD_LIMITS);
        if (session?.id) sessionsById.set(session.id, session);
      }
    }
  }

  const value: ExamPresentationServerRow[] = results.map((result) => {
    const attempt = result.attemptId ? attemptsById.get(result.attemptId) ?? null : null;
    const session = attempt?.sessionId ? sessionsById.get(attempt.sessionId) ?? null : null;
    return { result, attempt, session };
  });

  return {
    value,
    // ★ enrichment が失敗しても core は成功。status は core の結果のまま。
    outcome: { status: baseStatus, queryCount, truncated, enrichmentFailed },
    rowCount: value.length,
  };
}

// ── helper ────────────────────────────────────────────────────────────

function failure(queryCount: number): ExamSourceReadOutcome {
  return { status: 'error', queryCount, truncated: false, enrichmentFailed: false };
}

function capOf(kind: ExamSourceKind): number {
  return isExamCappedSourceKind(kind) ? EXAM_READ_CAPS[kind] : 0;
}

/** cap + 1 件取得している前提で、cap 超過分を drop しつつ truncated を判定する。 */
function applyCap(
  rows: readonly unknown[],
  cap: number,
): { rows: readonly unknown[]; truncated: boolean } {
  if (rows.length > cap) return { rows: rows.slice(0, cap), truncated: true };
  return { rows, truncated: false };
}

/** null を落として重複を除く（順序は入力順＝ordering 済みの順を保つ）。 */
function dedupe(values: readonly (string | null)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
