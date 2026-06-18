// マイページ「プレゼン成長レポート」用の集計ヘルパー（純関数）。
//
// 方針:
//   - DB 変更・API 追加なし。本人の evaluated attempt（presentation_results 1 件以上）を
//     client が直読みし、ここで数値化・差分計算する純粋ロジックに切り出す。
//   - feedbackTypes.ts は ./constants（'server-only'）を transitively import するため、
//     client から import できない。よってカテゴリキー / ラベルは本ファイルに自前で定義する
//     （PresentationHistoryClient と同じ理由・同じ並び）。
//   - カテゴリ評価は weak | normal | strong の 3 値。数値化は表示のための「目安」であり
//     厳密な成績ではない（docs/presentation の設計思想に合わせ、UI 側でもその旨を示す）。

// 数値化規約（仕様）: weak = 1, normal = 2, strong = 3。
const LEVEL_SCORE: Record<string, number> = {
  weak: 1,
  normal: 2,
  strong: 3,
};

// 集計対象カテゴリ。materialConsistency は資料ありの評価のみ付与されるため任意扱い。
// 6 軸は presentation_results.categories のキー（コード上の正準キー）に一致させる。
//
// 注意: 仕様書のカテゴリ名と DB/コードの実キーは名前が異なる。対応関係は以下のとおり
// （実キー = 日本語ラベル ← 仕様書での呼称）:
//   - composition       = 構成力           ← structure
//   - persuasion        = 説得力           ← persuasiveness
//   - concreteness      = 具体性           ← specificity
//   - clarity           = わかりやすさ      ← clarity
//   - timeManagement    = 時間配分         ← timeManagement
//   - completeness      = 完成度           ← overallCompleteness
//   - materialConsistency = 資料との整合性  ← materialConsistency（資料ありのみ）
const BASE_CATEGORY_KEYS = [
  'composition',
  'persuasion',
  'concreteness',
  'clarity',
  'timeManagement',
  'completeness',
] as const;

const MATERIAL_CATEGORY_KEY = 'materialConsistency';

// 集計で参照しうる全カテゴリ（資料整合性を含む）。
const ALL_CATEGORY_KEYS = [
  ...BASE_CATEGORY_KEYS,
  MATERIAL_CATEGORY_KEY,
] as const;

// カテゴリ日本語ラベル（仕様のマッピング。コードキー → 表示名）。
export const PRESENTATION_CATEGORY_LABELS: Record<string, string> = {
  composition: '構成力',
  persuasion: '説得力',
  concreteness: '具体性',
  clarity: 'わかりやすさ',
  timeManagement: '時間配分',
  completeness: '完成度',
  materialConsistency: '資料との整合性',
};

// 集計の入力（presentation_results 1 行 ≒ evaluated attempt 1 件）。
export type PresentationGrowthEntry = {
  // 並び替え用。attempt の created_at（昇順で「初回 → 直近」を作る）。
  createdAt: string;
  // presentation_results.categories の生値（weak/normal/strong 以外も入りうるので unknown）。
  categories: Record<string, unknown>;
};

export type CategoryDelta = {
  key: string;
  label: string;
  delta: number;
};

export type CategoryScore = {
  key: string;
  label: string;
  score: number;
};

export type TrendPoint = {
  // 1 始まりの実通し番号（例: 全 6 件中の直近 3 件なら 4,5,6）。
  index: number;
  average: number;
};

export type PresentationGrowthReport = {
  // 練習回数（= evaluated attempt 件数）。
  attemptCount: number;
  // 直近 evaluated result のカテゴリ平均（生値。表示時に丸める）。
  latestAverage: number;
  // 初回 evaluated result のカテゴリ平均。
  firstAverage: number;
  // 初回 → 直近の平均差分（latestAverage - firstAverage の生値）。
  delta: number;
  // 一番伸びた項目（初回 → 直近の差分が最大のカテゴリ）。2 件未満なら null。
  mostImproved: CategoryDelta | null;
  // 次に伸ばすべき項目（直近のカテゴリで一番低いもの）。
  nextFocus: CategoryScore | null;
  // 直近 3 回の平均推移（昇順）。
  recentTrend: TrendPoint[];
};

