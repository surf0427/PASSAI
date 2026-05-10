// STEP 30: 整理メモ + 学部系統 をもとに「下書きの構成ガイド」を返す。
// AI を呼ばず、固定の構成テンプレを学部系統で出し分けるだけ。
// summary 本体には触らず、参照する key の表示名取得 helper も同梱する。

import type { FacultyCategory } from '@/lib/facultyCategory';

export type StatementDraftStructureSummaryKey =
  | 'impressiveExperience'
  | 'feltIssue'
  | 'interestInField'
  | 'universityLearning'
  | 'futureApplication';

export type StatementDraftStructureStep = {
  title: string;
  description: string;
  useSummaryKeys: StatementDraftStructureSummaryKey[];
};

export type StatementDraftStructureGuide = {
  title: string;
  description: string;
  steps: StatementDraftStructureStep[];
};

// summary key → 表示名（spec point 7）
const SUMMARY_KEY_LABELS: Record<StatementDraftStructureSummaryKey, string> = {
  impressiveExperience: '印象に残った経験',
  feltIssue:            '気づいた課題',
  interestInField:      '分野・学部への興味',
  universityLearning:   '大学で学びたいこと',
  futureApplication:    '将来やりたいこと',
};

export function getStatementDraftStructureSummaryKeyLabel(
  key: StatementDraftStructureSummaryKey,
): string {
  return SUMMARY_KEY_LABELS[key];
}

// ── 共通の 4 ステップ雛形 ──────────────────────────────────────────
// 各 facultyCategory の steps 配列を作るときに base.titles を上書きする想定。
// useSummaryKeys は基本 4 ステップで共通化できるが、必要に応じてオーバーライド可能。
const BASE_USE_KEYS: ReadonlyArray<StatementDraftStructureStep['useSummaryKeys']> = [
  ['impressiveExperience'],
  ['feltIssue', 'interestInField'],
  ['universityLearning'],
  ['futureApplication'],
];

function makeSteps(
  titles: [string, string, string, string],
  descriptions: [string, string, string, string],
): StatementDraftStructureStep[] {
  return [0, 1, 2, 3].map((i) => ({
    title: titles[i],
    description: descriptions[i],
    useSummaryKeys: [...BASE_USE_KEYS[i]],
  }));
}

