// dev-only helper for manual calibration of COST-1 の固定 token 平均値。
//
// 役割:
//   devtools console から `ai usage` log で観測した samples 配列を手動で渡し、
//   単純平均を返すだけの trivial helper。outlier 除外は呼び出し側の人間判断で
//   行う想定（samples を渡す前に手で外す）。
//
// 設計上 **持たないもの**:
//   - log parsing
//   - file read
//   - network fetch
//   - persistence
//   - production runtime での自動上書き
//   - calibration の自動化
//
//   trivial に保つことで、calibration を "人間の運用作業" として明示する。
//
// 用途:
//   COST-1 の AVG_INPUT_TOKENS_PER_CALL / AVG_OUTPUT_TOKENS_PER_CALL を見直すとき、
//   docs/principles/validation_cost_calibration.md の手順に従って観測した
//   token 値の配列をこの関数に渡して新 AVG の候補値を得る。

export function estimateAverageTokens(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sum = samples.reduce((acc, n) => acc + n, 0);
  return Math.round(sum / samples.length);
}
