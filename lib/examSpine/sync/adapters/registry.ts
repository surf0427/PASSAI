// PASSAI 受験版 Exam Spine — Stage 4 Wave 2 / Source Adapter Matrix（宣言・データのみ）。
//
// 10 kind すべてについて「何を同じ内容とみなすか」を **実コード evidence 付き**で固定する。
// 実装（serverViews.ts）はこの宣言に従い、QA が宣言と実挙動の一致を検査する。
//
// ★ Authority はここで決めない ★
//   class 1 / class 2 の別は E-L2 が、Source-Sync の適用範囲は E-S2 / E-S3 が既に決めている。
//   本 file はその決定を **読んで反映する**だけで、上書きも拡張もしない。
//
// ★ 除外は「勝手に落とす」ことではない ★
//   Canon §16 の要件は「UI 描画順など本質的でない違いで fingerprint が変化しない」こと。
//   ここで field を外してよいのは、その field が **mirror を往復しない**ことをコードで
//   示せる場合だけである。往復しない field を入れると永久不一致になり、Source-Sync が
//   常に veto へ倒れて機能そのものが無効化される（＝安全だが無意味になる）。
//   逆に、往復する content field を勝手に外すと stale を verified と誤認しうるので外さない。

import type { ExamSourceKind } from '../../sourceData/types';
import type { ExamSyncAdapterContract } from './types';

/**
 * sync view の schema 版。
 * view の field 構成 / 正規化 / 除外規則を変えたら上げる（旧 claim は不一致 → veto）。
 */
export const EXAM_SYNC_VIEW_VERSION = 'sv1';

/**
 * ★ 往復しない field の共通根拠 ★
 *   supabase/schema.sql §3 の `set_updated_at()` は `BEFORE UPDATE` trigger で
 *   `NEW.updated_at = now()` を無条件に代入する。class 1 の 8 table すべてに付いており
 *   （§33 / §36 / §39 / §42 / §45 / §48 / §51 / §54）、upsert の ON CONFLICT DO UPDATE 経路で
 *   client が送った `updated_at` は必ず捨てられる。したがって `updated_at` は
 *   **どの kind でも content にも revision にも使えない**。
 */
const UPDATED_AT_EVIDENCE =
  'supabase/schema.sql:47 set_updated_at() + BEFORE UPDATE trigger（§33/§36/§39/§42/§45/§48/§51/§54）';

/**
 * ★ DB 生成 id の共通根拠 ★
 *   class 1 の各 table は `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` を持ち、
 *   device 側の localStorage には存在しない。reader の projection の `id` はこの DB uuid で
 *   あり（rowMappers.ts の `asString(rec.id)`）、`local_*_id` とは別物である。
 */
const DB_UUID_EVIDENCE =
  'supabase/schema.sql: id uuid PRIMARY KEY DEFAULT gen_random_uuid() / lib/examSpine/read/rowMappers.ts asString(rec.id)';

export const EXAM_SYNC_ADAPTER_CONTRACTS: Readonly<
  Record<ExamSourceKind, ExamSyncAdapterContract>
