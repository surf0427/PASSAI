// PASSAI 受験版 Exam Spine — Stage 4 Wave 4 / sync signal の wire contract（純関数）。
//
//   device claim（kind + content fingerprint）
//        ↓ serializeExamSyncSignal
//   bounded wire 文字列
//        ↓ parseExamSyncSignal（**untrusted 入力**）
//   validated claim set
//
// ★★ trust model（E-S2 / 過大主張しない）★★
//   この signal は **client-provided consistency claim** であり negative safety gate である。
//   「その値が本当に端末の localStorage から生成された」という証明ではない。
//   保証するのは「申告と server 可視状態が一致しない限り使わない」という一方向の制約だけ。
//     ✅ server 側データを「使わない」方向へ倒す veto 入力
//     ❌ 内容の権威 / DB selector / user_id や権限の根拠
//
// ★★ default deny ★★
//   未知 version / 未知 kind / 不正 fingerprint / 重複 / 超過 / 壊れた token は
//   「分かる部分だけ使う」をしない。verified を作れない方向へ倒す。
//
// ★ revision axis を新規導入しない（R1 未解決）★
//   claim は **kind + content fingerprint** だけで構成する。updated_at / created_at /
//   schema version / DB sequence / source_hash / clock を claim に載せない。
//   Canon §12 / §13 の tension（R1）が未解決である以上、独立した revision 軸を
//   ここで作ると「内容一致 + revision 相違」の分岐が初めて発火してしまう。
//
// ★ header にはまだ載せない ★
//   本 file は serialize / parse の純関数だけを持つ。Request / Response / headers /
//   cookies / fetch / Date / Math.random に一切触れない。実際の transport は Wave 5 以降。
//
// 非依存: I/O / clock / random / logging / network / DB / AI。

import type { ExamSourceKind } from '../sourceData/types';
import { isExamSourceKind } from '../sourceData/types';
import type { ExamFingerprint } from './fingerprint';
import { EXAM_FINGERPRINT_VERSION, isExamFingerprint } from './fingerprint';
import type { ExamSyncSupportedKind } from './adapters/registry';
import { EXAM_SYNC_SUPPORTED_KINDS } from './adapters/registry';

// ── version ───────────────────────────────────────────────────────────
//
// ★ signal version は fingerprint version に **束縛**されている ★
//   wire には `efp1:` の prefix を載せず 64 hex だけを送るため、hex をどの
//   fingerprint schema として解釈するかは signal version が決める。
//   Wave 1 の `EXAM_FINGERPRINT_VERSION` を上げたら本 version も必ず上げること
//   （QA が両者の対応を pin する）。上げ忘れると **旧 client の hex を新 schema として
//   誤解釈**することになり、これは verified の偽陽性に直結する。
export const EXAM_SYNC_SIGNAL_VERSION = 'esy1';

/** `esy1` が前提としている fingerprint schema。 */
export const EXAM_SYNC_SIGNAL_FINGERPRINT_VERSION = 'efp1';

// ── bounds ────────────────────────────────────────────────────────────
//
// 上限の導出（推測値ではない）:
//   最長 kind 名        'statement_review' = 16
//   1 entry             16 + '=' + 64 hex  = 81
//   8 kind + 区切り 7   8 * 81 + 7          = 655
//   version prefix      'esy1:'             = 5
//   worst case                              = 660
// これに余裕を持たせて 1024 を上限とする。上限は parser abuse（巨大 header）を
// 構造的に止めるためのものであり、正当な signal は 660 を超えない。
export const EXAM_SYNC_SIGNAL_MAX_LENGTH = 1024;

/** claim 数の上限 = Source-Sync 対象 kind 数（E-S3 により class 2 は対象外）。 */
export const EXAM_SYNC_SIGNAL_MAX_CLAIMS = EXAM_SYNC_SUPPORTED_KINDS.length;

const HEX64 = /^[0-9a-f]{64}$/;
const CLAIM_KINDS: ReadonlySet<string> = new Set<string>(EXAM_SYNC_SUPPORTED_KINDS);

// ── 拒否理由（enum のみ / E-S12・E-S13）──────────────────────────────
//
// ★ 拒否理由に **入力そのものを載せない** ★
//   未知 kind 名や壊れた token をそのまま持つと、任意の client 文字列が
//   観測経路へ流れ込む（E-S13）。理由は closed enum、kind は既知 kind のときだけ持つ。

