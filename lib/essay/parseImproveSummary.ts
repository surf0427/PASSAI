// /api/essay-improve-summary の AI 出力 JSON parser / 正規化層（essay STEP F 新規）。
//
// 役割:
//   anthropic.messages.create() 後の JSON.parse 結果（unknown）を defensive に検査して
//   ImprovementSummary shape に正規化する純粋関数。失敗時は安全な fallback で埋める。
//
// AI 出力契約:
//   - summary: string（改善方針の全体像）
//   - focusPoints: string[]（強化すべきポイント、3 件まで）
//   - suggestedDirections: string[]（書き直し方向性、3 件まで）
//
// 防御ポイント:
//   - summary が空文字 / 非 string → FALLBACK_SUMMARY
//   - focusPoints / suggestedDirections は非空 string のみ採用、上限 3 件
//   - 余計な field は無視（拡張性のため）

import type { ImprovementSummary } from '@/types/essay';

// STEP-SILENT-FALLBACK-01: AI 出力か fallback テンプレかを判別するメタ field。
// 既存 ImprovementSummary 型に optional field として追加するため、本ファイル内で source を
// merge した戻り値を返す（type 拡張は types/essay.ts 側で同 STEP に追加済み）。

const FALLBACK_SUMMARY =
  '改善方針が読み取れませんでした。もう一度「改善まとめを作成」を実行してください。';

const FALLBACK_FOCUS_POINTS: string[] = [
  '回答した深掘り質問の内容を本文に反映する',
];

const FALLBACK_SUGGESTED_DIRECTIONS: string[] = [
  '改善点に対応する箇所を 1〜2 文書き換える',
];

function safeStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((s) => s.trim())
    .slice(0, max);
}

export function safeParseImproveSummary(data: unknown): ImprovementSummary {
  if (typeof data !== 'object' || data === null) {
    console.warn('[fallback]', {
      route: 'api/essay-improve-summary',
      reason: 'data_not_object',
      timestamp: new Date().toISOString(),
    });
    return {
      summary: FALLBACK_SUMMARY,
      focusPoints: FALLBACK_FOCUS_POINTS,
      suggestedDirections: FALLBACK_SUGGESTED_DIRECTIONS,
      source: 'fallback',
      parseError: true,
      fallbackReason: 'data_not_object',
    };
  }
  const d = data as Record<string, unknown>;

  const rawSummary = d.summary;
  const summary =
    typeof rawSummary === 'string' && rawSummary.trim().length > 0
      ? rawSummary.trim()
      : FALLBACK_SUMMARY;

  const focusPoints = safeStringArray(d.focusPoints, 3);
  const suggestedDirections = safeStringArray(d.suggestedDirections, 3);

  const fallbackFields: string[] = [];
  if (summary === FALLBACK_SUMMARY) fallbackFields.push('summary');
  if (focusPoints.length === 0) fallbackFields.push('focusPoints');
  if (suggestedDirections.length === 0) fallbackFields.push('suggestedDirections');
  const source = fallbackFields.length === 0 ? 'ai' : 'partial';
  if (source === 'partial') {
    console.warn('[fallback]', {
      route: 'api/essay-improve-summary',
      reason: 'partial_fallback',
      fields: fallbackFields,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    summary,
    focusPoints: focusPoints.length > 0 ? focusPoints : FALLBACK_FOCUS_POINTS,
    suggestedDirections:
      suggestedDirections.length > 0
        ? suggestedDirections
        : FALLBACK_SUGGESTED_DIRECTIONS,
    source,
    parseError: false,
    ...(source === 'partial' && { fallbackReason: fallbackFields.join(',') }),
  };
}
