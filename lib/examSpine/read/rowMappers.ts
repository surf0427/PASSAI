// Exam Spine — row mappers（Phase 2）。
//
// 位置づけ:
//   Supabase から返る **契約外になりうる値**（jsonb / PostgREST embed / null）を、
//   安全に扱える素の値へ落とす純関数だけを置く層。
//   従来 lib/contextBuilders/tutorContext.ts 内に private で重複していた shape guard を
//   ここへ集約し、Spine の全 kind reader が同じ防御を共有する。
//
// 厳守（本ファイルの不変条件）:
//   - 純関数のみ。fetch / Supabase client / localStorage / Date / Math.random なし。
//   - isomorphic。'server-only' を付けない。
//   - **feature の方針を持たない。** 具体的には次をここへ入れてはいけない:
//       feature 固有の truncate 定数（何件・何文字に切るか）
//       表示ラベル・日本語文言・section header
//       prompt へ出す/出さないの判断
//     これらは呼び出し側（feature の projection 層）の責務。
//     そのため max 系はすべて **引数で受け取る**（module 定数として持たない）。
//
// 関連:
//   lib/examSpine/read/reader.server.ts（唯一の想定 consumer）
//   docs/principles/exam_spine/EXAM_SPINE_ARCHITECTURE.md

/** plain object だけを通す。配列 / null / primitive は null に倒す。 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** string 以外は ''。string は trim して返す。 */
export function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * unknown → string[]。
 * 配列でない / string 以外の要素 / 空文字は落とす。
 *
 * @param max           採用する最大件数（呼び出し側の方針）
 * @param maxItemLength 1 要素あたりの最大文字数（呼び出し側の方針）
 *
 * ⚠️ max / maxItemLength を既定値付きにしないこと。既定値を持つと
 *    「Spine が truncate 方針を持っている」ことになり、本ファイルの不変条件に反する。
 */
export function toStringArray(
  value: unknown,
  max: number,
  maxItemLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .slice(0, max)
    .map((s) => (s.length > maxItemLength ? s.slice(0, maxItemLength) : s));
}

/** max 文字で切る。max 以下ならそのまま。 */
export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * list query の戻り（配列想定）から先頭 1 件を record として取り出す。
 * 配列でない / 空 / 先頭が object でない場合は null。
 */
export function firstRecord(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : null;
  return asRecord(row);
}

/**
 * PostgREST の embed（`table(cols)`）を record にする。
 * embed は relation の cardinality 次第で **配列でも単体でも**返りうるため、両方を受ける。
 */
export function unwrapEmbedded(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) ? asRecord(value[0]) : asRecord(value);
}
