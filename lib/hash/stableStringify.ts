// STEP-LIB-02 で lib/aiInputHash.ts から分離した内部ヘルパ。
//
// 役割:
//   AI route の input hash を計算する各 feature 別ファイル
//   （lib/hash/<feature>.ts）から共通利用される正規化関数。
//
// 正規化方針（aiInputHash 初期実装から不変。意味を変えないこと）:
//   - object key は ASCII 昇順に並べ替える（入力の field 順ゆらぎを吸収）
//   - undefined フィールドは object から除外（"無い" と "明示的 undefined" を同一視）
//   - string は trim（前後空白の差で別 hash になるのを防ぐ）
//   - array は順序を維持（順序は本質的な意味を持つ場合があるため）
//   - null は null のまま保持
// 同じ「意味の入力」を同じ文字列に正規化することで、hash 一致を再現可能にする。
//
// 注意:
//   この helper の挙動を変えると 8 feature 全ての cache key が一斉に変わる。
//   bump は最終手段で、変更前に必ず影響範囲を確認する。

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const normalized = normalize(obj[key]);
      if (normalized === undefined) continue;
      out[key] = normalized;
    }
    return out;
  }
  // function / symbol / bigint は AI 入力には現れない想定。混入時は null として畳む。
  return null;
}