export type ExamSyncSignalRejectionReason =
  /** 文字列ではない / 空 / 空白のみ。 */
  | 'not_a_string'
  | 'empty'
  /** 上限超過（長さ / claim 数）。 */
  | 'oversize'
  | 'too_many_claims'
  /** version 区切りが無い / 未知 version。 */
  | 'missing_version'
  | 'unknown_version'
  /** entry の形が `kind=value` ではない。 */
  | 'malformed_entry'
  /** ExamSourceKind ですらない（`__proto__` 等を含む）。 */
  | 'unknown_kind'
  /** 既知 kind だが Source-Sync 対象ではない（E-S3 の class 2）。 */
  | 'not_syncable_kind'
  /** 64 hex ではない / 空 / 余分な文字。 */
  | 'invalid_fingerprint'
  /** 同一 kind が 2 回以上申告された。 */
  | 'duplicate_kind';

export type ExamSyncSignalRejection = {
  readonly reason: ExamSyncSignalRejectionReason;
  /** **既知 kind のときだけ**持つ。未知 kind 名は載せない（PII / 任意文字列の混入防止）。 */
  readonly kind?: ExamSourceKind;
};

// ── parse 結果 ────────────────────────────────────────────────────────

export type ExamSyncSignal = {
  /** 受理できた場合のみ `EXAM_SYNC_SIGNAL_VERSION`。拒否時は空文字。 */
  readonly version: string;
  /** kind → fingerprint（`efp1:<64hex>` 形式へ復元済み）。 */
  readonly claims: Readonly<Partial<Record<ExamSyncSupportedKind, ExamFingerprint>>>;
  /** 落とした理由（enum のみ）。空でも「全部受理」を意味しない（claims を見ること）。 */
  readonly rejections: readonly ExamSyncSignalRejection[];
};

function rejectedSignal(
  ...rejections: readonly ExamSyncSignalRejection[]
): ExamSyncSignal {
  return { version: '', claims: {}, rejections };
}

/** 何も申告されていない signal（= 全 kind unclaimed）。 */
export const EMPTY_EXAM_SYNC_SIGNAL: ExamSyncSignal = {
  version: '',
  claims: {},
  rejections: [],
};

// ── serialize ─────────────────────────────────────────────────────────

/**
 * claim map → wire 文字列（純関数・deterministic）。
 *
 * ★ 出力順は入力順ではなく `EXAM_SYNC_SUPPORTED_KINDS` の宣言順に固定する ★
 *   同じ意味の claim 集合は **必ず同じ byte 列**になる。入力 object の key 順で
 *   wire が揺れると、同一内容の request が別の文字列として観測される。
 *
 * 不正な fingerprint（形式違い / 別 schema）は **serialize しない**。
 * 送れないものを送らないのが送信側の fail-closed であり、
 * 受信側に判定を丸投げしない。
 */
export function serializeExamSyncSignal(
  claims: Readonly<Partial<Record<ExamSyncSupportedKind, ExamFingerprint | null | undefined>>>,
): string {
  const parts: string[] = [];
  for (const kind of EXAM_SYNC_SUPPORTED_KINDS) {
    const value = claims[kind];
    if (!isExamFingerprint(value)) continue;
    const prefix = `${EXAM_SYNC_SIGNAL_FINGERPRINT_VERSION}:`;
    if (!value.startsWith(prefix)) continue;
    const hex = value.slice(prefix.length);
    if (!HEX64.test(hex)) continue;
    parts.push(`${kind}=${hex}`);
  }
  if (parts.length === 0) return '';
  return `${EXAM_SYNC_SIGNAL_VERSION}:${parts.join(',')}`;
}

// ── parse ─────────────────────────────────────────────────────────────

/**
 * wire 文字列 → 検証済み signal（**never-throw / default deny**）。
 *
 * ★ 「分からないけど既知部分だけ使う」をしない ★
 *   判断の分かれ目は **shape が壊れているか / 語彙が受理できないか**である。
 *
 *   全体を捨てる（= 全 kind unclaimed）— signal そのものが well-formed でない:
 *     文字列でない / 空 / 空白のみ / 長さ超過 / version 区切り無し / 未知 version /
 *     entry 数超過 /
 *     **shape の壊れた entry**（`=` が無い / kind が空 / 値が空 / 余分な区切り）
 *       → truncated signal・malformed escaping はここに落ちる。途中で切れた送信の
 *         「生き残った前半」を claim として採用してはいけない。
 *
 *   その kind だけ捨てる — entry は well-formed だが受理できない:
 *     未知 kind（前方互換のため signal 全体は殺さない）/ class 2 kind（E-S3）/
 *     不正 fingerprint / 重複 kind
 *     → いずれもその kind が verified になる経路は無い。
 *
 * ★ 重複 kind は first-wins も last-wins もしない ★
 *   どちらを採っても「client が 2 つの主張を出したのに 1 つを勝たせた」ことになる。
 *   Canon に明示が無いため fail-closed とし、**その kind を丸ごと落とす**
 *   （既に受理していた分も取り消す）。
 *
 * ★ prototype pollution 対策 ★
 *   accumulator を `Object.create(null)` で作り、代入前に allowlist（Set）で kind を
 *   絞る。`__proto__` / `constructor` / `prototype` は allowlist を通らない。
 */
