// 面接機能の facultyName（"学部 学科" 連結文字列）を
// findUniversityEntriesByUserChoices が要求する { faculty, department } 形へ
// 最小限に分解するための純関数。
//
// - 高精度な日本語パーサーは作らない（fuzzy / alias / 正規化 / DB照合は範囲外）
// - 全角スペースを半角と同等に扱い、連続スペースは1つに圧縮する
// - 「学部」を含む最初の token を faculty、「学科」を含む最初の token を department に振る
// - 該当 token が無ければ空文字を返す
//
// 詳細ルール: docs/principles/university_database_usage_guide.md 参照。

export type ParsedFacultyName = {
  faculty: string;
  department: string;
};

export function parseFacultyName(input: string): ParsedFacultyName {
  const normalized = input
    .replace(/　/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  if (normalized === '') {
    return { faculty: '', department: '' };
  }

  const tokens = normalized.split(' ');

  const faculty = tokens.find((t) => t.includes('学部')) ?? '';
  const department = tokens.find((t) => t.includes('学科')) ?? '';

  return { faculty, department };
}