> = {
  // ── class 1 / snapshot（user_id UNIQUE・1 行）──────────────────────

  basic_info: {
    kind: 'basic_info',
    authority: 'device_canonical_mirrored',
    capability: 'possible',
    canonicalSource: 'localStorage（lib/basicInfoStorage.ts）',
    physicalSource: 'basic_info_logs（jsonb payload / 1 行 per user）',
    readPath: 'lib/examSpine/read/queries.ts basicInfoQuery → rowMappers.mapBasicInfoRow',
    contentFields: [
      'grade',
      'track',
      'overallGpa',
      'examTypes',
      'preferences',
      'subjectGrades',
      'schemaVersion',
    ],
    excludedFields: [
      {
        field: 'name',
        reason: 'not_selected_by_reader',
        evidence:
          'lib/supabase/basicInfoLogs.ts stripName() が書き込み前に name を削除する（E-P8）。server には存在しないので device 側も view から外す',
      },
      {
        field: 'nameOnServer',
        reason: 'type_marker_not_content',
        evidence: 'rowMappers.ts ExamBasicInfoServerRow.nameOnServer は false リテラルの型目印',
      },
      {
        field: 'sourceHash',
        reason: 'not_selected_by_reader',
        evidence:
          'basicInfoQuery は source_hash を SELECT するが mapBasicInfoRow は projection に含めない。値は sha256(JSON.stringify(payload)+SCHEMA_VERSION) で **key 挿入順に依存**し、jsonb は key 順を保持しないため server 側で再算出できない（lib/supabase/mirrorSourceHash.ts「does not stringify, sort keys, or rewrite anything」）',
      },
      {
        field: 'createdAt / updatedAt',
        reason: 'trigger_overwritten',
        evidence: UPDATED_AT_EVIDENCE,
      },
    ],
    order: 'single',
    revision: {
      form: 'absent',
      reason:
        'updated_at は trigger 上書き、created_at は upsert 経路で保持されるだけの行 metadata、source_hash は key 順依存で server 再算出不能。往復する revision token が存在しないため生成しない（E-S2 は content 由来 token を signal とする）',
    },
    blocker: null,
  },

  activity: {
    kind: 'activity',
    authority: 'device_canonical_mirrored',
    capability: 'possible',
    canonicalSource: 'localStorage（活動整理 ActivityData）',
    physicalSource: 'activity_logs（jsonb payload / 1 行 per user）',
    readPath: 'queries.ts activityQuery → rowMappers.mapActivityRow',
    contentFields: ['payload', 'schemaVersion'],
    excludedFields: [
      {
        field: 'categoryCounts',
        reason: 'derived_from_included_field',
        evidence:
          'rowMappers.mapActivityRow が payload の配列 value の length から純粋に導出する。payload 自体を含めているので独立した情報を持たない',
      },
      { field: 'createdAt / updatedAt', reason: 'trigger_overwritten', evidence: UPDATED_AT_EVIDENCE },
    ],
    order: 'single',
    revision: {
      form: 'absent',
      reason: 'basic_info と同一（trigger 上書き / source_hash が key 順依存）',
    },
    blocker: null,
  },

  diagnosis: {
    kind: 'diagnosis',
    authority: 'device_canonical_mirrored',
    capability: 'possible',
    canonicalSource: 'localStorage（DiagnosisResult）',
    physicalSource: 'diagnosis_logs（jsonb payload / 1 行 per user）',
    readPath: 'queries.ts diagnosisQuery → rowMappers.mapDiagnosisRow',
    contentFields: ['payload', 'schemaVersion'],
    excludedFields: [
      { field: 'createdAt / updatedAt', reason: 'trigger_overwritten', evidence: UPDATED_AT_EVIDENCE },
    ],
    order: 'single',
    revision: {
      form: 'absent',
      reason: 'basic_info と同一。なお writer の SCHEMA_VERSION は "3"（lib/supabase/diagnosisLogs.ts:36）で column DEFAULT の "1" とは異なるため、schemaVersion は content として比較する',
    },
    blocker: null,
  },

  // ── class 1 / history（cap 付き list）──────────────────────────────
  //
  // ★ list の順序が往復しないことの証明（multiset を選ぶ根拠）★
  //   server の順序は queries.ts の `ORDER BY created_at DESC, id DESC` で決まる。
  //   最終 tie-break の `id` は **DB 生成 uuid** であり device 側に存在しないため、
  //   device は同じ順序を構造的に再現できない。一方 localStorage 側の配列順は
  //   append 順 / 表示順（例: self_prs は pr_index 昇順）であって created_at 順ではない。
  //   したがって kind 単位の list 順は「query の産物」であり source の内容ではない。
  //   → deterministic sort（item fingerprint 昇順）で正規化する。
  //   ※ item の **内部**の配列（answers / displayedQuestions 等）は jsonb が verbatim で
  //     往復するため順序が意味を持つ。そちらは sort しない（generic layer のまま）。

  self_analysis: {
    kind: 'self_analysis',
    authority: 'device_canonical_mirrored',
    capability: 'possible',
    canonicalSource: 'localStorage（lib/selfAnalysisLogStorage.ts / SelfAnalysisLog[]）',
    physicalSource: 'self_analysis_logs（UNIQUE(user_id, summary_input_hash)）',
    readPath: 'queries.ts selfAnalysisQuery → rowMappers.mapSelfAnalysisRow',
    contentFields: [
      'createdAt',
      'analysis',
      'summary',
      'displayedQuestions',
      'answers',
      'deepAnswers',
      'freeMemo',
    ],
    excludedFields: [
      { field: 'id', reason: 'db_generated_not_on_device', evidence: DB_UUID_EVIDENCE },
      {
        field: 'localLogId / summaryInputHash',
        reason: 'not_selected_by_reader',
        evidence: 'selfAnalysisQuery.columns に local_log_id / summary_input_hash が無い',
      },
      { field: 'updatedAt', reason: 'trigger_overwritten', evidence: UPDATED_AT_EVIDENCE },
    ],
    order: 'multiset',
    revision: {
      form: 'absent',
      reason:
        'version 列が無く、updated_at は trigger 上書き。created_at は content field として比較するが、それは「いつの論理状態か」ではなく行内容の一部として扱う',
    },
    blocker: null,
  },

  statement_review: {
    kind: 'statement_review',
    authority: 'device_canonical_mirrored',
    capability: 'possible',
    canonicalSource: 'localStorage（lib/statement/review/statementStorage.ts / ReviewHistoryItem[]）',
    physicalSource: 'statement_review_history（UNIQUE(user_id, local_review_id)）',
    readPath: 'queries.ts statementReviewQuery → rowMappers.mapStatementReviewRow',
    contentFields: ['localReviewId', 'university', 'faculty', 'department', 'result'],
    excludedFields: [
      { field: 'id', reason: 'db_generated_not_on_device', evidence: DB_UUID_EVIDENCE },
      {
        field: 'essay',
        reason: 'not_selected_by_reader',
        evidence:
          'statementReviewQuery.columns に essay（志望理由書の本文）が無い（E-P5 / queries.ts の「読まない列」宣言）',
      },
      {
        field: 'createdAt',
        reason: 'conditional_write',
        evidence:
          'lib/supabase/statementReviewHistory.ts:80 `if (item.createdAt) row.created_at = item.createdAt`。欠落時は DB DEFAULT now() が入り device 値と一致しない',
      },
      { field: 'updatedAt', reason: 'trigger_overwritten', evidence: UPDATED_AT_EVIDENCE },
    ],
    order: 'multiset',
    revision: {
      form: 'absent',
      reason: 'version 列が無く、updated_at は trigger 上書き、created_at は条件付き書込',
    },
    blocker: null,
  },

  self_pr: {
    kind: 'self_pr',
    authority: 'device_canonical_mirrored',
    capability: 'possible',
    canonicalSource: 'localStorage（SelfPR[]）',
    physicalSource: 'self_prs（UNIQUE(user_id, local_pr_id)）',
    readPath: 'queries.ts selfPrQuery → rowMappers.mapSelfPrRow',
    contentFields: ['localPrId', 'prIndex', 'title', 'body', 'latestResult'],
    excludedFields: [
      { field: 'id', reason: 'db_generated_not_on_device', evidence: DB_UUID_EVIDENCE },
      {
        field: 'createdAt',
        reason: 'conditional_write',
        evidence:
          'types/selfPR.ts `createdAt?: string`（「既存データは undefined になる」）+ lib/supabase/selfPRs.ts:78 `if (pr.createdAt)`',
      },
      {
        field: 'updatedAt',
        reason: 'trigger_overwritten',
        evidence: `${UPDATED_AT_EVIDENCE} / selfPRs.ts:76 は updated_at を送るが DO UPDATE 経路で now() に置き換わる`,
      },
      {
        field: 'seedInputHash',
        reason: 'not_selected_by_reader',
        evidence: 'selfPrQuery.columns に seed_input_hash が無い',
      },
    ],
    order: 'multiset',
    revision: {
      form: 'absent',
      reason:
        'updated_at は in-place 編集の recency として ORDER BY には使うが（queries.ts）、trigger 上書きのため device と一致せず revision token には使えない。pr_index は表示順であって revision ではない',
    },
    blocker: null,
  },

  interview_record: {
    kind: 'interview_record',
    authority: 'device_canonical_mirrored',
    capability: 'possible',
    canonicalSource: 'localStorage（lib/interviewRecordStorage.ts / StoredInterviewRecord[]）',
    physicalSource: 'interview_practice_records（UNIQUE(user_id, local_record_id)）',
    readPath: 'queries.ts interviewRecordQuery → rowMappers.mapInterviewRecordRow',
    contentFields: [
      'localRecordId',
      'practiceDate',
      'universityName',
      'facultyName',
      'examType',
      'mainQuestion',
      'improvementSummary',
      'whatWentWrong',
      'feedbackReceived',
      'selfNoted',
      'feedback',
    ],
    excludedFields: [
      { field: 'id', reason: 'db_generated_not_on_device', evidence: DB_UUID_EVIDENCE },
      {
        field: 'questionsAsked / myAnswers',
        reason: 'not_selected_by_reader',
        evidence: 'interviewRecordQuery.columns に questions_asked / my_answers が無い（E-P5 逐語）',
      },
      {
        field: 'partner',
        reason: 'not_selected_by_reader',
        evidence:
          'lib/supabase/interviewPracticeRecords.ts:105 は partner を書くが interviewRecordQuery.columns に無い',
      },
      {
        field: 'createdAt',
        reason: 'conditional_write',
        evidence:
          'lib/supabase/interviewPracticeRecords.ts:116 `if (record.createdAt)`（「legacy LS データで欠けることがある」）',
      },
      { field: 'updatedAt', reason: 'trigger_overwritten', evidence: UPDATED_AT_EVIDENCE },
    ],
    order: 'multiset',
    revision: {
      form: 'absent',
      reason: 'version 列が無く、updated_at は trigger 上書き、created_at は条件付き書込',
    },
    blocker: null,
  },

  // ── class 1 / E-S27 で projection が確定した kind ────────────────
  //
  // ★ Wave 2 では blocked だった（B7: workspace jsonb を丸ごと SELECT していたため
  //   content field 集合が未確定）。Wave 2.5 の canonical convergence で **E-S27 が
  //   `LOCKED`（Wave 2 で実装 + QA 済み）** になり、essayQuery / mapEssayRow が
  //   bounded projection へ確定したので blocker が消滅した。分類を `possible` へ訂正する。

  essay: {
    kind: 'essay',
    authority: 'device_canonical_mirrored',
    capability: 'possible',
    canonicalSource: 'localStorage（essayWorkspaces / EssayWorkspace[]）',
    physicalSource: 'essay_workspaces（UNIQUE(user_id, local_workspace_id)）',
    readPath: 'queries.ts essayQuery（reviews:workspace->reviews）→ rowMappers.mapEssayRow（E-S27）',
    contentFields: ['localWorkspaceId', 'reviews', 'reviewCount', 'createdAt'],
    excludedFields: [
      { field: 'id', reason: 'db_generated_not_on_device', evidence: DB_UUID_EVIDENCE },
      {
        field: 'bodyOnServer',
        reason: 'type_marker_not_content',
        evidence: 'rowMappers.ts ExamEssayServerRow / ExamEssayReviewServerRow の bodyOnServer は false リテラルの型目印（E-S27・E-P8 と同手法）',
      },
      {
        field: 'body / rewriteDraft / sparring.answers / reviews[*].essayBodySnapshot',
        reason: 'not_selected_by_reader',
        evidence:
          'E-S27（LOCKED）: essayQuery が reviews:workspace->reviews へ絞り、mapEssayReview が essayBodySnapshot / breakdown / sourceIssueId を採らない。server projection に本文が 1 文字も載らないことを stage3 S15b/S15c が検証する',
      },
      {
        field: 'reviewsTruncated',
        reason: 'derived_from_included_field',
        evidence: 'rowMappers.mapEssayRow が `all.length > limits.recordItems` から導出する。reviewCount を含めているため独立した情報を持たない',
      },
      { field: 'updatedAt', reason: 'trigger_overwritten', evidence: UPDATED_AT_EVIDENCE },
    ],
    order: 'multiset',
    revision: {
      form: 'absent',
      reason:
        'version 列が無く、updated_at は trigger 上書き。workspace 内の updatedAt は jsonb として往復するが reader が projection に載せないため比較できない。createdAt は content field として比較する（EssayWorkspace.createdAt は types/essay.ts:135 で必須、writer は essayWorkspaces.ts:94 で無条件に送る）',
    },
    blocker: null,
  },

  // ── class 2 / Source-Sync 非適用（E-S3）───────────────────────────
  //
  // ★ 「まだ作れない」ではなく「作ってはいけない」★
  //   class 2 には client canonical が存在しない。Source-Sync を当てると
  //   「client の cache が古い＝server の正しいデータを使えない」という逆向きの誤りになる。
  //   canary gate（authorization）は class 2 にも必要だが、それは verification ではない。

  interview_ai: {
    kind: 'interview_ai',
    authority: 'server_authoritative',
    capability: 'not_applicable',
    canonicalSource: 'server route（app/api/interview-ai/** が著者）',
    physicalSource: 'interview_ai_results + interview_ai_sessions',
    readPath: 'queries.ts interviewAiQuery → rowMappers.mapInterviewAiRow',
    contentFields: [],
    excludedFields: [],
    order: 'sequence',
    revision: { form: 'absent', reason: 'E-S3 により Source-Sync 非適用' },
    blocker: 'E-S3（LOCKED）: class 2 に Source-Sync を適用しない',
  },

  presentation: {
    kind: 'presentation',
    authority: 'server_authoritative',
    capability: 'not_applicable',
    canonicalSource: 'server route（app/api/presentation/** が著者）',
    physicalSource: 'presentation_results + presentation_attempts + presentation_sessions',
    readPath: 'queries.ts presentationCoreQuery → rowMappers.mapPresentation*Row',
    contentFields: [],
    excludedFields: [],
    order: 'sequence',
    revision: { form: 'absent', reason: 'E-S3 により Source-Sync 非適用' },
    blocker: 'E-S3（LOCKED）: class 2 に Source-Sync を適用しない',
  },
};

