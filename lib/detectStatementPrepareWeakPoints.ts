// STEP 13: /statement/prepare の整理メモ（5項目）から、深掘りが必要そうな
// 弱点を簡易判定する。AI を呼ばないルールベース判定で、ヒント表示用。
//
// 判定基準（簡易）：
//   - 空欄                                 → high
//   - 30文字未満                           → high
//   - 60文字未満                           → medium
//   - 抽象語（頑張った／学んだ／興味がある／成長した）のみで
//     数字・固有活動などの具体語が無い      → medium

export type StatementPrepareWeakPointKey =
  | 'experience'
  | 'issue'
  | 'interest'
  | 'universityLearning'
  | 'future';

export type StatementPrepareWeakPointSeverity = 'low' | 'medium' | 'high';

export type StatementPrepareWeakPoint = {
  key: StatementPrepareWeakPointKey;
  label: string;
  reason: string;
  severity: StatementPrepareWeakPointSeverity;
};

// 入力は 5 項目のみで充分。storage 型からの依存は避け、構造的に受け取る。
// → DisplaySummary / StatementPrepareSummary どちらからも assignable。
export type StatementPrepareWeakPointInput = {
  impressiveExperience: string;
  feltIssue: string;
  interestInField: string;
  universityLearning: string;
  futureApplication: string;
};

const FIELDS: ReadonlyArray<{
  key: StatementPrepareWeakPointKey;
  label: string;
  pick: (s: StatementPrepareWeakPointInput) => string;
}> = [
  { key: 'experience',         label: '印象に残った経験',                  pick: (s) => s.impressiveExperience },
  { key: 'issue',              label: 'その経験から感じたこと・問題意識',  pick: (s) => s.feltIssue },
  { key: 'interest',           label: 'なぜその分野・学部に興味を持ったか', pick: (s) => s.interestInField },
  { key: 'universityLearning', label: '大学で深めたいこと',                pick: (s) => s.universityLearning },
  { key: 'future',             label: '将来どう活かしたいか',              pick: (s) => s.futureApplication },
];

const ABSTRACT_PHRASES: ReadonlyArray<string> = [
  '頑張った',
  '頑張りました',
  '学んだ',
  '学びました',
  '興味がある',
  '興味を持った',
  '成長した',
  '成長できた',
];

// 抽象語が中心でも、数字や具体的な活動名が併記されていれば「具体性あり」とみなす。
const CONCRETE_HINT_REGEX =
  /(高校|中学|大学|授業|留学|部活|研究|探究|インターン|ボランティア|アルバイト|資格|読書|コンテスト|大会|発表|論文|プロジェクト)/;

export function detectStatementPrepareWeakPoints(
  summary: StatementPrepareWeakPointInput,
): StatementPrepareWeakPoint[] {
  const weakPoints: StatementPrepareWeakPoint[] = [];

  for (const field of FIELDS) {
    const text = field.pick(summary).trim();
    const len = text.length;

    if (len === 0) {
      weakPoints.push({
        key: field.key,
        label: field.label,
        reason: '内容が空です。短くてもよいので具体的な内容を書きましょう。',
        severity: 'high',
      });
      continue;
    }

    if (len < 30) {
      weakPoints.push({
        key: field.key,
        label: field.label,
        reason: `内容が短すぎます（${len}文字）。場面・行動・感じたことのいずれかを足すと厚みが出ます。`,
        severity: 'high',
      });
      continue;
    }

    if (len < 60) {
      weakPoints.push({
        key: field.key,
        label: field.label,
        reason: `情報量がやや不足しています（${len}文字）。「いつ・どこで・何を」を補えると説得力が増します。`,
        severity: 'medium',
      });
      continue;
    }

    const hasAbstract = ABSTRACT_PHRASES.some((p) => text.includes(p));
    const hasConcrete = /\d/.test(text) || CONCRETE_HINT_REGEX.test(text);
    if (hasAbstract && !hasConcrete) {
      weakPoints.push({
        key: field.key,
        label: field.label,
        reason:
          '「頑張った」「学んだ」「興味がある」など抽象的な表現が中心で、具体的な場面や行動が見えにくい状態です。',
        severity: 'medium',
      });
    }
  }

  return weakPoints;
}

// STEP 15: 弱点 key ごとの固定深掘り質問。AI を呼ばずに「考えるきっかけ」を見せるだけ。
// Record で網羅性を担保（key を追加すると質問配列の不足を TS が指摘してくれる）。
const FOLLOW_UP_QUESTIONS: Record<StatementPrepareWeakPointKey, string[]> = {
  experience: [
    'その経験の中で、あなたが実際に行動した場面はどこですか？',
    'その経験で一番印象に残っている出来事は何ですか？',
    '周囲と比べて、あなたらしさが出た部分はどこですか？',
  ],
  issue: [
    'その経験を通して、どんな課題や違和感に気づきましたか？',
    'なぜその課題を重要だと感じましたか？',
    'その課題に対して、自分なりに考えたことはありますか？',
  ],
  interest: [
    'その分野に興味を持ったきっかけは何ですか？',
    '他の分野ではなく、その分野に惹かれた理由は何ですか？',
    'その分野について、もっと知りたいと思ったことは何ですか？',
  ],
  universityLearning: [
    '大学で特に学びたいテーマは何ですか？',
    'その大学・学部でなければならない理由は何ですか？',
    '授業・ゼミ・研究内容などで気になっているものはありますか？',
  ],
  future: [
    '将来、誰にどんな価値を届けたいですか？',
    '大学での学びを将来どのように活かしたいですか？',
    'その将来像に向けて、今の経験はどうつながりますか？',
  ],
};

export function getStatementPrepareFollowUpQuestions(
  key: StatementPrepareWeakPointKey,
): string[] {
  return FOLLOW_UP_QUESTIONS[key];
}

// STEP 17/18: 「追加メモ」表示用のコンパクトな項目ラベル。
// /statement/prepare と /statement/edit の両方で使うため lib 側で持つ。
export const STATEMENT_PREPARE_FOLLOW_UP_LABELS: Record<
  StatementPrepareWeakPointKey,
  string
> = {
  experience:         '印象に残った経験',
  issue:              '気づいた課題',
  interest:           '分野・学部への興味',
  universityLearning: '大学で学びたいこと',
  future:             '将来やりたいこと',
};
