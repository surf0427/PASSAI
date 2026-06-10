// /api/essay-themes の AI 出力を EssayThemeCandidate[] に正規化する defensive parser。
//
// 役割:
//   AI が返す { themes: [{ theme, category }] } を検証し、UI が決定論版テンプレと
//   同じ shape（EssayThemeCandidate）で扱える形に整える。
//   - theme: 空文字・非文字列を除去、trim
//   - category: EssayThemeType の妥当値のみ採用。不正値は DEFAULT_CATEGORY に矯正
//   - sourceType / reason: route が渡す決定論文脈（admission_policy or fallback）を一律付与
//   - 同一バッチ内の重複（正規化後一致）は除去
//
// 乱数・localStorage・fetch なし。純関数。

import {
  ALL_ESSAY_THEME_TYPES,
  type EssayThemeCandidate,
  type EssayThemeSourceType,
  type EssayThemeType,
} from '@/lib/essayThemes';

const VALID_TYPES = new Set<string>(ALL_ESSAY_THEME_TYPES);
const DEFAULT_CATEGORY: EssayThemeType = 'social_issue';

function normalizeKey(theme: string): string {
  return theme.replace(/\s+/g, '').trim();
}

function coerceCategory(value: unknown): EssayThemeType {
  if (typeof value === 'string' && VALID_TYPES.has(value)) {
    return value as EssayThemeType;
  }
  return DEFAULT_CATEGORY;
}

export type ParseEssayThemesContext = {
  sourceType: EssayThemeSourceType;
  reason: string;
};

export function parseEssayThemes(
  raw: unknown,
  ctx: ParseEssayThemesContext,
): EssayThemeCandidate[] {
  const themesRaw =
    raw && typeof raw === 'object' && Array.isArray((raw as { themes?: unknown }).themes)
      ? ((raw as { themes: unknown[] }).themes)
      : [];

  const out: EssayThemeCandidate[] = [];
  const seen = new Set<string>();

  for (const item of themesRaw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as { theme?: unknown; category?: unknown };
    if (typeof obj.theme !== 'string') continue;
    const theme = obj.theme.trim();
    if (theme === '') continue;
    const key = normalizeKey(theme);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      theme,
      themeType: coerceCategory(obj.category),
      sourceType: ctx.sourceType,
      reason: ctx.reason,
    });
  }

  return out;
}
