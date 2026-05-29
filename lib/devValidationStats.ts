// dev 中だけ validation 傾向を軽く集計するための module-local memory aggregator。
//
// 役割:
//   `logAiValidation` 経由で発火した event を NODE_ENV='development' のときだけ
//   process memory に積み上げ、`getValidationStats()` で読める形にする。
//   集計内容は (route, code) の counter のみで、user text / essay / activityData /
//   prompt / hash / 個人情報は一切保存しない。
//
// production no-op:
//   `recordValidationEvent` は NODE_ENV !== 'development' で即 return。
//   stats は module-local let なので persistence なし、process 再起動で消える。
//
// 用途:
//   dev 中に「どの route の reject が多いか」「どの warning code が頻出か」を
//   ad-hoc に `getValidationStats()` を呼んで確認する。SaaS / persistence / UI は持たない。
//
// 関連:
//   - lib/aiValidationLog.ts（本ファイルを呼び出す）
//   - docs/principles/ai_cache_observability.md（混同しないこと）

import type { AiValidationEvent } from './aiValidationLog';

export type ValidationStats = {
  totalPasses: number;
  passByRoute: Record<string, number>;
  totalRejects: number;
  rejectByRoute: Record<string, number>;
  rejectByCode: Record<string, number>;
  totalWarnings: number;
  warningByCode: Record<string, number>;
};

function emptyStats(): ValidationStats {
  return {
    totalPasses: 0,
    passByRoute: {},
    totalRejects: 0,
    rejectByRoute: {},
    rejectByCode: {},
    totalWarnings: 0,
    warningByCode: {},
  };
}

let stats: ValidationStats = emptyStats();

export function recordValidationEvent(event: AiValidationEvent): void {
  if (process.env.NODE_ENV !== 'development') return;
  if (event.type === 'validation_reject') {
    stats.totalRejects += 1;
    stats.rejectByRoute[event.route] = (stats.rejectByRoute[event.route] ?? 0) + 1;
    stats.rejectByCode[event.code] = (stats.rejectByCode[event.code] ?? 0) + 1;
    return;
  }
  if (event.type === 'structure_warning') {
    stats.totalWarnings += 1;
    for (const code of event.codes) {
      stats.warningByCode[code] = (stats.warningByCode[code] ?? 0) + 1;
    }
    return;
  }
  // validation_pass
  stats.totalPasses += 1;
  stats.passByRoute[event.route] = (stats.passByRoute[event.route] ?? 0) + 1;
}

export function getValidationStats(): ValidationStats {
  return {
    totalPasses: stats.totalPasses,
    passByRoute: { ...stats.passByRoute },
    totalRejects: stats.totalRejects,
    rejectByRoute: { ...stats.rejectByRoute },
    rejectByCode: { ...stats.rejectByCode },
    totalWarnings: stats.totalWarnings,
    warningByCode: { ...stats.warningByCode },
  };
}

export function resetValidationStats(): void {
  stats = emptyStats();
}

// ── derived metrics（RATE-1）────────────────────────────────────────
// 既存 counter から「率」を pure に導出する読み取り専用 helper。stats state を
// 一切変更しない。production でも害なし（recordValidationEvent が走らないため
// emptyStats 入力を読むだけで、戻り値は全て 0）。
// 軽い runtime health 指標であり、"真実" ではない。

export type ValidationDerivedMetrics = {
  overall: {
    rejectRate: number;
    warningRate: number;
  };
  byRoute: Record<
    string,
    {
      passCount: number;
      rejectCount: number;
      rejectRate: number;
    }
  >;
};

function safeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export function getValidationDerivedMetrics(): ValidationDerivedMetrics {
  const s = getValidationStats();

  const overall = {
    rejectRate: safeRate(s.totalRejects, s.totalRejects + s.totalPasses),
    warningRate: safeRate(s.totalWarnings, s.totalPasses),
  };

  const routes = new Set<string>([
    ...Object.keys(s.passByRoute),
    ...Object.keys(s.rejectByRoute),
  ]);

  const byRoute: ValidationDerivedMetrics['byRoute'] = {};
  for (const route of routes) {
    const passCount = s.passByRoute[route] ?? 0;
    const rejectCount = s.rejectByRoute[route] ?? 0;
    byRoute[route] = {
      passCount,
      rejectCount,
      rejectRate: safeRate(rejectCount, rejectCount + passCount),
    };
  }

  return { overall, byRoute };
}

// ── cost estimate（COST-1）─────────────────────────────────────────
// validator が AI call を未然に止めた回数から、未消費 token 量を rough に推定する。
// 真実ではなく「どのぐらい止まっているか」の感覚を掴むためのヘルパ。
// 固定平均で割り出すため精度は粗く、route 別の max_tokens / model 単価 / system prompt
// cache 状態の差異は無視している。会計用途ではない。
//
// warning は cost avoidance に含めない（AI call は通っているため）。

const AVG_INPUT_TOKENS_PER_CALL = 1800;
const AVG_OUTPUT_TOKENS_PER_CALL = 900;

export type ValidationCostEstimate = {
  estimatedAvoidedCalls: number;
  estimatedAvoidedInputTokens: number;
  estimatedAvoidedOutputTokens: number;
  estimatedAvoidedTotalTokens: number;
  byRoute: Record<string, { avoidedCalls: number }>;
};

export function getValidationCostEstimate(): ValidationCostEstimate {
  const s = getValidationStats();

  const estimatedAvoidedCalls = s.totalRejects;
  const estimatedAvoidedInputTokens = Math.round(
    estimatedAvoidedCalls * AVG_INPUT_TOKENS_PER_CALL,
  );
  const estimatedAvoidedOutputTokens = Math.round(
    estimatedAvoidedCalls * AVG_OUTPUT_TOKENS_PER_CALL,
  );
  const estimatedAvoidedTotalTokens =
    estimatedAvoidedInputTokens + estimatedAvoidedOutputTokens;

  const byRoute: ValidationCostEstimate['byRoute'] = {};
  for (const [route, count] of Object.entries(s.rejectByRoute)) {
    byRoute[route] = { avoidedCalls: count };
  }

  return {
    estimatedAvoidedCalls,
    estimatedAvoidedInputTokens,
    estimatedAvoidedOutputTokens,
    estimatedAvoidedTotalTokens,
    byRoute,
  };
}
