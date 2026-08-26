// PASSAI 受験版 Exam Spine — Stage 4 Canonical Exam Context assembler。
//
//   purpose → gate → request-scoped snapshot → read（許可 source のみ）
//   → normalize → block assembly → provenance / origin → status
//   → revision → fingerprint → veto → immutable canonical context
//
// ★ この層がやらないこと ★
//   - DB write / localStorage write / AI 呼び出し / telemetry 送信（Stage 4 §3.3）
//   - production consumer への接続（Stage 5 の責務。本 module の import 元は QA だけ）
//   - Stage 2 / Stage 3 の contract 変更（いずれも凍結済み: E-S25 / E-S17）
//
// ★ purpose-first（Stage 4 §3.2 / E-S28）★
//   「読んでから purpose で捨てる」ことをしない。gate は read の**手前**にあり、
//   許可外 kind については executor へ query が 1 本も到達しない。
//
// ★ request-scoped（Stage 4 §3.1 / E-S6 / E-S21）★
//   module-level の可変 cache を持たない。source の memo は Stage 3 の
//   `WeakMap<Request>` snapshot をそのまま使い、認可は cache hit でも毎回再評価する。
//
// 関連 Decision: E-S17 / E-S26 / E-S28 / E-S1 / E-S2 / E-S3 / E-S8 / E-P7 / E-P8。

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ExamContextPurpose, ExamContextOrigin } from '../types';
import { isExamContextPurpose } from '../types';
import {
  EXAM_SOURCE_AUTHORITY,
  EXAM_SOURCE_KINDS,
  EXAM_SOURCE_TABLES,
} from '../sourceData/types';
import type { ExamSourceKind, ExamSourceReadStatus } from '../sourceData/types';
import { sourcesForPurpose } from '../purpose';
import { assembleExamContext } from '../orchestrator/assemble';
import type { ExamContextInput } from '../orchestrator/input';
import type { ExamContextBlock } from '../blocks/types';
import { EXAM_BUNDLE_SLOT } from '../read/readSources';
import type { ExamReadResult } from '../read/readSources';
import { readExamSourcesForRequest } from '../read/requestSnapshot.server';
import type { ExamRequestAuthorization } from '../read/requestSnapshot.server';
import { createSupabaseExamReadExecutor } from '../read/supabaseExecutor.server';
import type { ExamReadExecutor, ExamReadQuery } from '../read/types';
import { resolveDiagnosisTypeHint } from '@/lib/examDiagnosis/tutorHints';
import type {
  ExamActivityServerRow,
  ExamBasicInfoServerRow,
  ExamDiagnosisServerRow,
  ExamSelfAnalysisServerRow,
  ExamStatementReviewServerRow,
} from '../read/rowMappers';
import { ABSENT_REVISION } from '../sync/revision';
import type { ExamSyncStatus } from '../sync/verification';
import { verifyExamSourcePair } from '../sync/verification';
import type { ExamSyncCandidate } from '../sync/verification';
import {
  isExamSyncSupportedKind,
  type ExamSyncSupportedKind,
} from '../sync/adapters/registry';
import { serverMirrorCandidate, deviceCanonicalCandidate } from '../sync/adapters/types';
import { examSyncObservation } from '../sync/adapters/views';
import {
  activitySyncView,
  basicInfoSyncView,
  diagnosisSyncView,
  interviewRecordItemView,
  listSyncView,
  selfAnalysisItemView,
  selfPrItemView,
  statementReviewItemView,
} from '../sync/adapters/views';

import {
  EXAM_CONTEXT_VERSION,
  type CanonicalExamContext,
  type CanonicalExamContextResult,
  type ExamContextOmission,
  type ExamContextSourceState,
  type ExamContextStatus,
  type ExamOmissionReason,
  type ExamSourceContribution,
  type ExamSourceProvenance,
} from './types';
import {
  computeContextFingerprint,
  computeContextRevision,
  computeSubjectFingerprint,
} from './identity';
import { evaluateContextVeto } from './veto';
import {
  projectActivity,
  projectBasicInfo,
  projectSelfAnalysis,
  projectStatementReview,
} from './project';

