// PASSAI 受験版 Exam Spine — Stage 3 read layer contract（型・定数のみ）。
//
// Stage 3 の責務:
//   durable server source → canonical reader → ExamSourceBundle + 10 kind の status
//
// Stage 3 の非目標（意図的に実装しない）:
//   - Source-Sync / revision / fingerprint / verified / mismatch / veto   → Stage 4
//   - canary / feature flag / runtime wiring / route 接続                  → Stage 4 以降
//   - Layer 2〜5（Stage 2 の block / selection / ordering / render）の再設計 → 凍結
//   - production DB mutation（read layer に insert / update / upsert / delete は 0 本）
//
// ★ Stage 3 の出力は「未 verify な server candidate」である（E-S17 / 下記 Authority 節）★
//   `device_canonical_mirrored` の 8 kind は canonical が端末の localStorage であり、
//   server row が存在することは「その request を出した端末の canonical と一致する」ことを
//   意味しない。Stage 3 の結果**だけ**を理由に bridge / client source を排除してはいけない。
//
// 純粋な型・定数のみ（I/O / env / Supabase / next / AI / Date / Math.random 非依存）。

import type { ExamSourceKind, ExamSourceReadStatus } from '../sourceData/types';

// ── Query を「呼び出し」ではなく「データ」として持つ ──────────────────
//
// なぜこの形にするか（E-S22）:
//   1. read layer が Supabase / next を一切知らずに済む（純粋・決定論・単体で検証可能）
//   2. QA が ordering / limit / filter / table / **列名**を宣言的に freeze できる
//      （「transcript を SELECT していない」を文字列 grep ではなく構造で示せる）
//   3. SELECT 以外の操作を型として表現できない ＝ mutation を書く手段が構造的に無い
//
//   実際に PostgREST を叩くのは supabaseExecutor.server.ts の 1 箇所だけで、
//   QA は fake executor を渡す（実ネットワーク 0 / 実 DB 0）。

export type ExamReadFilter =
  | { op: 'eq'; column: string; value: string }
  | { op: 'in'; column: string; values: readonly string[] };

export type ExamReadOrder = {
  column: string;
  ascending: boolean;
};

/**
 * PostgREST の embedded relation。
 * `inner: true` は「親が解決できた行だけ」に絞る（所有の構造的保証に使う）。
 */
export type ExamReadEmbed = {
  /** select 上の別名。row 側でこの key に入る。 */
  alias: string;
  table: string;
  inner: boolean;
  columns: readonly string[];
};

export type ExamReadQuery = {
  /** どの Layer 1 kind のための query か。registry 外 table の SELECT を QA が検出する。 */
  kind: ExamSourceKind;
  /**
   * `core`       … その kind の主データ。失敗すれば kind 全体が error。
   * `enrichment` … core が取れた後にだけ発行する補助 read。失敗しても core を失敗にしない。
   */
  role: 'core' | 'enrichment';
  table: string;
  /** 列を配列で持つ（文字列連結ではない）。読まない列を QA が構造的に確認できる。 */
  columns: readonly string[];
  embed?: ExamReadEmbed;
  /** 必ず owner scope（user_id の eq）を含む。QA が全 query に対して強制する。 */
  filters: readonly ExamReadFilter[];
  /** 明示 ordering。`maybeSingle`（user_id UNIQUE で 1 行に決まる）だけ空を許す。 */
  order: readonly ExamReadOrder[];
  /** `many` は必ず数値（cap + 1）。`maybeSingle` は null。implicit unlimited は存在しない。 */
  limit: number | null;
  mode: 'many' | 'maybeSingle';
};

/** PostgREST の select 文字列を組み立てる純関数（executor と QA が共有する）。 */
export function formatSelect(query: ExamReadQuery): string {
  const base = query.columns.join(', ');
  if (!query.embed) return base;
  const e = query.embed;
  return `${base}, ${e.alias}:${e.table}${e.inner ? '!inner' : ''}(${e.columns.join(', ')})`;
}

/**
 * executor が返す失敗情報。
 * ★ `message` は PostgREST 由来で本文・識別子を含み得るため、**観測ログへ出さない**（E-S13）。
 *   ここに保持するのは呼び出し側での分岐と、開発時の手動確認のため。
 */
