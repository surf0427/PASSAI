// STEP 32: 志望理由書スコアの単一の正規化口。
//
// なぜ：AI レスポンスの totalScore と breakdown 合計がズレうるため、
//       かつ各ページが個別に sum を計算してしまうとページ間で表示が割れる。
// やること：
//   - normalizeStatementScore() で各項目を 0〜20 にクランプ
//   - total は必ず 5 項目の合計から導出（AI の totalScore は無視 or 参考扱い）
//   - rank は既存の lib/scoreRank.ts の getRank() に委ね、scheme を 1 つに保つ
//
// rank 体系について：spec 例は A/B/C/D の 4 段階だったが、ユーザー指定
//   「既存UIの基準がある場合は、それを確認して1か所に統一してください」に従い、
//   既存の S/A/B/C/D 5 段階（lib/scoreRank.ts）をそのまま採用する。

import { RANK_DEFINITIONS, getRank, type Rank } from '@/lib/scoreRank';

export type StatementScoreBreakdown = {
  logic: number;
  specificity: number;
  universityFit: number;
  futureGoal: number;
  originality: number;
};

export type StatementScoreResult = {
  total: number;
  breakdown: StatementScoreBreakdown;
  rank: Rank;
  comment: string;
};

const SCORE_KEYS: ReadonlyArray<keyof StatementScoreBreakdown> = [
  'logic',
  'specificity',
  'universityFit',
  'futureGoal',
  'originality',
];

const PER_ITEM_MAX = 20;

// number 以外 / NaN / 範囲外を 0〜20 に丸める。
function clampItem(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(PER_ITEM_MAX, Math.round(value)));
}

// AI レスポンスに含まれる totalScore は無視して breakdown の合計から total を作る。
// 旧データのフォールバック：breakdown を渡さず totalScore だけ来たケース（ほぼ無いが
// 想定として）でも、breakdown は全 0、total は 0 として安全に扱う。
export function normalizeStatementScore(input: {
  breakdown?: Partial<Record<keyof StatementScoreBreakdown, unknown>>;
}): StatementScoreResult {
  const src = input.breakdown ?? {};
  const breakdown: StatementScoreBreakdown = {
    logic:         clampItem(src.logic),
    specificity:   clampItem(src.specificity),
    universityFit: clampItem(src.universityFit),
    futureGoal:    clampItem(src.futureGoal),
    originality:   clampItem(src.originality),
  };
  const total = SCORE_KEYS.reduce((sum, k) => sum + breakdown[k], 0);
  const rank = getRank(total);
  return {
    total,
    breakdown,
    rank,
    comment: RANK_DEFINITIONS[rank].description,
  };
}

// label ベースの evaluations[] と overallScore しか持たない既存データから
// 新しい breakdown ベースに橋渡しするヘルパ。履歴復元・既存ページ対応用。
const LABEL_TO_KEY: Record<string, keyof StatementScoreBreakdown> = {
  論理構造:     'logic',
  具体性:       'specificity',
  大学との一致: 'universityFit',
  将来目標:     'futureGoal',
  独自性:       'originality',
};

export function statementResultToScore(result: {
  evaluations: ReadonlyArray<{ label: string; score: number }>;
}): StatementScoreResult {
  const breakdown: Partial<Record<keyof StatementScoreBreakdown, number>> = {};
  for (const ev of result.evaluations) {
    const k = LABEL_TO_KEY[ev.label];
    if (k) breakdown[k] = ev.score;
  }
  return normalizeStatementScore({ breakdown });
}