// ── 入力 ──────────────────────────────────────────────────────────────

/**
 * client が申告する device canonical の状態（E-S2）。
 *
 * ★ これは **negative safety gate の入力**であって内容の権威ではない ★
 *   「申告と server 可視状態が一致しない限り使わない」ためだけに使う。
 *   user_id / 権限の根拠にしてはならない（owner scoping は E-L3 が決める）。
 *   申告が無い kind は `unclaimed` となり、Source-Sync は verified にならない。
 */
export type ExamDeviceClaim = {
  /** その kind について client が申告を提示したか。false = unclaimed。 */
  readonly presented: boolean;
  /** client 側 canonical の正規化 view の fingerprint。提示が無ければ null。 */
  readonly fingerprint: string | null;
};

export type BuildCanonicalExamContextInput = {
  /** WeakMap の key。request-scoped であることの根拠（E-S21）。 */
  readonly request: Request;
  readonly purpose: ExamContextPurpose | string;
  /**
   * server auth の結果を返す。**cache hit でも毎回評価される**（E-S7）。
   * body / query string から userId を作ってはいけない（E-L3）。
   */
  readonly authorize: () => Promise<ExamRequestAuthorization>;
  /**
   * bridge 由来の入力（現行の body 経路）。Stage 4 では **これを置き換えない**。
   * server から取れた kind だけを上書きし、取れなければ bridge を維持する（E-P7）。
   */
  readonly bridge: ExamContextInput;
  /** kind ごとの device canonical 申告（E-S2）。未指定の kind は unclaimed。 */
  readonly deviceClaims?: Readonly<Partial<Record<ExamSourceKind, ExamDeviceClaim>>>;
  /**
   * Layer 1 の I/O。省略時は user-scoped client から作る。
   * ★ 渡してよいのは anon key + cookie session の client だけ（E-L4）。
   */
  readonly executor?: ExamReadExecutor;
  readonly client?: SupabaseClient;
  /**
   * `toStudentProfile` 相当の projection が時刻を必要とする場合に使う固定値。
   * ★ assembler は clock を持たない（決定性を壊さないため）。呼び出し側が渡す。
   */
  readonly projectionNow?: string;
};

// ── entry ─────────────────────────────────────────────────────────────

