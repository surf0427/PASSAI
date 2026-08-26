// PASSAI 受験版 Exam Spine — Stage 3 request-local snapshot（E-S21）。
//
// 1 request の中で同じ kind を 2 度読まないための memo。**それ以上の意味を持たせない。**
//
// ★ global TTL cache を作らない ★
//   旧設計（60 秒 TTL / userId を key にした module-level Map）は採らない。理由:
//     - userId を key にした module-level Map は、process 内で **request を跨いで**
//       他人の request が入れた値に触れ得る構造になる。
//     - TTL は「いつの時点のデータか」を曖昧にする。Stage 3 の出力は未 verify な candidate
//       であり、そこに時間軸の曖昧さを足すと Stage 4 の verification が意味を持たなくなる。
//     - 「stale を使わない」という fail-open の定義（E-S1 / E-S8）と正面から衝突する。
//
// ★ canonical: `WeakMap<Request, …>` ★
//   key は Request オブジェクトそのもの。したがって:
//     - 別 Request では reuse が **構造的に**起きない（key が違う）
//     - request が GC されれば entry も消える（TTL も明示 invalidation も不要）
//     - module-level に user データが溜まらない
//
// ★ cache hit でも authorization を再評価する ★
//   snapshot は「読み取り結果の memo」であって「認可の memo」ではない。
//   authorize() は毎回呼び、結果が unauthenticated / unauthorized なら何も返さず、
//   何も保存しない。保存済み entry の userId と一致しない場合はその entry を破棄する。
//
// ★ snapshot を無効化しても reader の正しさが変わらない ★
//   本 module は readExamSources の純粋な memo であり、経路を外しても同じ値が得られる。
//
// 備考: 本 file は server 実行専用（`.server.ts`）だが `import 'server-only'` は入れていない。
//   同 package は本 repo の直接依存ではなく Node からは解決できず、QA の実行系
//   （`npx tsx` / E-S14）が import 時に落ちるため。dependency を増やさない方針
//   （Stage 0〜4 は dependency 追加禁止 / E-S14）を優先し、client bundle への混入は
//   「production runtime import = 0」を QA で固定することで担保する。

import type { ExamContextPurpose } from '../types';
import { gateExamSourceKinds } from '../purpose';
import type { ExamSourceKind, ExamSourceReadStatus } from '../sourceData/types';
import { EMPTY_EXAM_SOURCE_BUNDLE, EXAM_SOURCE_KINDS } from '../sourceData/types';
import type { ExamSourceBundle } from '../sourceData/types';
import type { ExamReadExecutor, ExamReadLogEntry, ExamSourceReadOutcome } from './types';
import { EXAM_BUNDLE_SLOT, readExamSources } from './readSources';
import type { ExamReadResult } from './readSources';

/** authorize() の結果。userId は **server auth 由来**でなければならない。 */
export type ExamRequestAuthorization =
  | { ok: true; userId: string }
  | { ok: false; reason: 'unauthenticated' | 'unauthorized' };

export type ExamRequestSnapshotInput = {
  /** WeakMap の key。request-local であることの根拠。 */
  request: Request;
  /**
   * 毎回呼ばれる。cache hit でも必ず評価される。
   * body / query string / 任意 JSON から userId を作ってはいけない。
   */
  authorize: () => Promise<ExamRequestAuthorization>;
  kinds: readonly ExamSourceKind[];
  /**
   * ★ Purpose gate（E-S28）★ 指定すると許可外 kind は snapshot にも入らず query も出ない。
   * 未知の purpose は全 kind denied（default deny）。
   */
  purpose?: ExamContextPurpose;
  executor: ExamReadExecutor;
  clock?: () => number;
};

export type ExamRequestSnapshotResult =
  | {
      ok: true;
      result: ExamReadResult;
      /** 今回 executor を叩いた kind。 */
      freshlyRead: readonly ExamSourceKind[];
      /** snapshot から返した kind（executor を叩いていない）。 */
      servedFromSnapshot: readonly ExamSourceKind[];
    }
  | { ok: false; reason: 'unauthenticated' | 'unauthorized' };

/** kind 単位の保存単位。read の結果をそのまま持つ（判断を持たない）。 */
type CachedKind = {
  value: unknown;
  outcome: ExamSourceReadOutcome;
  log: ExamReadLogEntry;
};

type SnapshotEntry = {
  /** この entry を作った認可済み userId。一致しない authorize 結果には使わせない。 */
  userId: string;
  kinds: Map<ExamSourceKind, CachedKind>;
};

// ★ module-level に置くのはこの WeakMap だけ。値は Request の生存期間に縛られる。
const SNAPSHOTS = new WeakMap<Request, SnapshotEntry>();

