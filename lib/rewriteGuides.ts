// STEP4「項目別の改善実行」用ロジック。
// URL の slug → 内部の axis id → 既存の PASS_LINE_TARGETS / IMPROVEMENT_* を参照する形で
// 既存ロジックを再利用しつつ、書き直しガイド（弱点ヒント・問い・チェックリスト）を上乗せする。

import { PASS_LINE_TARGETS } from './passLineComparison';
import {
  IMPROVEMENT_COMMENTS,
  IMPROVEMENT_REASONINGS,
} from './improvementSuggestions';

// URL の slug は kebab-case、内部 axis id は camelCase
const SLUG_TO_AXIS_ID: Record<string, string> = {
  logic: 'logic',
  specificity: 'specificity',
  'university-fit': 'universityFit',
  'future-goal': 'futureGoal',
  originality: 'originality',
};

export type RewriteGuide = {
  slug: string;
  axisId: string;
  axisLabel: string;
  reasoning: string;
  improvementComment: string;
  weaknessHints: string[];
  guidingQuestions: string[];
  checklist: string[];
};

const WEAKNESS_HINTS: Record<string, string[]> = {
  logic: [
    '主張に対する根拠が後付けで書かれている',
    '段落どうしのつながりが弱い',
    '結論が段落の冒頭または末尾に置かれていない',
  ],
  specificity: [
    '「興味があります」「学びたいです」のような抽象表現が多い',
    '時期・場所・人物・行動が書かれていない',
    '体験のシーンが映像として浮かばない',
  ],
  universityFit: [
    'その大学・学部の固有要素（授業名・研究テーマ・教員・理念など）に触れていない',
    '他大学に置き換えても通用してしまう内容になっている',
    '志望動機が一般的な「学問への興味」で止まっている',
  ],
  futureGoal: [
    '将来像が「分野」止まりで具体性に欠ける',
    '関わりたい職業・社会課題・対象が書かれていない',
    '大学での学びと将来像が線でつながっていない',
  ],
  originality: [
    '誰でも書けてしまう一般論で構成されている',
    '自分自身の体験・違和感・気づきが入っていない',
    '価値観や原体験が見えてこない',
  ],
};

const GUIDING_QUESTIONS: Record<string, string[]> = {
  logic: [
    'この段落で一番伝えたい結論は、1文で何ですか？',
    'その結論を支える理由を3つ挙げるとしたら？',
    '読み手が「なぜ？」と感じそうな箇所はどこですか？',
  ],
  specificity: [
    'いつ・どこで・誰と起きた出来事ですか？',
    'そのとき具体的に何をしましたか？',
    'その経験の前後で、自分の何が変わりましたか？',
  ],
  universityFit: [
    'この大学・学部のどの授業や研究テーマに惹かれましたか？',
    'その大学について、自分は何を調べましたか？',
    '同じ分野を学べる他大学ではなく、なぜここを選びましたか？',
  ],
  futureGoal: [
    '将来、誰のどんな課題を解決したいですか？',
    '具体的にどんな場面・職業・組織で働く姿が浮かびますか？',
    'その目標と、この大学での学びはどうつながりますか？',
  ],
  originality: [
    'あなたが他の人より深く語れるテーマは何ですか？',
    'これまでの経験で、自分の価値観が変わった瞬間はありますか？',
    'ありきたりな言葉を一つも使えないとしたら、何を書きますか？',
  ],
};

const CHECKLISTS: Record<string, string[]> = {
  logic: [
    '結論が段落の冒頭か末尾に明示されている',
    '理由と根拠の対応が崩れていない',
    '段落どうしのつながりが自然である',
  ],
  specificity: [
    '時期・場所・人物・行動のいずれかが入っている',
    '抽象表現を1つ以上、具体表現に置き換えた',
    '読み手がその場面を映像として思い浮かべられる',
  ],
  universityFit: [
    'この大学・学部の固有要素（授業名・研究・教員・理念など）に触れている',
    '他大学に置き換えても通る文章になっていない',
    'なぜ「ここでなければならないか」が伝わる',
  ],
  futureGoal: [
    '将来像が「分野」より一段具体的なレベルで描かれている',
    '関わる対象（誰・何）が明示されている',
    '大学での学びと将来目標がつながっている',
  ],
  originality: [
    '自分の体験・気づき・違和感が含まれている',
    'ありきたりな表現を1つ以上、自分の言葉に置き換えた',
    '他の受験生にも書ける内容になっていない',
  ],
};

export function isValidImprovementSlug(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(SLUG_TO_AXIS_ID, slug);
}

export function getAllImprovementSlugs(): string[] {
  return Object.keys(SLUG_TO_AXIS_ID);
}

export function getRewriteGuide(slug: string): RewriteGuide | null {
  const axisId = SLUG_TO_AXIS_ID[slug];
  if (!axisId) return null;
  const target = PASS_LINE_TARGETS.find((t) => t.id === axisId);
  if (!target) return null;
  return {
    slug,
    axisId,
    axisLabel: target.label,
    reasoning: IMPROVEMENT_REASONINGS[axisId] ?? '',
    improvementComment: IMPROVEMENT_COMMENTS[axisId] ?? '',
    weaknessHints: WEAKNESS_HINTS[axisId] ?? [],
    guidingQuestions: GUIDING_QUESTIONS[axisId] ?? [],
    checklist: CHECKLISTS[axisId] ?? [],
  };
}