export async function buildCanonicalExamContext(
  input: BuildCanonicalExamContextInput,
): Promise<CanonicalExamContextResult> {
  // ── 1. purpose の検証（default deny / E-S28）────────────────────
  if (!isExamContextPurpose(input.purpose)) {
    return {
      ok: false,
      veto: { vetoed: true, reasons: ['unknown_purpose'] },
      purpose: null,
    };
  }
  const purpose = input.purpose;

  // ── 2. 許可 source の解決（read の手前）─────────────────────────
  const allowedSources = sourcesForPurpose(purpose);

  // ── 3-4. request-scoped snapshot ＋ 許可 source のみ read ────────
  //
  // gate は readExamSourcesForRequest の内部で snapshot より手前に適用される。
  // ここで allowedSources をそのまま渡すため、許可外 kind は query を発行しない。
  const executor = resolveExecutor(input);
  if (!executor) {
    // client も executor も無い ＝ Layer 1 へ到達できない。
    // これはデータ不足ではなく実行環境の不備なので veto する。
    return { ok: false, veto: { vetoed: true, reasons: ['unauthenticated'] }, purpose };
  }

  const recorded = recordQueries(executor);

  // ★ userId は snapshot の API から取り出さない ★
  //   E-S21 は「userId を entry 内に保持し meta にも log にも出さない」と定めており、
  //   snapshot の戻り値へ userId を足すのは公開面を広げる方向になる。
  //   一方 subject fingerprint の計算には userId が要る。そこで authorize を
  //   wrap して **snapshot が呼んだその評価結果**から受け取る。
  //   snapshot 側の呼び出し回数・タイミングは変えないので E-S7（cache hit でも
  //   authorize を再評価する）はそのまま成立する。
  let authorizedUserId: string | null = null;
  const authorize = async (): Promise<ExamRequestAuthorization> => {
    const result = await input.authorize();
    if (result.ok) authorizedUserId = result.userId;
    return result;
  };

  const read = await readExamSourcesForRequest({
    request: input.request,
    authorize,
    kinds: allowedSources,
    purpose,
    executor: recorded.executor,
  });

  if (!read.ok) {
    return { ok: false, veto: { vetoed: true, reasons: [read.reason] }, purpose };
  }
  if (authorizedUserId === null) {
    // snapshot が ok を返したのに userId を観測できていない = 契約違反。
    // identity を主張できないので context を作らない。
    return { ok: false, veto: { vetoed: true, reasons: ['unauthenticated'] }, purpose };
  }

  const subjectFingerprint = computeSubjectFingerprint(authorizedUserId);

  // ── 5. source state の正規化 ＋ Source-Sync ─────────────────────
  const states = normalizeSourceStates({
    result: read.result,
    allowedSources,
    deniedSources: read.result.deniedByPurpose,
    deviceClaims: input.deviceClaims ?? {},
  });

  // ── 6. canonical blocks（Stage 2 の frozen contract を使う）──────
  const resolved = resolveContextInput({
    bridge: input.bridge,
    result: read.result,
    states,
    projectionNow: input.projectionNow,
  });
  const assembly = assembleExamContext({ purpose, input: resolved.input });
  const blocks = assembly.ordered.map((o) => o.block);

  // ── 7. provenance / origin ───────────────────────────────────────
  const sources = buildProvenance({
    states,
    origins: resolved.origins,
    bridgeFields: resolved.bridgeFields,
    blocks,
  });

  // ── 8. status ────────────────────────────────────────────────────
  const status = computeStatus(sources, allowedSources);
  const omissions = computeOmissions(sources);

  // ── 9. revision ──────────────────────────────────────────────────
  const revision = computeContextRevision(sources);

  // ── 10. fingerprint ──────────────────────────────────────────────
  const fp = computeContextFingerprint({
    purpose,
    revision,
    allowedSources,
    blocks,
    sources,
  });

  // ── 11. veto ─────────────────────────────────────────────────────
  const veto = evaluateContextVeto({
    allowedSources,
    sources,
    readTables: recorded.tables(),
    fingerprintAvailable: fp.fingerprint.length > 0,
  });

  if (veto.vetoed) return { ok: false, veto, purpose };

  // ── 12. immutable canonical context ──────────────────────────────
  const context: CanonicalExamContext = Object.freeze({
    version: EXAM_CONTEXT_VERSION,
    purpose,
    status,
    subject: Object.freeze({ authenticated: true as const, subjectFingerprint }),
    blocks: Object.freeze(blocks),
    sources: Object.freeze(sources),
    allowedSources: Object.freeze([...allowedSources]),
    deniedSources: Object.freeze([...read.result.deniedByPurpose]),
    revision,
    fingerprint: fp.fingerprint,
    veto,
    omissions: Object.freeze(omissions),
    diagnostics: Object.freeze({
      sourceQueryCount: recorded.count(),
      freshlyReadKinds: Object.freeze([...read.freshlyRead]),
      servedFromSnapshotKinds: Object.freeze([...read.servedFromSnapshot]),
      blockCount: blocks.length,
      presentBlockCount: blocks.filter((b) => b.presence === 'present').length,
      fingerprintInputBytes: fp.inputBytes,
    }),
  });

  // ★ shadow 用に解決済み入力を返す（context には入れない / E-S29）★
  return { ok: true, context, shadowResolvedInput: resolved.input };
}

// ── executor ──────────────────────────────────────────────────────────

function resolveExecutor(input: BuildCanonicalExamContextInput): ExamReadExecutor | null {
  if (input.executor) return input.executor;
  if (input.client) return createSupabaseExamReadExecutor(input.client);
  return null;
}

