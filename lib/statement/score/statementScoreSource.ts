// STEP 33: /statement 系ページが localStorage を直接読まずに済むよう、
// 「保存済み正規化スコア」を返す単一の読み出し口をここに集約する。
//
// 方針：
//   - 表示側はこの関数の戻り値だけを使い、ページ単位で再計算しない
//   - StatementResult（label ベース）→ StatementScoreResult（breakdown ベース）の
//     変換は statementResultToScore に集約済み（内部で normalizeStatementScore を呼ぶ）
//   - 保存前 normalize は app/statement/edit/page.tsx の mapApiResponse で実行済み

import { loadReviewHistory } from '@/lib/statement/review/statementStorage';
import {
  statementResultToScore,
  type StatementScoreBreakdown,
  type StatementScoreResult,
} from '@/lib/statement/score/statementScore';
import type { EvaluationItem as PassLineEvaluationItem } from '@/lib/passLineComparison';
import type { EvaluationItem as RankEvaluationItem } from '@/lib/scoreRank';

const AXIS_LABELS: Record<keyof StatementScoreBreakdown, string> = {
  logic:         '論理構造',
  specificity:   '具体性',
  universityFit: '大学との一致',
  futureGoal:    '将来目標',
  originality:   '独自性',
};

// 直近の添削履歴を読み出して、正規化済みスコアとして返す。
// 履歴がない場合は null。各ページはこれを「表示するだけ」。
export function getLatestStatementScore(): StatementScoreResult | null {
  const history = loadReviewHistory();
  const latest = history[0];
  if (!latest) return null;
  return statementResultToScore(latest.result);
}

// 合格ライン比較・改善提案系（passLineComparison / improvementSuggestions）の入力形式へ。
export function breakdownToPassLineItems(
  breakdown: StatementScoreBreakdown,
): PassLineEvaluationItem[] {
  return [
    { id: 'logic',         label: AXIS_LABELS.logic,         score: breakdown.logic,         maxScore: 20 },
    { id: 'specificity',   label: AXIS_LABELS.specificity,   score: breakdown.specificity,   maxScore: 20 },
    { id: 'universityFit', label: AXIS_LABELS.universityFit, score: breakdown.universityFit, maxScore: 20 },
    { id: 'futureGoal',    label: AXIS_LABELS.futureGoal,    score: breakdown.futureGoal,    maxScore: 20 },
    { id: 'originality',   label: AXIS_LABELS.originality,   score: breakdown.originality,   maxScore: 20 },
  ];
}

// 改善優先度（scoreRank.getImprovementPriority）の入力形式へ。id ではなく key を持つ点だけ違う。
export function breakdownToRankItems(
  breakdown: StatementScoreBreakdown,
): RankEvaluationItem[] {
  return [
    { key: 'logic',         label: AXIS_LABELS.logic,         score: breakdown.logic },
    { key: 'specificity',   label: AXIS_LABELS.specificity,   score: breakdown.specificity },
    { key: 'universityFit', label: AXIS_LABELS.universityFit, score: breakdown.universityFit },
    { key: 'futureGoal',    label: AXIS_LABELS.futureGoal,    score: breakdown.futureGoal },
    { key: 'originality',   label: AXIS_LABELS.originality,   score: breakdown.originality },
  ];
}
