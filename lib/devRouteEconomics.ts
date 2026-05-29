// Route-level aggregation of existing validation metrics.
//
// 役割:
//   `getValidationStats()` / `getValidationCostEstimate()` で既に取れている数値を
//   route 単位の 1 オブジェクトに束ねるだけの read-only view。dev console で
//   「どの route の deterministic 層が work を avoid しているか」感覚を掴むため。
//
// 設計原則:
//   - 新しい runtime instrumentation を **作らない**（既存 metrics のみ集計）
//   - pure / async なし / persistence なし / network なし / observer なし
//   - production no-op を inherit（source 側の `recordValidationEvent` が
//     dev gate されているため、production では全 route が 0 値の snapshot を返す）
//
// 境界:
//   "profitability intuition" 用の rough view。財務数値・実 billing ではない。
//   Anthropic input cache read / retry / truncated / hidden overhead / model 別単価 /
//   route 別 max_tokens 差 などは **一切反映しない**。
//   詳細は docs/principles/ai_validation_observability.md §8 参照。

import {
  getValidationCostEstimate,
  getValidationStats,
} from './devValidationStats';

export type RouteEconomics = {
  route: string;
  validations: number;
  avoidedCalls: number;
  estimatedSavedInputTokens: number;
  estimatedSavedOutputTokens: number;
};

// avoidedCalls の route 比で総 saved tokens を分配する。AVG 定数を直接
// 参照せず getValidationCostEstimate() の total から按分するため、COST-1 の AVG が
// calibration で動いても本ヘルパは自動追従する。
function distributeTokens(
  routeAvoidedCalls: number,
  totalAvoidedCalls: number,
  totalTokens: number,
): number {
  if (totalAvoidedCalls === 0) return 0;
  return Math.round((routeAvoidedCalls / totalAvoidedCalls) * totalTokens);
}

export function aggregateRouteEconomics(): RouteEconomics[] {
  const stats = getValidationStats();
  const cost = getValidationCostEstimate();

  const routes = new Set<string>([
    ...Object.keys(stats.passByRoute),
    ...Object.keys(stats.rejectByRoute),
  ]);

  const result: RouteEconomics[] = [];
  for (const route of routes) {
    const passCount = stats.passByRoute[route] ?? 0;
    const rejectCount = stats.rejectByRoute[route] ?? 0;
    const avoidedCalls = cost.byRoute[route]?.avoidedCalls ?? 0;

    result.push({
      route,
      validations: passCount + rejectCount,
      avoidedCalls,
      estimatedSavedInputTokens: distributeTokens(
        avoidedCalls,
        cost.estimatedAvoidedCalls,
        cost.estimatedAvoidedInputTokens,
      ),
      estimatedSavedOutputTokens: distributeTokens(
        avoidedCalls,
        cost.estimatedAvoidedCalls,
        cost.estimatedAvoidedOutputTokens,
      ),
    });
  }

  return result;
}
