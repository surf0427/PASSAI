// 「改善ポイント別ワーク」用の質問データ。
//
// 設計方針:
//   - pure data + lookup helper のみ。AI 呼ばない。
//   - axisKey は lib/improvementSuggestions.ts の ImprovementItem.id と一致する
//     （getImprovementWorkKey(suggestion) で取得した値）。
//   - 質問は「本文に入れる素材」を引き出すための短い問いに統一する
//     （長文の defense ではなく、素材として書き出してもらう）。
//   - axis が増えても fallback 質問で動作するよう、unknown axis は FALLBACK を返す。
//   - 質問 key は storage の内側 key になる。label 変更に影響されないよう短い英語識別子で固定する。

export type RewriteWorkQuestion = {
  key: string;             // workAnswers[axisKey][key] の内側 key（label 変更に弱くない）
  label: string;           // ユーザー向け質問文
  placeholder?: string;    // textarea の placeholder（書き出しの観点）
};

const QUESTIONS_BY_AXIS: Record<string, RewriteWorkQuestion[]> = {
  logic: [
    {
      key: 'claim',
      label: '一番伝えたい志望理由は何？',
      placeholder: 'できれば一文で。最終的に「これが言いたい」結論',
    },
    {
      key: 'reason',
      label: 'なぜそう思うようになった？',
      placeholder: 'きっかけになった経験・きづき',
    },
    {
      key: 'connection',
      label: 'その経験と志望理由はどうつながる？',
      placeholder: '橋渡しになる気づき・価値観の変化',
    },
  ],
  specificity: [
    {
      key: 'experience',
      label: 'どんな経験？',
      placeholder: 'いつ・どこで・誰と・何をしたか',
    },
    {
      key: 'feeling',
      label: 'その時どう感じた？',
      placeholder: '困った・嬉しい・違和感など',
    },
    {
      key: 'link',
      label: 'なぜそれが志望理由につながる？',
      placeholder: 'その経験から考え始めたこと',
    },
  ],
  universityFit: [
    {
      key: 'attraction',
      label: '何に惹かれた？',
      placeholder: 'カリキュラム名・先生・ゼミ・施設など固有名で',
    },
    {
      key: 'research',
      label: '何を調べた？',
      placeholder: 'シラバス・研究室サイト・オープンキャンパス など',
    },
    {
      key: 'reason',
      label: 'なぜここでなければならない？',
      placeholder: '他大学との違い・自分の目的との合致点',
    },
  ],
  futureGoal: [
    {
      key: 'field',
      label: 'どんな分野で関わりたい？',
      placeholder: '業界・テーマ・社会課題',
    },
    {
      key: 'role',
      label: 'その中でどんな関わり方？',
      placeholder: '職業・立場・行動レベルで',
    },
    {
      key: 'why',
      label: 'なぜそれをやりたい？',
      placeholder: '原体験・問題意識・自分の動機',
    },
  ],
  originality: [
    {
      key: 'episode',
      label: '自分にしか書けない出来事は？',
      placeholder: '小さな違和感・他人に話したことのない経験でも可',
    },
    {
      key: 'insight',
      label: 'そこで気づいたことは？',
      placeholder: '当たり前を疑った瞬間・価値観が動いた瞬間',
    },
    {
      key: 'meaning',
      label: 'その気づきは自分にとってどんな意味？',
      placeholder: 'その後の選択にどう影響した？',
    },
  ],
};

// 未知 axis の保険。改善ポイント lib に新軸が増えた場合でも UI が空にならないようにする。
const FALLBACK_QUESTIONS: RewriteWorkQuestion[] = [
  {
    key: 'observation',
    label: 'この改善ポイントについて気づいたこと',
    placeholder: '原文のどこが弱いか・何が足りないか',
  },
  {
    key: 'material',
    label: '本文に入れたい素材',
    placeholder: '具体的な経験・固有名・数字',
  },
  {
    key: 'next',
    label: '次に書き直す時に直したい点',
    placeholder: '一手目で直すこと',
  },
];

export function getRewriteWorkQuestions(axisKey: string): RewriteWorkQuestion[] {
  return QUESTIONS_BY_AXIS[axisKey] ?? FALLBACK_QUESTIONS;
}
