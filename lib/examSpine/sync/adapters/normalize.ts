// PASSAI 受験版 Exam Spine — Stage 4 Wave 2 / adapter 共通 normalization。
//
// 目的:
//   device canonical（localStorage）と server mirror（Supabase / PostgREST）という
//   **表現の異なる 2 経路**が、同じ内容に対して同じ fingerprint を出せるようにする。
//   generic core（Wave 1）は source を知らないため、この差の吸収は adapter の責務である。
//
// ★ generic core を JSON 化して誤魔化さない ★
//   Wave 1 の `examFingerprint` は `{ a: undefined } !== {}` を保つ（変更禁止）。
//   その区別が **source 側に存在しない**（JSON にも jsonb にも undefined は無い）ため、
//   ここで「canonical input representation」を定義して両側を同じ形へ寄せる。
//
// 吸収する差（すべて実コード / schema 由来。推測で足さない）:
//   1. undefined              … JSON.stringify / jsonb が落とす → object property を落とす
//   2. 配列内の undefined     … JSON.stringify が null にする   → null にする
//   3. NaN / ±Infinity        … JSON.stringify が null にする   → null にする
//   4. timestamptz の表記揺れ … client は `2026-08-26T09:12:33.123Z`、
//                               PostgREST は `2026-08-26T09:12:33.123+00:00` を返す
//                               → offset を持つ ISO 文字列だけを instant へ正規化する
//
// 吸収 **しない** 差（意図的）:
//   - jsonb 内の文字列は Postgres が verbatim で往復するため触らない。
//     ここを deep scan すると、学生が入力した `2026-07-02T09:00` のような
//     **ユーザー入力文字列**まで書き換えることになる。正規化は「timestamptz column」という
//     宣言済みの位置にだけ適用する（serverViews.ts / registry.ts）。
//   - offset を持たない日時（`timestamp without time zone` 相当）は **UTC と仮定しない**。
//     文字列のまま残すので、片側だけ offset を持つ場合は必ず不一致になる（fail-closed）。
//
// 非依存: I/O / clock / random / logging / network / DB。

import { examFingerprint, EXAM_FINGERPRINT_MAX_DEPTH } from '../fingerprint';
import type { ExamFingerprint } from '../fingerprint';
import { revisionFromTimestampText } from '../revision';

/** normalization 規則を変えたら上げる。旧 client の claim は不一致 → veto に倒れる。 */
export const EXAM_SYNC_NORMALIZE_VERSION = 'snv1';

/**
 * 正規化済み instant。
 * 生の epoch 数値にすると「ただの number」と衝突するため、tag 付き object にする。
 */
export type ExamSyncTimestamp = {
  readonly __examTs: typeof EXAM_SYNC_NORMALIZE_VERSION;
  readonly s: number;
  readonly n: number;
};

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === null || proto === Object.prototype;
}

/**
 * JSON 往復と等価な形へ落とす（深さ優先・純関数）。
 *
 * ★ 表現できない値（Date / Map / Set / class instance / function / symbol）は
 *   **そのまま通す**。`examFingerprint` が fail-closed で throw するので、
 *   ここで黙って落とすより安全側になる（落とすと差分が消える）。
 */
export function normalizeSyncJson(value: unknown, depth = 0): unknown {
  if (depth > EXAM_FINGERPRINT_MAX_DEPTH) return value;

  if (typeof value === 'number' && !Number.isFinite(value)) return null;

  if (Array.isArray(value)) {
    // JSON.stringify は配列内の undefined を null にする。順序は保持する（semantic）。
    return value.map((item) => (item === undefined ? null : normalizeSyncJson(item, depth + 1)));
  }

  if (typeof value === 'object' && value !== null && isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // undefined property は JSON にも jsonb にも存在しない。欠損と同一視する。
      if (item === undefined) continue;
      out[key] = normalizeSyncJson(item, depth + 1);
    }
    return out;
  }

  return value;
}

/**
 * timestamptz column 由来の文字列を instant へ正規化する。
 *
 * - offset を持つ ISO 8601 だけを `ExamSyncTimestamp` にする
 * - offset を持たない日時 / 日時でない文字列 / null は **そのまま返す**
 *   （zone を推測して UTC 化しない。Wave 1 の zone_unknown と同じ姿勢）
 */
export function normalizeSyncTimestamp(value: string | null | undefined): unknown {
  if (typeof value !== 'string') return null;
  const parsed = revisionFromTimestampText(value);
  if (parsed.form !== 'timestamp' || !parsed.offsetKnown) return value;
  return {
    __examTs: EXAM_SYNC_NORMALIZE_VERSION,
    s: parsed.epochSeconds,
    n: parsed.nanos,
  } satisfies ExamSyncTimestamp;
}

/**
 * multiset（順序が往復しない集合）を決定的な順序へ正規化する。
 *
 * ★ 使ってよいのは「順序が source 側で往復しないことをコードで証明できた kind」だけ ★
 *   generic 層（Wave 1）は array order を semantic として保持する。ここで sort してよいのは、
 *   server の順序が `ORDER BY created_at DESC, id DESC`（id は **DB 生成 uuid**）で決まり、
 *   device 側にはその id が存在しない、という **構造的な再現不能性**が示せる場合に限る。
 *   「DB の返却順が不安定だから」は理由にならない。
 *
 * key は item 自身の fingerprint。id 列に依存しないので、device 側が DB uuid を
 * 持たなくても同じ順序を再現できる。
 */
export function sortSyncItems(items: readonly unknown[]): unknown[] {
  const keyed = items.map((item) => ({ item, key: examFingerprint(normalizeSyncJson(item)) }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return keyed.map((entry) => entry.item);
}

/** 正規化 → fingerprint。adapter がこの 1 本だけを通す。 */
export function syncFingerprint(view: unknown): ExamFingerprint {
  return examFingerprint(normalizeSyncJson(view));
}
