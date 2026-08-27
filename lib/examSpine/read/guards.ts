// PASSAI 受験版 Exam Spine — Stage 3 shape guard（純関数のみ）。
//
// server から返る行は PostgREST 由来の `unknown` である。jsonb column も embedded relation も
// 形が保証されないため、**直接 type assertion して field access しない**。必ずここを通す。
//
// 禁止（E-S20 / row mapper 境界）:
//   Supabase / fetch / localStorage / server auth / Date / Date.now / Math.random /
//   prompt 文言 / 日本語見出し / feature ラベル / storage / 隠れた既定値
//
// 純関数のみ。throw しない。

/** object（配列でも null でもない）としてだけ受ける。 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 配列の先頭 object を返す。配列でない / 空 / object が 1 つも無いなら null。 */
export function firstRecord(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const rec = asRecord(item);
    if (rec) return rec;
  }
  return null;
}

/**
 * PostgREST の embedded relation を 1 object に開く。
 *
 * ★ 同じ relation でも **object / 配列 / null** のいずれでも返り得る。
 *   to-one と推論されるかは FK・select の書き方・schema の状態に依存し、
 *   将来の schema 変更で変わり得る。どの形でも throw せず、取れなければ null を返す。
 */
export function unwrapEmbedded(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return firstRecord(value);
  return asRecord(value);
}

/** string としてだけ受ける（trim しない）。 */
export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** 有限 number だけを返す（NaN / Infinity / 数値風 string は null）。 */
export function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 文字列を長さで打ち切る。
 * ★ `max` は required。既定値を持たせない（隠れた既定値は policy の混入経路になる）。
 */
export function truncateString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * string 配列として安全に読む。
 * ★ `max` / `maxItemLength` はいずれも required。
 */
export function toStringArray(
  value: unknown,
  max: number,
  maxItemLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed === '') continue;
    out.push(trimmed.length > maxItemLength ? trimmed.slice(0, maxItemLength) : trimmed);
    if (out.length >= max) break;
  }
  return out;
}

/** object 配列として安全に読む。`max` は required。 */
export function toRecordArray(value: unknown, max: number): Record<string, unknown>[] {
  return toIndexedRecordArray(value, max).map((e) => e.record);
}

/** `toIndexedRecordArray` の 1 要素。`sourceIndex` は **生配列** の index。 */
export type IndexedRecord = {
  readonly sourceIndex: number;
  readonly record: Record<string, unknown>;
};

/**
 * `toRecordArray` と同じ走査で、**生配列の何番目だったか**を併せて返す。
 *
 * ★ なぜ index が要るか（E-S53）★
 *   `toRecordArray` は「record でない要素を捨てながら詰める」正規化である。
 *   一方、同じ配列を見ている legacy consumer には「生配列の先頭 N slot だけを見る」
 *   ものがあり（tutor の `preferences`）、詰めたあとの列からは
 *   「どの生 slot が非 record に消費されたか」が復元できない。
 *   index は payload に対する **事実** であって feature の方針ではないので、
 *   read layer が報告してよい（E-S20）。捨てるか使うかは consumer の判断のまま。
 *
 * `max` は **採用する record 件数**の上限（生配列の走査長ではない）。
 * 返る配列は `sourceIndex` の昇順（生配列の順序そのもの）。
 */
export function toIndexedRecordArray(value: unknown, max: number): IndexedRecord[] {
  if (!Array.isArray(value)) return [];
  const out: IndexedRecord[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const rec = asRecord(value[i]);
    if (!rec) continue;
    out.push({ sourceIndex: i, record: rec });
    if (out.length >= max) break;
  }
  return out;
}
