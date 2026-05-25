// 「今回直すこと」表示用の derive helper（STEP-WORK-4 で page から切り出し）。
//
// 設計方針:
//   - pure function。localStorage は触らない（呼び出し側で loadRewriteMemo して
//     workAnswers を渡す）。これにより SSR / test で簡単に評価できる。
//   - rewrite/[id] と edit 側で表示順を一致させるため、内部で同じ
//     getImprovementSuggestions(items, 3) を使う。
//   - 空文字 / 空 axis を drop して「render すべきもの」だけを返す。
//   - AI summary や snapshot は作らない。
//
// 入力: ReviewHistoryItem + workAnswers（localStorage 由来でも可 / undefined 可）
// 出力: render-ready の section[]（空ならカード非表示 / 空状態 hint に分岐）

import type { ReviewHistoryItem } from '@/lib/statement/review/statementStorage';
import {
  getImprovementSuggestions,
  getImprovementWorkKey,
} from '@/lib/improvementSuggestions';
import { statementResultToScore } from '@/lib/statement/score/statementScore';
import { breakdownToPassLineItems } from '@/lib/statement/score/statementScoreSource';
import { getRewriteWorkQuestions } from './rewriteWorkQuestions';
import type { RewriteMemoWorkAnswers } from './rewriteMemoStorage';

export type RewriteWorkSectionItem = {
  key: string;
  label: string;
  answer: string;
};

export type RewriteWorkSection = {
  axisKey: string;
  label: string;
  filled: RewriteWorkSectionItem[];
};

export function deriveRewriteWorkSections(
  entry: ReviewHistoryItem,
  workAnswers: RewriteMemoWorkAnswers | undefined,
): RewriteWorkSection[] {
  if (!workAnswers) return [];
  const score = statementResultToScore(entry.result);
  const items = breakdownToPassLineItems(score.breakdown);
  const suggestions = getImprovementSuggestions(items, 3);
  return suggestions.flatMap((s) => {
    const axisKey = getImprovementWorkKey(s);
    const axisAnswers = workAnswers[axisKey];
    if (!axisAnswers) return [];
    const questions = getRewriteWorkQuestions(axisKey);
    const filled = questions.flatMap((q) => {
      const a = axisAnswers[q.key]?.trim() ?? '';
      return a.length > 0 ? [{ key: q.key, label: q.label, answer: a }] : [];
    });
    if (filled.length === 0) return [];
    return [{ axisKey, label: s.label, filled }];
  });
}

// 「workAnswers に trim 後 1 文字以上の回答が 1 つでもあるか」だけを判定する軽量 helper。
// RewriteContextCard で「書き直し準備を編集する」link を出すかどうかの判定に使う。
// derive 結果と独立に呼べるよう、suggestions の再計算を介さないシンプル実装にしている。
export function hasAnyWorkAnswer(
  workAnswers: RewriteMemoWorkAnswers | undefined,
): boolean {
  if (!workAnswers) return false;
  for (const axis of Object.values(workAnswers)) {
    if (!axis) continue;
    for (const v of Object.values(axis)) {
      if (typeof v === 'string' && v.trim().length > 0) return true;
    }
  }
  return false;
}