/**
 * 発行された query を数える wrapper。
 * ★ 観測のためだけであり、read を増やさない・順序を変えない・結果を書き換えない。
 */
function recordQueries(executor: ExamReadExecutor): {
  executor: ExamReadExecutor;
  count: () => number;
  tables: () => readonly string[];
} {
  const tables: string[] = [];
  const wrapped: ExamReadExecutor = async (query: ExamReadQuery) => {
    tables.push(query.table);
    if (query.embed) tables.push(query.embed.table);
    return executor(query);
  };
  return { executor: wrapped, count: () => tables.length, tables: () => tables };
}

// ── source state ──────────────────────────────────────────────────────

type SourceStateEntry = {
  readonly kind: ExamSourceKind;
  readonly state: ExamContextSourceState;
  readonly readStatus: ExamSourceReadStatus;
  readonly syncStatus: ExamSyncStatus | null;
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly fingerprint: string | null;
};

/**
 * Stage 3 の read 結果 → context source state。
 *
 * ★ 4 つを潰さない（Canon §40）★
 *   0 行 → 'empty' / purpose 不許可 → 'denied_by_purpose' /
 *   read 失敗 → 'unreadable' / Spine 未対応 → 'unsupported'
 *
 * ★ class 1 だけ Source-Sync を適用する（E-S2 / E-S3）★
 *   class 2（interview_ai / presentation）は server route が著者であり
 *   「client canonical」が存在しないため、verification を適用しない。
 *   適用すると「client の cache が古い＝server の正しいデータを使えない」逆向きの誤りになる。
 */
function normalizeSourceStates(args: {
  result: ExamReadResult;
  allowedSources: readonly ExamSourceKind[];
  deniedSources: readonly ExamSourceKind[];
  deviceClaims: Readonly<Partial<Record<ExamSourceKind, ExamDeviceClaim>>>;
}): readonly SourceStateEntry[] {
  const allowed = new Set(args.allowedSources);
  const denied = new Set(args.deniedSources);

  return EXAM_SOURCE_KINDS.map((kind): SourceStateEntry => {
    const readStatus = args.result.statuses[kind];
    const value = args.result.bundle[EXAM_BUNDLE_SLOT[kind]];
    const rowCount = countRows(value);

    if (denied.has(kind)) {
      return { kind, state: 'denied_by_purpose', readStatus, syncStatus: null, rowCount: 0, truncated: false, fingerprint: null };
    }
    if (!allowed.has(kind)) {
      // 要求もされず許可もされていない。read を試行していない。
      return { kind, state: 'denied_by_purpose', readStatus, syncStatus: null, rowCount: 0, truncated: false, fingerprint: null };
    }
    if (readStatus === 'error' || readStatus === 'skipped') {
      return { kind, state: 'unreadable', readStatus, syncStatus: null, rowCount: 0, truncated: false, fingerprint: null };
    }
    // truncated は「cap まで読めただけで全件ではない」。freshness の権威にしない（E-S8）。
    if (readStatus === 'truncated') {
      return { kind, state: 'unreadable', readStatus, syncStatus: null, rowCount, truncated: true, fingerprint: null };
    }

    // ここから readStatus === 'ok'
    if (!isExamSyncSupportedKind(kind)) {
      // class 2（E-S3）と adapter 未実装 kind。Source-Sync を適用しない。
      // 「読めて 0 件」は empty、内容があれば available。
      return {
        kind,
        state: rowCount === 0 ? 'empty' : 'available',
        readStatus,
        syncStatus: null,
        rowCount,
        truncated: false,
        fingerprint: null,
      };
    }

    // ★ 「読めて 0 件」は Source-Sync より手前で確定させる ★
    //   verify に回すと device 申告が無い間ずっと 'unverified' になり、
    //   新規ユーザー（データが無いだけ）と「検証できない」が区別できなくなる（Canon §40）。
    //   0 件なら注入され得る内容が存在しないので、verified を待つ意味も無い。
    if (rowCount === 0) {
      return { kind, state: 'empty', readStatus, syncStatus: null, rowCount: 0, truncated: false, fingerprint: null };
    }

    const observation = buildObservation(kind, value);
    const mirror: ExamSyncCandidate = serverMirrorCandidate({ status: readStatus, observation });
    const claim = args.deviceClaims[kind];
    const canonical: ExamSyncCandidate = deviceCanonicalCandidate({
      claimPresented: claim?.presented ?? false,
      observation:
        claim?.presented && claim.fingerprint
          ? { kind, source: 'device_canonical', fingerprint: claim.fingerprint, revision: ABSENT_REVISION }
          : null,
    });
    const verification = verifyExamSourcePair({ canonical, mirror });

    // verified 以外は使わない（E-S2 の負の安全ゲート）。
    // ただし「読めて 0 件」は verified/both_empty になるので empty として扱う。
    // ここへ来るのは rowCount > 0 の場合だけ（0 件は上で empty 確定）。
    const state: ExamContextSourceState =
      verification.status === 'verified' ? 'available' : 'unverified';

    return {
      kind,
      state,
      readStatus,
      syncStatus: verification.status,
      rowCount,
      truncated: false,
      fingerprint: observation?.fingerprint ?? null,
    };
  });
}