function levelToScore(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const score = LEVEL_SCORE[value];
  return typeof score === 'number' ? score : null;
}

// 1 件分のカテゴリ平均。集計可能なカテゴリ（既知キー & 有効な level 値）のみで平均する。
// 有効カテゴリが 0 個なら null。
function entryAverage(categories: Record<string, unknown>): number | null {
  let sum = 0;
  let count = 0;
  for (const key of ALL_CATEGORY_KEYS) {
    const score = levelToScore(categories[key]);
    if (score === null) continue;
    sum += score;
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

// 1 件分の有効カテゴリスコア一覧（順序は ALL_CATEGORY_KEYS）。
function entryScores(categories: Record<string, unknown>): CategoryScore[] {
  const out: CategoryScore[] = [];
  for (const key of ALL_CATEGORY_KEYS) {
    const score = levelToScore(categories[key]);
    if (score === null) continue;
    out.push({ key, label: PRESENTATION_CATEGORY_LABELS[key] ?? key, score });
  }
  return out;
}

/**
 * evaluated entry 群から成長レポートを組み立てる。
 *   - entries は created_at 昇順に並べ替えてから集計する（呼び出し側の順序に依存しない）。
 *   - 有効な平均を持つ entry が 0 件なら null（カードは空状態を表示する）。
 */
export function buildPresentationGrowthReport(
  entries: PresentationGrowthEntry[],
): PresentationGrowthReport | null {
  // created_at 昇順。空文字は末尾に寄せず素直に文字列比較（ISO8601 前提）。
  const sorted = [...entries].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );

  // 有効な平均を持つ entry のみを集計対象にする。
  const usable = sorted
    .map((e) => ({ entry: e, average: entryAverage(e.categories) }))
    .filter((x): x is { entry: PresentationGrowthEntry; average: number } =>
      x.average !== null,
    );

  if (usable.length === 0) return null;

  const first = usable[0];
  const latest = usable[usable.length - 1];

  // 一番伸びた項目: 初回・直近 双方に存在するカテゴリの差分が最大のもの。
  let mostImproved: CategoryDelta | null = null;
  if (usable.length >= 2) {
    for (const key of ALL_CATEGORY_KEYS) {
      const firstScore = levelToScore(first.entry.categories[key]);
      const latestScore = levelToScore(latest.entry.categories[key]);
      if (firstScore === null || latestScore === null) continue;
      const delta = latestScore - firstScore;
      if (mostImproved === null || delta > mostImproved.delta) {
        mostImproved = {
          key,
          label: PRESENTATION_CATEGORY_LABELS[key] ?? key,
          delta,
        };
      }
    }
  }

  // 次に伸ばすべき項目: 直近のカテゴリのうち最低スコア（同率はどれか 1 つ）。
  let nextFocus: CategoryScore | null = null;
  for (const cs of entryScores(latest.entry.categories)) {
    if (nextFocus === null || cs.score < nextFocus.score) {
      nextFocus = cs;
    }
  }

  // 直近 3 回の推移（昇順）。index は全 usable 中の 1 始まり通し番号。
  const recentTrend: TrendPoint[] = usable
    .slice(-3)
    .map((x, i) => ({
      index: usable.length - Math.min(3, usable.length) + i + 1,
      average: x.average,
    }));

  return {
    attemptCount: usable.length,
    latestAverage: latest.average,
    firstAverage: first.average,
    delta: latest.average - first.average,
    mostImproved,
    nextFocus,
    recentTrend,
  };
}

// 平均表示用: 小数 1 桁に丸める（例: 2.4）。
export function formatAverage(value: number): string {
  return value.toFixed(1);
}

// 差分表示用: 符号つき小数 1 桁（例: +0.6 / -0.2 / ±0.0）。
export function formatDelta(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return '±0.0';
  const sign = rounded > 0 ? '+' : '-';
  return `${sign}${Math.abs(rounded).toFixed(1)}`;
}

// カテゴリ差分（整数 level 差）表示用: 符号つき整数（例: +1 / -1 / ±0）。
export function formatCategoryDelta(value: number): string {
  if (value === 0) return '±0';
  return value > 0 ? `+${value}` : `${value}`;
}
