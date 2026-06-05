// ThemeFrequency → prompt section（文章化）。探索型のみ・禁止型を使わない。
//
// 役割:
//   buildThemeFrequency() が返す ThemeFrequency を、AI prompt の user message に差し込む
//   【テーマの偏り（参考）】section 文字列へ変換する純粋関数。
//   overused テーマは「文脈」として見せるだけで、避けろ・抑制しろとは言わない。
//   actionable な指示は underused（薄いテーマ）に対する「本人に当てはまる場合のみ検討」の探索のみ。
//
// 設計方針:
//   - pure。throw しない。AI / fetch / storage / Date / Math.random なし。
//   - 採点に使わない・overused を否定しない・underused を強制しない、という解釈ルールは
//     SYSTEM_PROMPT 側 QUALIFIER に置く（本 section は素材 + 探索意図のみ）。実データを system に
//     入れないことで Anthropic prompt cache の cached prefix を壊さない。
//   - documentsConsidered < MIN_DOCUMENTS（偏りが有意でない）または underused 空なら空文字を返す
//     （= section なし。新規ユーザーへの noise を出さない・後方互換）。
//
// 関連: types/divergence.ts (ThemeFrequency) / buildThemeFrequency.ts

import type { ThemeFrequency } from '@/types/divergence';

// 偏りが有意になる最小 document 数。これ未満は section を出さない。
const MIN_DOCUMENTS = 3;
// 「よく出ているテーマ」に並べる最大件数。
const MAX_OVERUSED = 3;

export function buildThemeFrequencySection(
  freq: ThemeFrequency | null | undefined,
): string {
  if (!freq) return '';
  const documentsConsidered = freq.basis?.documentsConsidered ?? 0;
  if (documentsConsidered < MIN_DOCUMENTS) return '';

  const themes = Array.isArray(freq.themes) ? freq.themes : [];
  const underused = Array.isArray(freq.underused) ? freq.underused : [];
  if (underused.length === 0) return '';

  // themes は count 降順（builder 保証）。count > 0 の上位を overused として見せる。
  const overused = themes
    .filter((t) => t.count > 0)
    .slice(0, MAX_OVERUSED)
    .map((t) => t.theme);

  const lines: string[] = ['【テーマの偏り（参考）】', ''];
  if (overused.length > 0) {
    lines.push('よく出ているテーマ:');
    lines.push(...overused.map((t) => `- ${t}`));
    lines.push('');
  }
  lines.push('まだ薄いテーマ:');
  lines.push(...underused.map((t) => `- ${t}`));
  lines.push('');
  lines.push('※ 採点には利用しません。');
  lines.push('※ 本人に当てはまる場合のみ、薄いテーマも別観点として改善提案で検討してください。無理に当てはめないでください。');
  return lines.join('\n');
}