/**
 * ★ writer schema contract の版と comparison eligibility（Stage 5.11 / E-S59）★
 *
 * `schema_version` は snapshot 3 kind（basic_info / activity / diagnosis）の
 * mirror row が持つ **writer contract の版**である。次のいずれでもない:
 *
 *   × payload の shape 版         v1→v2（diagnosis）は shape を変えずに bump した
 *   × storage row の版             行の物理形式は DDL が決めており版に依らない
 *   × device が保持する値          device は保存していない。下の定数を **合成**している
 *
 * したがって sync view の `schemaVersion` を device と突き合わせることは、
 * 「この行を最後に書いた writer は、今の build と同じ contract か」を問うている。
 * 内容の一致とは **別の問い**である。
 *
 * ★ 版が上がると既存 row は comparison ineligible になる ★
 *   `schemaVersion` は content field なので、writer が bump した瞬間に
 *   **bump 前に書かれた全 row** が device 側の新しい定数と一致しなくなる。
 *   これは事故ではなく、「古い contract で書かれた行を verified と呼ばない」という
 *   fail-closed な設計である。ineligible な行は canonical 経路に乗らず legacy へ倒れる。
 *
 * ★ ineligible ≠ 内容が違う ★
 *   下の `payloadMappingStable` が真の kind では、writer は device canonical を
 *   **無加工で** payload に載せる。したがって版が違っても payload の意味は同じであり、
 *   `projectionCompatible` が真なら **AI-visible な射影は版に依らず同一**になる。
 *   ineligible は「比較の資格が無い」であって「値が壊れている」ではない。
 *
 * ★ この表を回避策に使わない（E-S44 / E-S59）★
 *   ineligible を verified へ格上げしたり、`schemaVersion` を sync view から外して
 *   一致させたりしてはいけない。DB backfill も本表の役目ではない。
 *   本表は **宣言**であり、版を上げる packet がその影響を明示するための場所である。
 */