function countRows(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (Array.isArray(value)) return value.length;
  const rec = value as { state?: unknown };
  if (rec.state === 'present') return 1;
  if (rec.state === 'absent') return 0;
  return 1;
}

/** bundle slot → sync adapter の正規化 view → observation（fingerprint）。 */
function buildObservation(
  kind: ExamSyncSupportedKind,
  value: unknown,
): { kind: ExamSyncSupportedKind; source: 'server_mirror'; fingerprint: string; revision: typeof ABSENT_REVISION } | null {
  const view = buildSyncView(kind, value);
  if (view === null) return null;
  return examSyncObservation({ kind, source: 'server_mirror', view }) as never;
}

function buildSyncView(kind: ExamSyncSupportedKind, value: unknown): unknown {
  const snapshotRow = <T,>(): T | null => {
    const rec = value as { state?: string; row?: T } | null;
    return rec && rec.state === 'present' && rec.row ? rec.row : null;
  };
  switch (kind) {
    case 'basic_info': {
      const row = snapshotRow<ExamBasicInfoServerRow>();
      return row ? basicInfoSyncView(row) : null;
    }
    case 'activity': {
      const row = snapshotRow<ExamActivityServerRow>();
      return row ? activitySyncView(row) : null;
    }
    case 'diagnosis': {
      const row = snapshotRow<{ payload: Record<string, unknown> | null; schemaVersion: string | null }>();
      return row ? diagnosisSyncView(row) : null;
    }
    case 'self_analysis': {
      const rows = value as readonly ExamSelfAnalysisServerRow[] | null;
      return rows && rows.length > 0 ? listSyncView(rows, selfAnalysisItemView) : null;
    }
    case 'statement_review': {
      const rows = value as readonly ExamStatementReviewServerRow[] | null;
      return rows && rows.length > 0 ? listSyncView(rows, statementReviewItemView) : null;
    }
    case 'self_pr': {
      const rows = value as readonly Parameters<typeof selfPrItemView>[0][] | null;
      return rows && rows.length > 0 ? listSyncView(rows, selfPrItemView) : null;
    }
    case 'interview_record': {
      const rows = value as readonly Parameters<typeof interviewRecordItemView>[0][] | null;
      return rows && rows.length > 0 ? listSyncView(rows, interviewRecordItemView) : null;
    }
  }
}

// ── ExamContextInput の解決（server ↔ bridge）─────────────────────────

type ResolvedInput = {
  readonly input: ExamContextInput;
  readonly origins: Readonly<Partial<Record<ExamSourceKind, ExamContextOrigin>>>;
  readonly bridgeFields: Readonly<Partial<Record<ExamSourceKind, readonly string[]>>>;
};