export async function readExamSourcesForRequest(
  input: ExamRequestSnapshotInput,
): Promise<ExamRequestSnapshotResult> {
  // ── 1. 認可は毎回評価する（cache hit でも省略しない）──────────────
  const auth = await input.authorize();
  if (!auth.ok) {
    // unauthorized / unauthenticated の結果は **保存しない**。
    // 既存 entry があっても返さない（認可されていない呼び出しに値を渡さない）。
    return { ok: false, reason: auth.reason };
  }

  // ── 2. entry の取得。userId が違えば破棄して作り直す ────────────────
  let entry = SNAPSHOTS.get(input.request);
  if (entry && entry.userId !== auth.userId) {
    // 同一 Request が別 identity で認可されることは通常起きないが、
    // 起きた場合に他人の読み取り結果を渡さないよう構造的に閉じる。
    SNAPSHOTS.delete(input.request);
    entry = undefined;
  }
  if (!entry) {
    entry = { userId: auth.userId, kinds: new Map() };
    SNAPSHOTS.set(input.request, entry);
  }

  // ── 3. purpose gate → 未取得の kind だけ読む（per-kind read-once）────
  //
  // ★ gate は snapshot の **手前**に置く。許可外 kind を snapshot に入れると、
  //   同一 request 内の別 purpose の consumer がそれを拾えてしまう。
  const deduped = dedupeKinds(input.kinds);
  const gate =
    input.purpose === undefined
      ? { allowed: deduped, denied: [] as ExamSourceKind[] }
      : gateExamSourceKinds(input.purpose, deduped);
  const requested = [...gate.allowed];
  const servedFromSnapshot = requested.filter((k) => entry.kinds.has(k));
  const missing = requested.filter((k) => !entry.kinds.has(k));

  if (missing.length > 0) {
    const fresh = await readExamSources({
      userId: auth.userId,
      kinds: missing,
      purpose: input.purpose,
      executor: input.executor,
      clock: input.clock,
    });
    for (const kind of missing) {
      const log = fresh.log.find((l) => l.kind === kind);
      entry.kinds.set(kind, {
        value: fresh.bundle[EXAM_BUNDLE_SLOT[kind]],
        outcome: fresh.outcomes[kind],
        // log が無いのは理論上起きないが、その場合も status を outcome から復元して落とさない。
        log: log ?? {
          kind,
          status: fresh.statuses[kind],
          queryCount: fresh.outcomes[kind].queryCount,
          rowCount: 0,
          truncated: fresh.outcomes[kind].truncated,
          enrichmentFailed: fresh.outcomes[kind].enrichmentFailed,
        },
      });
    }
  }

  // ── 4. requested 分を bundle へ再構成する ──────────────────────────
  //
  // ★ 失敗した kind も保存する（per-kind read-once）。同一 request 内で再試行して
  //   落ちている source を叩き直さない。fail-open は「context を減らす」ことであり、
  //   retry で負荷を増やすことでも、古い値へ差し替えることでもない。
  return {
    ok: true,
    result: composeResult(requested, entry, gate.denied),
    freshlyRead: missing,
    servedFromSnapshot,
  };
}

/**
 * snapshot を経由せずに読む場合と同じ形へ組み立て直す。
 * requested に含まれない kind は 'skipped' のまま（10 kind 全部を毎回返す契約）。
 */
function composeResult(
  requested: readonly ExamSourceKind[],
  entry: SnapshotEntry,
  deniedByPurpose: readonly ExamSourceKind[],
): ExamReadResult {
  const bundle: Record<string, unknown> = { ...EMPTY_EXAM_SOURCE_BUNDLE };
  const statuses: Record<string, ExamSourceReadStatus> = {};
  const outcomes: Record<string, ExamSourceReadOutcome> = {};
  const log: ExamReadLogEntry[] = [];

  for (const kind of EXAM_SOURCE_KINDS) {
    statuses[kind] = 'skipped';
    outcomes[kind] = { status: 'skipped', queryCount: 0, truncated: false, enrichmentFailed: false };
  }

  for (const kind of requested) {
    const cached = entry.kinds.get(kind);
    if (!cached) continue;
    bundle[EXAM_BUNDLE_SLOT[kind]] = cached.value;
    statuses[kind] = cached.outcome.status;
    outcomes[kind] = cached.outcome;
    log.push(cached.log);
  }

  return {
    bundle: bundle as ExamSourceBundle,
    deniedByPurpose,
    statuses: statuses as Record<ExamSourceKind, ExamSourceReadStatus>,
    outcomes: outcomes as Record<ExamSourceKind, ExamSourceReadOutcome>,
    log,
  };
}

function dedupeKinds(kinds: readonly ExamSourceKind[]): ExamSourceKind[] {
  const seen = new Set<ExamSourceKind>();
  const out: ExamSourceKind[] = [];
  for (const k of kinds) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * テスト用の観測 helper（本番経路では使わない）。
 * snapshot が Request に紐づいていること・別 Request で共有されないことを外から確認する。
 */
export function peekExamSnapshotKinds(request: Request): readonly ExamSourceKind[] {
  const entry = SNAPSHOTS.get(request);
  return entry ? [...entry.kinds.keys()] : [];
}
