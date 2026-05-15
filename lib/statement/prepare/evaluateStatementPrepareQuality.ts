// STEP 28: 整理メモの「仕上がり」を簡易品質評価にまとめる。
//
// AI を呼ばず、既存のルールベース判定（STEP 14 weakPoints / STEP 27 logicGaps）を
// 受け取って 4 項目（具体性／一貫性／大学接続／将来接続）に集約するだけ。
// 同じ判定ロジックを重複させないため、判定そのものは行わず "受け取った結果を分類" する。

import type { StatementPrepareWeakPoint } from '@/lib/statement/prepare/detectStatementPrepareWeakPoints';
import type { StatementPrepareLogicGap } from '@/lib/statement/prepare/detectStatementPrepareLogicGaps';

export type StatementPrepareQualityLevel = 'good' | 'normal' | 'needsWork';

export type StatementPrepareQualityItemKey =
  | 'specificity'
  | 'consistency'
  | 'universityConnection'
  | 'futureConnection';

export type StatementPrepareQualityItem = {
  key: StatementPrepareQualityItemKey;
  label: string;
  level: StatementPrepareQualityLevel;
  message: string;
};

export type StatementPrepareQualityEvaluation = {
  overallLevel: StatementPrepareQualityLevel;
  items: StatementPrepareQualityItem[];
};

// ── 具体性 ────────────────────────────────────────────────────────
// experience / issue / interest の 3 つに弱点が出ている数で判定。
function evaluateSpecificity(
  weakPoints: ReadonlyArray<StatementPrepareWeakPoint>,
): StatementPrepareQualityItem {
  const targetKeys = new Set(['experience', 'issue', 'interest']);
  const count = weakPoints.filter((w) => targetKeys.has(w.key)).length;
  if (count >= 2) {
    return {
      key: 'specificity',
      label: '具体性',
      level: 'needsWork',
      message:
        '経験・課題・興味のいずれかで、具体性が足りない部分があります。',
    };
  }
  if (count === 1) {
    return {
      key: 'specificity',
      label: '具体性',
      level: 'normal',
      message: 'もう一段だけ具体性を加えると、材料として安定します。',
    };
  }
  return {
    key: 'specificity',
    label: '具体性',
    level: 'good',
    message: '経験・課題・興味が具体的に書けています。',
  };
}

// ── 一貫性 ────────────────────────────────────────────────────────
// logicGaps の数で判定（複数あれば needsWork）。
function evaluateConsistency(
  logicGaps: ReadonlyArray<StatementPrepareLogicGap>,
): StatementPrepareQualityItem {
  if (logicGaps.length >= 2) {
    return {
      key: 'consistency',
      label: '一貫性',
      level: 'needsWork',
      message: '複数の項目間でつながりが弱い箇所があります。',
    };
  }
  if (logicGaps.length === 1) {
    return {
      key: 'consistency',
      label: '一貫性',
      level: 'normal',
      message: '一部の項目間でつながりが弱い箇所があります。',
    };
  }
  return {
    key: 'consistency',
    label: '一貫性',
    level: 'good',
    message: '項目間の流れは大きく崩れていません。',
  };
}

// ── 大学接続 ──────────────────────────────────────────────────────
// universityLearning に弱点 or interestToUniversity に gap があれば needsWork。
function evaluateUniversityConnection(
  weakPoints: ReadonlyArray<StatementPrepareWeakPoint>,
  logicGaps: ReadonlyArray<StatementPrepareLogicGap>,
): StatementPrepareQualityItem {
  const hasWeak = weakPoints.some((w) => w.key === 'universityLearning');
  const hasGap = logicGaps.some((g) => g.key === 'interestToUniversity');
  if (hasWeak || hasGap) {
    return {
      key: 'universityConnection',
      label: '大学での学びとの接続',
      level: 'needsWork',
      message:
        '分野への興味と「大学で学びたいこと」の結びつきを確認しましょう。',
    };
  }
  return {
    key: 'universityConnection',
    label: '大学での学びとの接続',
    level: 'good',
    message: '大学で学びたいことが、興味と自然につながっています。',
  };
}

// ── 将来接続 ──────────────────────────────────────────────────────
// future に弱点 or universityToFuture に gap があれば needsWork。
function evaluateFutureConnection(
  weakPoints: ReadonlyArray<StatementPrepareWeakPoint>,
  logicGaps: ReadonlyArray<StatementPrepareLogicGap>,
): StatementPrepareQualityItem {
  const hasWeak = weakPoints.some((w) => w.key === 'future');
  const hasGap = logicGaps.some((g) => g.key === 'universityToFuture');
  if (hasWeak || hasGap) {
    return {
      key: 'futureConnection',
      label: '将来像との接続',
      level: 'needsWork',
      message:
        '「大学で学びたいこと」と将来像のつながりを確認しましょう。',
    };
  }
  return {
    key: 'futureConnection',
    label: '将来像との接続',
    level: 'good',
    message: '大学での学びと将来像が結びついています。',
  };
}

// ── メイン関数 ────────────────────────────────────────────────────
export function evaluateStatementPrepareQuality(
  weakPoints: ReadonlyArray<StatementPrepareWeakPoint>,
  logicGaps: ReadonlyArray<StatementPrepareLogicGap>,
): StatementPrepareQualityEvaluation {
  const items: StatementPrepareQualityItem[] = [
    evaluateSpecificity(weakPoints),
    evaluateConsistency(logicGaps),
    evaluateUniversityConnection(weakPoints, logicGaps),
    evaluateFutureConnection(weakPoints, logicGaps),
  ];
  const needsWorkCount = items.filter((i) => i.level === 'needsWork').length;
  const overallLevel: StatementPrepareQualityLevel =
    needsWorkCount >= 2 ? 'needsWork' : needsWorkCount === 1 ? 'normal' : 'good';
  return { overallLevel, items };
}
