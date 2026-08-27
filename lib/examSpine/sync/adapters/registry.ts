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
 * ★ 「adapter はあるが runtime で有効化してはいけない」kind の宣言（Wave 3）★
 *
 * capability（contract が確定しているか）とは **別の軸**である。
 *   capability = possible : sync view の contract が確定し、device / mirror の両 mapper がある
 *   runtime enable        : その kind の claim を実際の request に載せてよいか
 *
 * essay は前者を満たすが後者を満たさない。
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