export type ExamReadFailure = {
  code: string | null;
  message: string | null;
};

export type ExamReadResponse = {
  /** 成功時の行配列（0 行でも `[]`）。`null` は失敗を意味する。 */
  rows: readonly unknown[] | null;
  error: ExamReadFailure | null;
};

/** query 1 本を実行する関数。read layer が持つ唯一の I/O 手段。 */
export type ExamReadExecutor = (query: ExamReadQuery) => Promise<ExamReadResponse>;

// ── Read caps（E-S19）──────────────────────────────────────────────────
//
// ★ ここでの cap は **row count cap** であり、read layer が所有する。
//   Stage 2 の `EXAM_CONTEXT_BUDGETS`（character budget）とは別物で、両者を混ぜない。
//   Stage 2 の budget は依然 **enforce しない**（observed_only が大半で enforcement contract
//   ではない）。逆に、feature の prompt 文字数 policy を Stage 3 へ持ち込むこともしない。
//
// 取得は `cap + 1` 件で行い、
//   rows <= cap     → ok
//   rows == cap + 1 → truncated（余剰 1 行は drop）
// count query は追加しない（正確な総数のために 1 往復増やす価値が無い）。
export const EXAM_READ_CAPS = {
  self_analysis: 5,
  statement_review: 5,
  self_pr: 5,
  essay: 5,
  interview_record: 5,
  interview_ai: 3,
  presentation: 3,
} as const;

export type ExamCappedSourceKind = keyof typeof EXAM_READ_CAPS;

export function isExamCappedSourceKind(
  kind: ExamSourceKind,
): kind is ExamCappedSourceKind {
  return Object.prototype.hasOwnProperty.call(EXAM_READ_CAPS, kind);
}

/** user_id UNIQUE で 1 行に決まる snapshot kind。cap を持たない。 */
export const EXAM_SNAPSHOT_KINDS = ['basic_info', 'activity', 'diagnosis'] as const;
export type ExamSnapshotSourceKind = (typeof EXAM_SNAPSHOT_KINDS)[number];

// ── Dormant source（E-S16）────────────────────────────────────────────
//
// `presentation_practice_records` は schema に存在し write route も存在するが、
// `app/**` / `lib/**` に呼び出し元が 1 つも無く、実質的に行が書かれていない。
//   classification: dormant_no_author
// したがって 11 個目の kind にせず、authority binary にも入れず、reader から SELECT しない。
// これは「将来も使わない」という決定ではなく、現時点の観測事実の記録である。
export const EXAM_DORMANT_TABLES = {
  presentation_practice_records: 'dormant_no_author',
} as const;

// ── null と [] を混同しないための値表現 ────────────────────────────────
//
// history / array kind は `[]`（正常に読めて 0 件）と `null`（未取得）で足りるが、
// snapshot kind は slot が単数なので「読めたが行が無い」を `null` にすると
// status='ok' と組んで **null + ok** という禁止状態になる。
// そこで snapshot は present / absent を明示的に持つ。
export type ExamSnapshotValue<T> =
  | { state: 'present'; row: T }
  | { state: 'absent' };

export type ExamSourceReadOutcome = {
  status: ExamSourceReadStatus;
  /** 実際に発行した query 本数（core + enrichment）。core 不在時 0 本を QA が検証する。 */
  queryCount: number;
  /** core が cap + 1 件返したか。 */
  truncated: boolean;
  /** enrichment だけが失敗したか（core は成功している）。 */
  enrichmentFailed: boolean;
};

// ── Observability（E-S12 / E-S13）─────────────────────────────────────
//
// ★ 型で閉じる。number / boolean / closed enum しか入らない形にしてあるため、
//   userId / UUID / 大学名 / 本文 / transcript / prompt / 任意 free text を
//   **構造的に**載せられない。caller が任意 metadata を足す口も用意しない。
export type ExamReadLogEntry = {
  kind: ExamSourceKind;
  status: ExamSourceReadStatus;
  queryCount: number;
  rowCount: number;
  truncated: boolean;
  enrichmentFailed: boolean;
  /** clock が注入されたときだけ入る。read layer 自身は時計を持たない。 */
  durationMs?: number;
};

export type ExamReadLog = readonly ExamReadLogEntry[];
