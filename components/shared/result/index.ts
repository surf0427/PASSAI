// PASSAI shared/result — barrel export
//
// AI 結果表示で使い回す共通コンポーネント。1 ファイル import で参照可能にする。
// 新規追加（ResultCard / ScoreBar / ScoreSummary など）は同じ規約でここに足す。

export { AiThinkingState } from './AiThinkingState';
export { AiInlineThinking } from './AiInlineThinking';
export { StrengthWeaknessGrid } from './StrengthWeaknessGrid';
export { ImprovementList } from './ImprovementList';
export type { ImprovementListVariant } from './ImprovementList';
