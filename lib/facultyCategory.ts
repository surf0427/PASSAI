// STEP 29: 大学 DB が入るまでの暫定。学部系統の型・表示名・確認ポイント。
// AI には渡さず、UI 側のヒント表示にのみ使う。

export type FacultyCategory =
  | 'business'
  | 'international'
  | 'education'
  | 'law'
  | 'economics'
  | 'sociology'
  | 'psychology'
  | 'engineering'
  | 'health'
  | 'other';

// select の選択肢順。Record + as const ではなく配列で持つことで描画順を固定。
export const FACULTY_CATEGORY_LIST: ReadonlyArray<FacultyCategory> = [
  'business',
  'international',
  'education',
  'law',
  'economics',
  'sociology',
  'psychology',
  'engineering',
  'health',
  'other',
];

const FACULTY_CATEGORY_LABELS: Record<FacultyCategory, string> = {
  business:      '経営・商学系',
  international: '国際・語学系',
  education:     '教育系',
  law:           '法・政治系',
  economics:     '経済系',
  sociology:     '社会・メディア系',
  psychology:    '心理系',
  engineering:   '理工・情報系',
  health:        '医療・福祉系',
  other:         'その他',
};

// Record で網羅性を担保（key 追加時に未設定があれば TS が指摘）。
const FACULTY_CATEGORY_CHECKPOINTS: Record<FacultyCategory, string[]> = {
  business: [
    'その経験が、組織・商品・サービス・課題解決とどう関係しているか',
    '将来、どんな価値をビジネスで届けたいのか',
    'なぜ経営・商学を学ぶ必要があるのか',
  ],
  international: [
    '異文化・言語・国際問題への関心がどこから来たのか',
    '海外経験や異文化接触の経験とどうつながるか',
    '将来どのように国際的な場面で活かしたいのか',
  ],
  education: [
    '教育に関心を持った原体験は何か',
    'どんな人の成長を支えたいのか',
    '大学で学びたい教育理論・実践とどうつながるか',
  ],
  law: [
    '社会・制度・人権に関心を持ったきっかけは何か',
    'どんな課題を法的・政治的な視点で解決したいのか',
    '大学でどの分野（憲法・刑法・国際法・政治学など）を深めたいか',
  ],
  economics: [
    '経済現象や数字への関心がどこから来たのか',
    '経済の仕組みで解決したい問題は何か',
    '将来どんな立場で経済の知見を活かしたいのか',
  ],
  sociology: [
    '関心のある社会現象・メディア表現は何か',
    'どんな人や集団の状況を理解・改善したいのか',
    '大学で扱いたい理論や調査手法とどうつながるか',
  ],
  psychology: [
    '人の感情・行動への関心がどこから来たのか',
    '誰のどんな心の状態を理解・支えたいのか',
    '大学で学びたい心理学領域（臨床・発達・社会・認知など）とどうつながるか',
  ],
  engineering: [
    '解決したい課題と技術・情報分野がどう関係するか',
    'ものづくり・データ・システムへの関心がどこから来たか',
    '将来どんな技術でどんな価値を作りたいか',
  ],
  health: [
    '医療・福祉に関心を持った原体験は何か',
    'どんな人をどんな場面で支えたいのか',
    '大学で学びたい医療・福祉領域とどうつながるか',
  ],
  other: [
    '経験・学びたいこと・将来像が一つの流れになっているか',
    'その学部でなければならない理由があるか',
    '自分の経験が志望分野とつながっているか',
  ],
};

export function getFacultyCategoryLabel(category: FacultyCategory): string {
  return FACULTY_CATEGORY_LABELS[category];
}

export function getFacultyCategoryCheckpoints(
  category: FacultyCategory,
): string[] {
  return FACULTY_CATEGORY_CHECKPOINTS[category];
}

// 任意文字列が FacultyCategory かを判定。select の onChange など外部入力の絞り込みに使う。
export function isFacultyCategory(value: string): value is FacultyCategory {
  return (FACULTY_CATEGORY_LIST as ReadonlyArray<string>).includes(value);
}
