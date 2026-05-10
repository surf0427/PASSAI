// STEP3「改善指示」用ロジック。
// STEP2 の getPassLineComparison / getTopImprovementTargets を再利用し、
// STEP3 固有の「改善方向性」「なぜ重要か」「深掘りリンク」だけを上乗せする。

import {
  getPassLineComparison,
  getTopImprovementTargets,
  type EvaluationItem,
} from './passLineComparison';

export type ImprovementItem = {
  id: string;
  label: string;
  currentScore: number;
  targetScore: number;
  diff: number;
};

export type ImprovementSuggestion = ImprovementItem & {
  comment: string;
  reasoning: string;
  route: string;
};

// 軸別の「改善の方向性」テキスト。AI接続時はここを動的差し替え可能にする。
export const IMPROVEMENT_COMMENTS: Record<string, string> = {
  logic:
    '主張と根拠の関係性をより明確にすると、説得力を強められます。各段落で「結論→理由→根拠」の順を意識すると、流れが整いやすくなります。',
  specificity:
    '経験説明が抽象的です。実際の行動・数字・感情の変化を加えると、読み手に伝わる説得力を強められます。',
  universityFit:
    'この大学でなければならない理由が弱い状態です。学部の理念・授業名・研究テーマとの接続を増やしていくと、一致度を伸ばせる可能性があります。',
  futureGoal:
    '将来やりたいことが分野レベルで止まっています。具体的な職業・社会課題・関わりたい場面まで描写すると、目的意識を伝えやすくなります。',
  originality:
    '誰でも書ける内容になりやすい状態です。あなた固有の体験・違和感・気づきを起点にすると、独自性を出していけます。',
};

// 軸別の「なぜ重要なのか」テキスト。
export const IMPROVEMENT_REASONINGS: Record<string, string> = {
  logic:
    '読み手は最初に文章全体の構造を見て判断します。論理の流れが弱いと、内容が良くても伝わりにくくなる可能性があります。',
  specificity:
    '具体性は本人らしさと本気度を伝える要素です。抽象的な理由は誰でも書ける内容に近づきやすく、差別化の難易度が上がります。',
  universityFit:
    '志望理由書の核心は「なぜこの大学か」にあります。一致度が低いと、他大学でも通用する文章とみなされやすくなります。',
  futureGoal:
    '将来目標が曖昧だと、入学後に学びを活かせる学生だと判断されにくくなる可能性があります。',
  originality:
    '読み手は1日に多数の志望理由書を読みます。独自性が薄い文章は記憶に残りにくくなる可能性があります。',
};

// 軸別の深掘り修正ページへのルート。STEP4 への入口。
export const IMPROVEMENT_ROUTES: Record<string, string> = {
  logic: '/statement/improve/logic',
  specificity: '/statement/improve/specificity',
  universityFit: '/statement/improve/university-fit',
  futureGoal: '/statement/improve/future-goal',
  originality: '/statement/improve/originality',
};

// ページ冒頭の優先順位ノート。UI 側に直書きしないため lib に集約。
export const PRIORITY_NOTE_TEXT =
  'すべてを同時に直す必要はありません。まずは差分の大きい項目から改善しましょう。';

export function getImprovementSuggestions(
  currentItems: EvaluationItem[],
  limit = 2,
): ImprovementSuggestion[] {
  const comparison = getPassLineComparison(currentItems);
  const top = getTopImprovementTargets(comparison, limit);

  return top.map((r) => ({
    id: r.id,
    label: r.label,
    currentScore: r.currentScore,
    targetScore: r.targetScore,
    diff: r.diff,
    comment: IMPROVEMENT_COMMENTS[r.id] ?? '',
    reasoning: IMPROVEMENT_REASONINGS[r.id] ?? '',
    route: IMPROVEMENT_ROUTES[r.id] ?? '/statement/improve',
  }));
}