/**
 * server から取れた kind だけを bridge の上に載せる。
 *
 * ★ E-P7（移行時に context を減らさない）★
 *   server 側が空 / 取れない場合は **bridge を維持する**。
 *   「server 経路が有効なら常に server を採用する」は品質劣化なので採らない。
 *
 * ★ origin は「実際にどちらの値を block に載せたか」を書く ★
 *   server 経路が存在することではなく、今回どちらを使ったかが origin である。
 */
function resolveContextInput(args: {
  bridge: ExamContextInput;
  result: ExamReadResult;
  states: readonly SourceStateEntry[];
  projectionNow?: string;
}): ResolvedInput {
  const stateOf = new Map(args.states.map((s) => [s.kind, s]));
  const origins: Partial<Record<ExamSourceKind, ExamContextOrigin>> = {};
  const bridgeFields: Partial<Record<ExamSourceKind, readonly string[]>> = {};
  const next: ExamContextInput = { ...args.bridge };

  const usable = (kind: ExamSourceKind): boolean => stateOf.get(kind)?.state === 'available';
  const slot = <T,>(kind: ExamSourceKind): T => args.result.bundle[EXAM_BUNDLE_SLOT[kind]] as T;
  const snapshotRow = <T,>(kind: ExamSourceKind): T | null => {
    const rec = slot<{ state?: string; row?: T } | null>(kind);
    return rec && rec.state === 'present' && rec.row ? rec.row : null;
  };

  // basic_info（E-P8: name は server に無い）
  if (usable('basic_info')) {
    const p = projectBasicInfo(snapshotRow<ExamBasicInfoServerRow>('basic_info'), args.bridge.basicInfo ?? null);
    if (p.value) {
      next.basicInfo = p.value;
      origins.basic_info = 'server';
      bridgeFields.basic_info = p.bridgeFields;
    }
  }

  // activity
  if (usable('activity')) {
    const p = projectActivity(snapshotRow<ExamActivityServerRow>('activity'));
    if (p.value) {
      next.activityData = p.value;
      origins.activity = 'server';
    }
  }

  // diagnosis → typeHint（Stage 5.2 / G1）
  //
  // ★ payload を block へ流さない ★
  //   server row から取り出すのは `resultType` の言い換え 1 文だけで、
  //   resultTitle / resultDescription / answers / createdAt は projection に現れない。
  //   言い換え表は legacy と共有する（lib/examDiagnosis/tutorHints.ts が正本）。
  if (usable('diagnosis')) {
    const row = snapshotRow<ExamDiagnosisServerRow>('diagnosis');
    const hint = resolveDiagnosisTypeHint(row?.payload?.resultType);
    if (hint) {
      next.diagnosisTypeHint = hint;
      origins.diagnosis = 'server';
    }
  }

  // self_analysis → wallHittingResult（Stage 2 が studentProfile を派生させる）
  if (usable('self_analysis')) {
    const p = projectSelfAnalysis(slot<readonly ExamSelfAnalysisServerRow[] | null>('self_analysis'));
    if (p.value) {
      next.wallHittingResult = p.value;
      // studentProfile（bridge の canonical artifact）が無いときだけ server 由来が効く。
      if (!args.bridge.studentProfile) origins.self_analysis = 'server';
      if (args.projectionNow) next.projectionNow = args.projectionNow;
    }
  }

  // statement_review → previousOutputSummary
  if (usable('statement_review')) {
    const p = projectStatementReview(slot<readonly ExamStatementReviewServerRow[] | null>('statement_review'));
    if (p.value) {
      next.previousOutputSummary = p.value;
      origins.statement_review = 'server';
    }
  }

  // 申告の無い kind は補完しない（E-S26。暗黙的 Mixed-Origin を作らない）。
  next.origins = origins;
  // durable source を持たない slot は構造的 bridge のまま（E-P3 / E-S9）。
  next.notServerCapableSlots = args.bridge.notServerCapableSlots ?? ['statementDraft'];

  return { input: next, origins, bridgeFields };
}

