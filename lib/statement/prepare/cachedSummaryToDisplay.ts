// STEP9.3: 志望理由書 prepare の保存済み summary を表示用 DisplaySummary 形式に変換する
//   pure helper。handleSummarize の cache hit path と handleViewSavedSummary の 2 箇所で
//   同じ field copy をやっていた DRY 違反を 1 関数に集約。
//
// 設計判断:
//   - pure 関数。side effect / storage / fetch / hook / async は持たない。
//   - statement/prepare feature-specific（generic な cachedToDisplay は別 feature の構造が
//     違うため意図的に避ける。STEP9.1 / STEP9.2 の方針）。
//   - 入力 StatementPrepareSummary は inputSignature / updatedAt を持つが、本 helper は
//     5 表示項目のみを抜き出す（display 専用形）。
//   - DisplaySummary 型は本 file 側で ownership を持つ。view file (SummaryDisplayView.tsx)
//     からは本 file へ import に切り替える（lib が UI 層に依存しないレイヤード構造）。

import type { StatementPrepareSummary } from '@/lib/statement/prepare/statementPrepareStorage';

// 整理メモの "表示用" 形（5項目のみ）。storage 型は inputSignature / updatedAt を持つが、
// このページの state ではそれらは別管理にして表示と分ける。
export type DisplaySummary = {
  impressiveExperience: string;
  feltIssue: string;
  interestInField: string;
  universityLearning: string;
  futureApplication: string;
};

export function cachedSummaryToDisplay(cached: StatementPrepareSummary): DisplaySummary {
  return {
    impressiveExperience: cached.impressiveExperience,
    feltIssue:            cached.feltIssue,
    interestInField:      cached.interestInField,
    universityLearning:   cached.universityLearning,
    futureApplication:    cached.futureApplication,
  };
}
