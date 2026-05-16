// STEP6.12: feature-local components の barrel export。
//   admission-matching page からの import を 1 行に集約するための optional file。
//   個別 file の path を意識しなくて済むことが利点で、副作用や enrich はしない。
//
// PR9d-1 (M2): ActivitySummary は ConfirmView 内部でしか使われない feature-internal
//   component のため barrel から除外する。誤って page から直接利用されると、
//   ConfirmView 抽出責務の境界が崩れるため、export を絞り込んで強制する。

export { MatchingCard } from './MatchingCard';
export { ConfirmView } from './ConfirmView';
export { ResultView } from './ResultView';