export function parseExamSyncSignal(raw: unknown): ExamSyncSignal {
  if (typeof raw !== 'string') return rejectedSignal({ reason: 'not_a_string' });
  if (raw.length > EXAM_SYNC_SIGNAL_MAX_LENGTH) return rejectedSignal({ reason: 'oversize' });

  const trimmed = raw.trim();
  if (trimmed === '') return rejectedSignal({ reason: 'empty' });

  const sep = trimmed.indexOf(':');
  if (sep <= 0) return rejectedSignal({ reason: 'missing_version' });

  const version = trimmed.slice(0, sep);
  // 未知 version は互換を仮定しない。古い client の hex を新 schema として誤解釈しない。
  if (version !== EXAM_SYNC_SIGNAL_VERSION) return rejectedSignal({ reason: 'unknown_version' });

  const body = trimmed.slice(sep + 1);
  if (body === '') return rejectedSignal({ reason: 'empty' });

  const entries = body.split(',');
  if (entries.length > EXAM_SYNC_SIGNAL_MAX_CLAIMS) {
    return rejectedSignal({ reason: 'too_many_claims' });
  }

  // ★ 先に shape だけを検査し、1 つでも壊れていれば signal 全体を捨てる ★
  //   （truncated / malformed escaping の「前半だけ採用」を構造的に塞ぐ）
  for (const entry of entries) {
    const eq = entry.indexOf('=');
    if (eq <= 0 || eq === entry.length - 1) return rejectedSignal({ reason: 'malformed_entry' });
  }

  const accepted = Object.create(null) as Record<string, ExamFingerprint>;
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  const rejections: ExamSyncSignalRejection[] = [];

  for (const entry of entries) {
    const eq = entry.indexOf('=');
    const kind = entry.slice(0, eq);
    const hex = entry.slice(eq + 1);

    if (!isExamSourceKind(kind)) {
      // ★ 未知 kind 名を rejection に載せない（任意 client 文字列の混入経路にしない）
      rejections.push({ reason: 'unknown_kind' });
      continue;
    }
    if (!CLAIM_KINDS.has(kind)) {
      rejections.push({ reason: 'not_syncable_kind', kind });
      continue;
    }
    if (seen.has(kind)) {
      if (!duplicated.has(kind)) {
        duplicated.add(kind);
        rejections.push({ reason: 'duplicate_kind', kind });
      }
      continue;
    }
    seen.add(kind);

    if (!HEX64.test(hex)) {
      rejections.push({ reason: 'invalid_fingerprint', kind });
      continue;
    }
    const fingerprint = `${EXAM_SYNC_SIGNAL_FINGERPRINT_VERSION}:${hex}`;
    if (!isExamFingerprint(fingerprint)) {
      rejections.push({ reason: 'invalid_fingerprint', kind });
      continue;
    }
    accepted[kind] = fingerprint;
  }

  // 重複が出た kind は、先に受理していた分も取り消す（first-wins にしない）。
  const claims: Partial<Record<ExamSyncSupportedKind, ExamFingerprint>> = {};
  for (const kind of EXAM_SYNC_SUPPORTED_KINDS) {
    if (duplicated.has(kind)) continue;
    const value = accepted[kind];
    if (value !== undefined) claims[kind] = value;
  }

  return { version: EXAM_SYNC_SIGNAL_VERSION, claims, rejections };
}

/** その kind の claim が受理されているか（純関数）。 */
export function claimedFingerprint(
  signal: ExamSyncSignal,
  kind: ExamSyncSupportedKind,
): ExamFingerprint | null {
  const value = signal.claims[kind];
  return isExamFingerprint(value) ? value : null;
}

/** signal version と fingerprint version の対応が保たれているか（QA / 起動時の自己検査用）。 */
export function isExamSyncSignalSchemaConsistent(): boolean {
  return EXAM_SYNC_SIGNAL_FINGERPRINT_VERSION === EXAM_FINGERPRINT_VERSION;
}