// Record で網羅性担保。FacultyCategory が増減した瞬間に TS が指摘する。
const GUIDES: Record<FacultyCategory, StatementDraftStructureGuide> = {
  business: {
    title: '経営・商学系の構成',
    description:
      'ビジネスの視点で「経験 → 課題 → 学び → 将来届けたい価値」をつなげましょう。',
    steps: makeSteps(
      [
        '経験の中で感じた課題',
        '組織・サービス・商品・社会課題との接点',
        '経営・商学で学びたいこと',
        '将来届けたい価値',
      ],
      [
        '部活・アルバイト・探究などの経験のうち、組織や顧客と関わって課題に気づいた場面を書きます。',
        'その課題が、企業活動・サービス設計・社会課題のどこに接続するかを言語化します。',
        'マーケティング・経営戦略・会計・組織論など、具体的に学びたい領域に踏み込みます。',
        'どの市場・対象に、どんな価値を届けるビジネスを作りたいかを示します。',
      ],
    ),
  },
  international: {
    title: '国際・語学系の構成',
    description:
      '異文化・言語・国際問題への関心を、経験と将来像でつなげましょう。',
    steps: makeSteps(
      [
        '異文化・言語・国際問題に関心を持ったきっかけ',
        '経験から感じた違和感や課題',
        '大学で深めたい国際的テーマ',
        '将来どのように国際社会で活かすか',
      ],
      [
        '海外経験・異文化接触・ニュースで強く印象に残った場面を具体的に書きます。',
        'その経験で感じた違和感・気づいた課題を、自分の言葉で言語化します。',
        '地域研究・国際関係論・言語学など、深めたい領域と具体的なテーマを示します。',
        '進学・仕事・市民活動など、どの場面で国際的な視点を活かすかを書きます。',
      ],
    ),
  },
  education: {
    title: '教育系の構成',
    description: '人の成長への関心を、原体験から将来像までつなげましょう。',
    steps: makeSteps(
      [
        '教育や人の成長に関心を持った原体験',
        'その経験で見えた課題',
        '大学で学びたい教育理論・実践',
        '将来どんな人を支えたいか',
      ],
      [
        '部活・委員会・指導経験など、人の成長に関わった場面を具体的に書きます。',
        'その経験で気づいた、教育現場・学校制度・学習プロセスの課題を整理します。',
        '教育心理・発達・カリキュラム・教科教育など、深めたい理論や実践を書きます。',
        '対象（年齢・状況）と、自分が果たしたい役割を具体的に示します。',
      ],
    ),
  },
  law: {
    title: '法・政治系の構成',
    description:
      '制度・社会への問題意識を、経験と将来の関わり方でつなげましょう。',
    steps: makeSteps(
      [
        '制度・法・社会問題に関心を持ったきっかけ',
        'その経験で見えた制度的な課題や疑問',
        '大学で深めたい法・政治分野',
        '将来どんな立場で社会に関わりたいか',
      ],
      [
        '身近な体験・ニュース・学校生活で制度や権利について考えた場面を書きます。',
        'なぜそれが課題だと感じたか、誰がどう困っているかを具体的に書きます。',
        '憲法・刑事・国際法・行政・政治学など、踏み込みたい領域を示します。',
        '法曹・行政・NPO・研究など、社会と関わる立場を具体的に示します。',
      ],
    ),
  },
  economics: {
    title: '経済系の構成',
    description: '経済の仕組みへの関心を、経験と将来像でつなげましょう。',
    steps: makeSteps(
      [
        '経済・社会の動きに関心を持ったきっかけ',
        'その経験で見えた経済的・構造的課題',
        '大学で学びたい経済学領域',
        '将来どんな立場で経済の知見を活かすか',
      ],
      [
        '家計・ニュース・地域・ビジネスなど、経済的な動きを意識した場面を書きます。',
        'その背景にある仕組み・格差・市場の歪みなどへの問題意識を整理します。',
        'ミクロ・マクロ・計量・行動・公共経済学など、深めたい領域を示します。',
        '企業・公共・国際機関・研究など、知見を活かす場面を具体的に示します。',
      ],
    ),
  },
  sociology: {
    title: '社会・メディア系の構成',
    description:
      '社会現象・メディア・人間関係への関心を、経験と将来像でつなげましょう。',
    steps: makeSteps(
      [
        '関心のある社会現象・人間関係・メディアに関する経験',
        'その経験で見えた社会的な違和感や課題',
        '大学で扱いたい理論や調査手法',
        '将来どう社会と関わりたいか',
      ],
      [
        '日常・SNS・地域・学校で気になった社会現象を具体的に書きます。',
        'その背景にある構造・規範・メディア表現への違和感を言語化します。',
        '社会学理論・質的/量的調査・メディア研究など、踏み込みたい方法論を示します。',
        '研究・ジャーナリズム・企業・地域活動など、関わり方を具体的に示します。',
      ],
    ),
  },
  psychology: {
    title: '心理系の構成',
    description: '人の心への関心を、原体験と将来の支え方でつなげましょう。',
    steps: makeSteps(
      [
        '人の感情・行動に関心を持ったきっかけ',
        'その経験で気になった心理的な課題',
        '大学で学びたい心理学領域',
        '将来どんな人をどう支えたいか',
      ],
      [
        '友人・家族・自分自身の感情や行動を観察した場面を具体的に書きます。',
        'その背景にある不安・ストレス・偏見など、心理的な課題を整理します。',
        '臨床・発達・社会・認知・公認心理師領域など、踏み込みたい領域を示します。',
        '臨床・教育・産業・研究など、支える立場と対象を具体的に示します。',
      ],
    ),
  },
  engineering: {
    title: '理工・情報系の構成',
    description:
      '技術への関心と解決したい課題を、研究テーマと将来像でつなげましょう。',
    steps: makeSteps(
      [
        '技術・情報・ものづくりに関心を持ったきっかけ',
        '解決したい課題',
        '大学で学びたい技術・研究テーマ',
        '将来どんな仕組みや価値を作りたいか',
      ],
      [
        'プログラミング・実験・工作・ロボット・ゲームなど、技術に触れた経験を書きます。',
        'その経験から見えた、社会・産業・身近な場面の課題を具体的に示します。',
        '情報・機械・電気・データサイエンス・AI など、踏み込みたい領域とテーマを書きます。',
        'どんな仕組み・サービス・製品を、誰のために作りたいかを示します。',
      ],
    ),
  },
  health: {
    title: '医療・福祉系の構成',
    description: '医療・福祉への関心を、原体験と支えたい人物像でつなげましょう。',
    steps: makeSteps(
      [
        '医療・福祉に関心を持った原体験',
        'その経験で見えた医療・福祉の課題',
        '大学で学びたい医療・福祉領域',
        '将来どんな立場で誰を支えたいか',
      ],
      [
        '家族・身近な人の医療・介護・障害などに関わった経験を具体的に書きます。',
        'その経験で気づいた、現場・制度・地域の課題を整理します。',
        '医学・看護・リハ・社会福祉・公衆衛生など、深めたい領域を示します。',
        '臨床・研究・行政・地域支援など、支える立場と対象を具体的に示します。',
      ],
    ),
  },
  other: {
    title: '基本構成',
    description: '経験 → 課題 → 学び → 将来 の 4 ブロックで書くと整理しやすくなります。',
    steps: makeSteps(
      [
        '印象に残った経験',
        'そこから生まれた関心・課題',
        '大学で学びたいこと',
        '将来像',
      ],
      [
        'いつ・どこで・どう関わったかを含めて、自分の言葉で具体的に書きます。',
        '経験を通して気づいた課題や、興味を持った分野について書きます。',
        'その学部・カリキュラムでなぜ学ぶのかを書きます。',
        '学んだことをどう活かしたいかを書きます。',
      ],
    ),
  },
};

export function getStatementDraftStructureGuide(
  category: FacultyCategory,
): StatementDraftStructureGuide {
  return GUIDES[category];
}