export type ExamWriterSchemaContract = {
  /** 現行 writer が書く版（`EXAM_DEVICE_SCHEMA_VERSIONS` と一致しなければならない）。 */
  readonly current: string;
  /** 過去に書かれ、mirror に残り得る版（新しい順）。 */
  readonly superseded: readonly string[];
  /** writer が device canonical を無加工で payload に載せるか。 */
  readonly payloadMappingStable: boolean;
  /**
   * superseded な版の row でも、canonical 射影が現行版と同じ AI-visible 値になるか。
   * ★ 真でも comparison eligibility は開かない ★（射影の互換性と比較の資格は別軸）
   */
  readonly projectionCompatible: boolean;
  readonly note: string;
};

export type ExamSchemaVersionedKind = 'basic_info' | 'activity' | 'diagnosis';

export const EXAM_SCHEMA_VERSIONED_KINDS = [
  'basic_info',
  'activity',
  'diagnosis',
] as const satisfies readonly ExamSchemaVersionedKind[];

export const EXAM_WRITER_SCHEMA_CONTRACTS: Readonly<
  Record<ExamSchemaVersionedKind, ExamWriterSchemaContract>
> = {
  basic_info: {
    current: '1',
    superseded: [],
    // `stripName()` が氏名を落とすため無加工ではない（E-P8）。
    payloadMappingStable: false,
    projectionCompatible: true,
    note:
      'lib/supabase/basicInfoLogs.ts の SCHEMA_VERSION は "1" で bump 実績が無い。'
      + 'DDL DEFAULT も "1" なので既存行と現行 writer の版は一致する（divergence なし）。',
  },
  activity: {
    current: '1',
    superseded: [],
    payloadMappingStable: true,
    projectionCompatible: true,
    note:
      'lib/supabase/activityLogs.ts の SCHEMA_VERSION は "1" で bump 実績が無い。'
      + 'DDL DEFAULT も "1" なので既存行と現行 writer の版は一致する（divergence なし）。',
  },
  diagnosis: {
    current: '3',
    // ★ "1" だけではない ★ writer 定数は 1 → 2 → 3 と 2 度 bump しており、
    //   各時期に書かれた行がそのまま残る。DDL DEFAULT の "1" も同じ値域に入る。
    superseded: ['2', '1'],
    // `upsertDiagnosisLogToSupabase` は `payload: input.diagnosis` を無加工で書く。
    payloadMappingStable: true,
    // resolveDiagnosisTypeHint が number(1-4) と ExamType(9種) の両系統を扱うため、
    // v1 / v2 の row でも hint 1 文は現行と同じ規則で解決できる（E-S44 / E-S59）。
    projectionCompatible: true,
    note:
      'lib/supabase/diagnosisLogs.ts の SCHEMA_VERSION は "3"。'
      + 'v1→v2 は calcDiagnosisResultType の判定変更（payload shape 不変）、'
      + 'v2→v3 は resultType の値域拡張（number(1-4) に string(ExamType 9種) を追加）で、'
      + 'いずれも DiagnosisResult → payload の写像は変えていない。'
      + 'DDL DEFAULT は "1" のままだが、全 write path が schema_version を明示送信するため'
      + 'default に落ちる経路は存在しない（Stage 5.11 で repo 全走査を QA 化した）。',
  },
};

