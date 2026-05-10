export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';

export type RankDefinition = {
  rank: Rank;
  min: number;
  max: number;
  label: string;
  description: string;
  badgeBg: string;
  badgeText: string;
  badgeRing: string;
};

export const RANK_DEFINITIONS: Record<Rank, RankDefinition> = {
  S: {
    rank: 'S',
    min: 90,
    max: 100,
    label: '合格圏 上位',
    description: '完成度は非常に高く、合格圏の中でも上位に位置しています。',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-700',
    badgeRing: 'ring-amber-300',
  },
  A: {
    rank: 'A',
    min: 75,
    max: 89,
    label: '合格圏',
    description: '合格圏に到達しています。あと一押しで上位を狙えます。',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-700',
    badgeRing: 'ring-blue-300',
  },
  B: {
    rank: 'B',
    min: 60,
    max: 74,
    label: 'あと一歩',
    description: '基本は整っています。具体性と独自性で差をつけましょう。',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-700',
    badgeRing: 'ring-emerald-300',
  },
  C: {
    rank: 'C',
    min: 40,
    max: 59,
    label: '改善が必要',
    description: '主軸を見直す必要があります。',
    badgeBg: 'bg-orange-100',
    badgeText: 'text-orange-700',
    badgeRing: 'ring-orange-300',
  },
  D: {
    rank: 'D',
    min: 0,
    max: 39,
    label: '土台から再構築',
    description: 'まずは構成と志望動機の言語化から見直しましょう。',
    badgeBg: 'bg-rose-100',
    badgeText: 'text-rose-700',
    badgeRing: 'ring-rose-300',
  },
};

// 「合格圏」基準（A 以上を合格ラインとして扱う）
export const PASS_LINE_RANK: Rank = 'A';
export const PASS_LINE_SCORE = RANK_DEFINITIONS[PASS_LINE_RANK].min;

const RANK_ORDER: Rank[] = ['D', 'C', 'B', 'A', 'S'];

export function getRank(score: number): Rank {
  if (score >= RANK_DEFINITIONS.S.min) return 'S';
  if (score >= RANK_DEFINITIONS.A.min) return 'A';
  if (score >= RANK_DEFINITIONS.B.min) return 'B';
  if (score >= RANK_DEFINITIONS.C.min) return 'C';
  return 'D';
}

export function getRankDefinition(score: number): RankDefinition {
  return RANK_DEFINITIONS[getRank(score)];
}

export function getNextRank(rank: Rank): Rank | null {
  const i = RANK_ORDER.indexOf(rank);
  if (i === -1 || i === RANK_ORDER.length - 1) return null;
  return RANK_ORDER[i + 1];
}

export function getPointsToNextRank(score: number): { nextRank: Rank | null; gap: number } {
  const next = getNextRank(getRank(score));
  if (!next) return { nextRank: null, gap: 0 };
  return { nextRank: next, gap: Math.max(0, RANK_DEFINITIONS[next].min - score) };
}

export function getPointsToPassLine(score: number): number {
  return Math.max(0, PASS_LINE_SCORE - score);
}

// 各評価軸は 0〜20 点。総合点は 5 軸合計の 0〜100 点
export const EVAL_MAX_SCORE = 20;

export type EvaluationItem = {
  key: string;
  label: string;
  score: number;
};

export type ImprovementItem = {
  key: string;
  label: string;
  currentScore: number;
  potentialGain: number;
};

export function getImprovementPriority(items: EvaluationItem[]): ImprovementItem[] {
  return items
    .map((it) => ({
      key: it.key,
      label: it.label,
      currentScore: it.score,
      potentialGain: EVAL_MAX_SCORE - it.score,
    }))
    .filter((it) => it.potentialGain > 0)
    .sort((a, b) => b.potentialGain - a.potentialGain);
}