// ── provenance ────────────────────────────────────────────────────────

/**
 * ★ block id → source kind の固定 map を作らない ★
 *   同じ block id でも purpose によって由来 kind が違う実例がある
 *   （`previous_output_summary` は statement_review purpose では statement_review 由来、
 *     interview_feedback purpose では interview_record 由来）。
 *   したがって block の宣言 `sourceKind` を **そのまま**使い、Spine 側で推測しない。
 */
function buildProvenance(args: {
  states: readonly SourceStateEntry[];
  origins: Readonly<Partial<Record<ExamSourceKind, ExamContextOrigin>>>;
  bridgeFields: Readonly<Partial<Record<ExamSourceKind, readonly string[]>>>;
  blocks: readonly ExamContextBlock[];
}): readonly ExamSourceProvenance[] {
  return args.states.map((s): ExamSourceProvenance => {
    // ★ 「plan に block が宣言されている」と「その source の値が context に載った」は別 ★
    //   presence !== 'present' の block は中身が無く、何も寄与していない。
    //   ここを取り違えると、purpose が読まない kind の空 block を見て
    //   「禁止 source が寄与した」と誤判定する（essay_review の
    //   previous_output_summary が実例）。
    const blocks = args.blocks
      .filter((b) => b.sourceKind === s.kind && b.presence === 'present')
      .map((b) => b.id);
    const contribution: ExamSourceContribution =
      blocks.length > 0 ? 'block' : s.state === 'available' ? 'metadata_only' : 'none';
    return Object.freeze({
      kind: s.kind,
      authority: EXAM_SOURCE_AUTHORITY[s.kind],
      tables: EXAM_SOURCE_TABLES[s.kind],
      state: s.state,
      readStatus: s.readStatus,
      syncStatus: s.syncStatus,
      origin: args.origins[s.kind] ?? 'bridge',
      bridgeFields: args.bridgeFields[s.kind] ?? [],
      blocks: Object.freeze(blocks),
      contribution,
      rowCount: s.rowCount,
      truncated: s.truncated,
      fingerprint: s.fingerprint,
      revision: ABSENT_REVISION,
    });
  });
}

// ── status / omissions ────────────────────────────────────────────────

function computeStatus(
  sources: readonly ExamSourceProvenance[],
  allowed: readonly ExamSourceKind[],
): ExamContextStatus {
  const allowedSet = new Set(allowed);
  const relevant = sources.filter((s) => allowedSet.has(s.kind));
  if (relevant.length === 0) return 'degraded';

  const available = relevant.filter((s) => s.state === 'available');
  const broken = relevant.filter(
    (s) => s.state === 'unreadable' || s.state === 'unverified' || s.state === 'unsupported',
  );

  if (available.length === 0) return 'degraded';
  if (broken.length > 0) return 'partial';
  return 'ok';
}

/**
 * fail-open で落ちたものを機械的に説明する（Stage 4 §5.7）。
 * ★ kind と reason code だけ。raw user content を 1 文字も含めない。
 */
function computeOmissions(sources: readonly ExamSourceProvenance[]): readonly ExamContextOmission[] {
  const out: ExamContextOmission[] = [];
  for (const s of sources) {
    const reason = omissionReason(s);
    if (reason) out.push(Object.freeze({ kind: s.kind, reason, state: s.state }));
  }
  return out;
}

function omissionReason(s: ExamSourceProvenance): ExamOmissionReason | null {
  switch (s.state) {
    case 'denied_by_purpose':
      return s.readStatus === 'skipped' ? 'denied_by_purpose' : 'not_requested';
    case 'unreadable':
      return s.truncated ? 'read_truncated' : 'read_error';
    case 'unverified':
      return 'sync_unverified';
    case 'empty':
      return 'source_empty';
    case 'unsupported':
      return 'no_block_defined';
    case 'available':
      // 読めているのに block が無い kind は「block 未定義」として明示する。
      return s.blocks.length === 0 ? 'no_block_defined' : null;
  }
}
