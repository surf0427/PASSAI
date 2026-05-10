// 合格レベルとの差分（実在の合格者データではなく、固定の「合格ライン目安」との比較）

export type EvaluationItem = {
  id: string;
  label: string;
  score: number;
  maxScore: 20;
};

export type PassLineItem = {
  id: string;
  label: string;
  targetScore: number;
};

export type ComparisonStatus = 'achieved' | 'almost' | 'needsImprovement';

export type ComparisonResult = {
  id: string;
  label: string;
  currentScore: number;
  targetScore: number;
  diff: number;
  status: ComparisonStatus;
  comment: string;
};

export const PASS_LINE_TARGETS: PassLineItem[] = [
  { id: 'logic',         label: '論理構造',     targetScore: 16 },
  { id: 'specificity',   label: '具体性',       targetScore: 16 },
  { id: 'universityFit', label: '大学との一致', targetScore: 17 },
  { id: 'futureGoal',    label: '将来目標',     targetScore: 15 },
  { id: 'originality',   label: '独自性',       targetScore: 15 },
];

// 総合スコアの合格ライン目安（軸別合計とは独立。ユーザー定義の到達目安）
export const PASS_LINE_TOTAL = 75;

export const PASS_LINE_COMMENTS: Record<string, string> = {
  logic:
    '文章の流れはある程度整っています。各段落の役割をさらに明確にすると伸びる可能性があります。',
  specificity:
    '具体的な経験・時期・行動が不足しています。自分だけが語れるエピソードを追加しましょう。',
  universityFit:
    '大学・学部で学びたい内容との接続が弱いです。授業名・プログラム名・研究テーマなどを調べて入れましょう。',
  futureGoal:
    '将来やりたいことは見えますが、分野・職業・社会課題まで具体化すると強くなります。',
  originality:
    '他の受験生にも言える内容になりやすいです。自分の経験や価値観を入れて差別化しましょう。',
};

function statusFromRawDiff(rawDiff: number): ComparisonStatus {
  if (rawDiff <= 0) return 'achieved';
  if (rawDiff <= 3) return 'almost';
  return 'needsImprovement';
}

export function getPassLineComparison(
  currentItems: EvaluationItem[],
): ComparisonResult[] {
  const targetMap = new Map(PASS_LINE_TARGETS.map((t) => [t.id, t]));
  return currentItems.map((item) => {
    const target = targetMap.get(item.id);
    const targetScore = target?.targetScore ?? 0;
    const rawDiff = targetScore - item.score;
    return {
      id: item.id,
      label: item.label,
      currentScore: item.score,
      targetScore,
      diff: Math.max(0, rawDiff),
      status: statusFromRawDiff(rawDiff),
      comment: PASS_LINE_COMMENTS[item.id] ?? '',
    };
  });
}

export function getTotalDiff(currentTotal: number): number {
  return Math.max(0, PASS_LINE_TOTAL - currentTotal);
}

export function getTopImprovementTargets(
  results: ComparisonResult[],
  limit = 2,
): ComparisonResult[] {
  return [...results]
    .filter((r) => r.diff > 0)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, limit);
}