/**
 * その版の mirror row を device と比較してよいか（純関数）。
 *
 * ★ 現行版だけが eligible ★ superseded / unknown / null はすべて false へ倒す
 *   （fail-closed。「たぶん同じ contract だろう」で verified を作らない）。
 */
export function isComparableSchemaVersion(
  kind: ExamSchemaVersionedKind,
  version: string | null | undefined,
): boolean {
  return typeof version === 'string' && version === EXAM_WRITER_SCHEMA_CONTRACTS[kind].current;
}

/**
 * ★ 「adapter はあるが runtime で有効化してはいけない」kind の宣言（Wave 3）★
 *
 * capability（contract が確定しているか）とは **別の軸**である。
 *   capability = possible : sync view の contract が確定し、device / mirror の両 mapper がある
 *   runtime enable        : その kind の claim を実際の request に載せてよいか
 *
 * essay / self_pr は前者を満たすが後者を満たさない。**理由は kind ごとに別である。**
 * 片方の根拠をもう片方へ流用しない（essay の「完全反転」は self_pr では成立しない）。
 *
 * ★ blocker は「消えた」のではなく Stage 5.8 で **入れ替わった**（E-S52）★
 *
 *   旧（R5 / E-S27）: `reviews:workspace->reviews` は PostgREST が jsonb の sub-path を
 *     検証しない（存在しない path も 200）ため live schema check で証明できなかった。
 *     → **CLOSED**。本番 SQL Editor の jsonb 型集計で解消済み
 *       （E-H1「Post-Wave 4.5 に本番 SQL Editor で確定した部分」/ E-S41）。
 *       数値の正本は E-H1 本文だけに置き、ここへ複製しない。
 *
 *   新（E-S52）: **server の read window を device が再現できない。**
 *     `essayQuery` は `ORDER BY updated_at DESC, created_at DESC, id DESC` で上位 cap 件を
 *     選ぶが、`essay_workspaces.updated_at` は `NOT NULL DEFAULT now()` が決める
 *     **mirror 書込時刻**であって device の `workspace.updatedAt` ではない。
 *     さらに `backfillEssayWorkspacesOnce` は `loadEssayWorkspaces()`（updatedAt DESC）の
 *     順に逐次 upsert するため、device で最も新しい workspace が最も小さい `updated_at` を
 *     得る＝ **完全反転** する。workspace が cap（5）以下なら全件一致するが、
 *     6〜10 件（LRU 上限 10）の user は内容が同期していても永久 mismatch になる。
 *
 *   ★ device window を足しても解決しない ★
 *     `deviceEssayView` に `selectDeviceSyncWindow` を掛けても、**揃えるべき順序キー
 *     （DB の `updated_at`）を device が持っていない**。近似で verified を作らないため、
 *     essay の device view は意図的に window 未適用のまま据え置く（E-S52）。
 *
 * ★ E-S41 と矛盾しない ★
 *   E-S41 は「機構（空の map）は残す。contract は確定しているが production evidence が
 *   未取得という状態は今後も起こり得るため、宣言 1 行で veto できる口を保つ」と定めた。
 *   本 blocker はまさにその口を **想定どおりに使い直した**ものであり、R5 の結論を
 *   覆すものではない（R5 は CLOSED のまま）。
 *
 * ★ self_pr の blocker は essay とは別根拠である（Stage 5.10 / E-S50 Level C）★
 *
 *   `selfPrQuery` も `ORDER BY updated_at DESC, created_at DESC, id DESC` で上位 cap（5）件を
 *   選ぶが、**essay の「完全反転」はここでは起きない**。`prToRow` が
 *   `updated_at: pr.updatedAt` を明示送信するため、全件 INSERT で終わる backfill 経路では
 *   device の recency がそのまま DB に入る（`lib/supabase/selfPRs.ts`）。
 *   したがって essay の根拠をコピーしてはいけない。self_pr が blocked なのは次の 4 点である。
 *
 *   1. device が window を持たない
 *      `deviceSelfPrView` は `selectDeviceSyncWindow` を掛けず **全件**を hash する。
 *      server は上位 5 件しか読まない。6 件以上の user は内容が同期していても mismatch。
 *   2. window を足しても揃わない
 *      `selectDeviceSyncWindow` は `created_at` でしか上位 N 件を選べないが、
 *      server の第 1 ソートキーは `updated_at` である。さらに UPDATE 経路では
 *      trigger `self_prs_set_updated_at` が `now()` で上書きするため、
 *      編集を重ねた端末の `updatedAt` と DB の `updated_at` は一致しない。
 *   3. delete が mirror へ伝播しない
 *      `dualWriteSelfPRsDelta` は `propagateDelete: false` 固定
 *      （`app/self-pr/page.tsx`）。device で消した PR が mirror に残り、
 *      server の top-5 を **device に存在しない行**が占め得る。
 *   4. id tie-break を device が再現できない
 *      `deviceSelfPrRow` は `id: null` を置く。server の最終 tie-break は `id DESC` であり、
 *      device 表現はこの順序を canonical に再現できない。
 *
 *   ★ ここで mismatch を消しにいかない ★
 *     1〜4 の解消は ordering / cap / delete の product semantics（STATE の HD-1〜HD-6）を
 *     決めることであり、Stage 5.10 の scope ではない。Level C ruling は
 *     「未解決だから runtime enable しない」という安全側の判断であって、
 *     semantics を決めたことにはしない。
 *
 * ★ これは宣言であって gate ではない ★
 *   feature flag も canary も env もここでは持たない。判定は enable.ts が行う。
 *   `examSyncUsability` の 4 段 veto のうち 2 段目にすぎず、3 段目の canary は既定 deny。
 */
