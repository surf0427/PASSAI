// PreviousOutputSummary → prompt section（文章化）の共有フォーマッタ。
//
// 役割:
//   buildPreviousOutputSummary() が返す PreviousOutputSummary を、AI prompt の user message に
//   差し込む【過去に提示済みのフィードバック】section 文字列へ変換する純粋関数。
//   探索型 + 安全弁の文言（同じ指摘の繰り返しに留めない / ただし未解決の重要課題は繰り返し可）。
//
// 設計方針:
//   - pure。throw しない。AI / fetch / storage / Date / Math.random なし。
//   - 採点に使わない・既出でも未解決なら指摘可、という解釈ルールは各 feature の SYSTEM_PROMPT 側
//     QUALIFIER に置く（本 section は素材 + 探索の意図のみ載せる）。実データを system に入れない
//     ことで Anthropic prompt cache の cached prefix を壊さない。
//   - repeatedAdvice / repeatedThemes が両方空、または null/undefined のときは空文字を返す
//     （履歴 0/1 件・projection 空 → section なし＝後方互換）。
//
// 補足:
//   STEP-DIVERGENCE-02A の statement-review は statementPrompt.ts に同等の local 実装を持つ
//   （当時は単一 consumer だったため）。02B（essay-review）導入で 2 つ目の consumer が現れたため
//   本共有フォーマッタを新設した。statement 側 local 実装は本 STEP では変更しない（スコープ外）。
//
// 関連:
//   - types/divergence.ts (PreviousOutputSummary)
//   - lib/contextBuilders/divergence/buildPreviousOutputSummary.ts
//   - app/api/essay-review/route.ts (consumer)

import type { PreviousOutputSummary } from '@/types/divergence';

export function buildPreviousOutputSummarySection(
  summary: PreviousOutputSummary | null | undefined,
): string {
  if (!summary) return '';
  const repeatedAdvice = Array.isArray(summary.repeatedAdvice) ? summary.repeatedAdvice : [];
  const repeatedThemes = Array.isArray(summary.repeatedThemes) ? summary.repeatedThemes : [];
  if (repeatedAdvice.length === 0 && repeatedThemes.length === 0) return '';

  const lines: string[] = [
    '【過去に提示済みのフィードバック】',
    '',
    '以下は過去のフィードバックですでに伝えた論点です。',
    '今回は同じ指摘の繰り返しに留めず、達成度を確認したうえで、まだ触れていない論点・別の角度・次の段階の改善を優先してください。',
    'ただし未解決の重要課題は、繰り返しになっても必ず指摘して構いません。',
  ];
  if (repeatedAdvice.length > 0) {
    lines.push('', '既出の指摘・改善アクション:');
    lines.push(...repeatedAdvice.map((a) => `- ${a}`));
  }
  if (repeatedThemes.length > 0) {
    lines.push('', '既出の論点・テーマ:');
    lines.push(...repeatedThemes.map((t) => `- ${t}`));
  }
  return lines.join('\n');
}