export const EXAM_SYNC_RUNTIME_ENABLE_BLOCKED: Readonly<
  Partial<Record<ExamSourceKind, string>>
> = {
  essay:
    'E-S52 read window: E-S27「live 検証の限界」（reviews:workspace->reviews）は R5 / E-S41 で '
    + 'CLOSED だが、server の updated_at DESC window を device が再現できない'
    + '（updated_at は mirror 書込時刻で、backfill 経路では device の recency と完全反転する）ため、'
    + 'runtime claim / enable / canary を引き続き禁止する。'
    + 'pure な device ↔ mirror parity は成立済み（qa:examSpine:syncDevice / qa:examSpine:stage5_8）',
  self_pr:
    'E-S50 Level C: server は updated_at DESC / created_at DESC / id DESC の上位 5 件を読むが、'
    + 'deviceSelfPrView は window 未適用で全件を hash し、device は server の id tie-break も '
    + 'updated_at も再現できない。さらに dualWriteSelfPRsDelta は propagateDelete=false 固定で、'
    + 'device で削除した PR が mirror に残り server の top-5 を占め得る。'
    + 'したがって cap 超過 / 編集順 / 削除残存のいずれでも verified を主張できないため、'
    + 'runtime claim / enable / canary を禁止する。'
    + 'pure な device ↔ mirror parity は成立済み（qa:examSpine:syncDevice / qa:examSpine:stage5_10）',
};

/**
 * adapter を実装した kind（capability === 'possible'）。
 * Wave 2.5 で essay を追加（E-S27 が LOCKED になり blocker が消滅したため）。
 */
export const EXAM_SYNC_SUPPORTED_KINDS = [
  'basic_info',
  'activity',
  'diagnosis',
  'self_analysis',
  'statement_review',
  'self_pr',
  'essay',
  'interview_record',
] as const;

export type ExamSyncSupportedKind = (typeof EXAM_SYNC_SUPPORTED_KINDS)[number];

export function isExamSyncSupportedKind(kind: ExamSourceKind): kind is ExamSyncSupportedKind {
  return (EXAM_SYNC_SUPPORTED_KINDS as readonly ExamSourceKind[]).includes(kind);
}
