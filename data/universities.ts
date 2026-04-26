import type { University } from '@/types/matching';

/**
 * 評価軸スコアの推定ルール（0〜5）
 *
 * 【総合型 AO】
 *   activity  : 社会課題・活動実績の記載 → +1
 *   inquiry   : hasEssay → +1、研究・探究の記載 → +1
 *   initiative: hasInterview → +1、hasPresentation → +1
 *   reason    : hasInterview → +1
 *   ベース: 各 3
 *
 * 【学校推薦型】
 *   gpa          : requiredGpa ≥ 4.0 → 4、≥ 3.8 → 3
 *   qualification: 語学資格など特記あり → 4、なし → 2
 *   academic     : hasEssay（学力記述） → 4〜5、なし → 2〜3
 *   reason       : hasInterview → 4、なし → 2
 *   ベース: 各 3
 */

export const universities: University[] = [

  // ── 文系・総合型 ─────────────────────────────────────────────

  {
    id: 'u001',
    name: '早稲田大学',
    faculty: '政治経済学部',
    admissionType: '総合型',
    academicType: '文系',
    requiredGpa: null,
    hasInterview: true,
    hasEssay: true,
    hasPresentation: false,
    description: '社会課題への深い関心と、自ら考え行動するリーダーシップを重視する。国内外の政策・経済問題を多角的に学ぶ環境を提供している。',
    tags: ['社会科学', 'リーダーシップ', '国際', '論述', '主体性重視'],
    similarSchools: ['慶應義塾大学', '上智大学', '国際基督教大学'],
    aoProfile: {
      activity: 4,   // 社会課題・活動実績を重視
      inquiry: 4,    // 小論文あり → 探究力が問われる
      initiative: 5, // 面接あり + 早稲田が最重視する項目
      reason: 4,     // 面接あり → 志望理由を深く問う
    },
    recommendationProfile: null,
  },

  {
    id: 'u002',
    name: '慶應義塾大学',
    faculty: '総合政策学部',
    admissionType: '総合型',
    academicType: '文系',
    requiredGpa: null,
    hasInterview: true,
    hasEssay: true,
    hasPresentation: true,
    description: '課題発見・解決能力と独自の研究テーマを持つ学生を求める。学際的アプローチで社会・政策・環境問題に取り組む。',
    tags: ['政策', '環境', 'テクノロジー', '探究重視', '実践型'],
    similarSchools: ['早稲田大学', '国際基督教大学', '慶應義塾大学（環境情報）'],
    aoProfile: {
      activity: 4,
      inquiry: 5,    // 小論文+探究テーマを最重視（SFC特色）
      initiative: 5, // 面接+プレゼンあり
      reason: 5,     // 面接で志望動機を深く問う（SFC独自）
    },
    recommendationProfile: null,
  },

  {
    id: 'u003',
    name: '国際基督教大学',
    faculty: '教養学部アーツ・サイエンス学科',
    admissionType: '総合型',
    academicType: '文系',
    requiredGpa: null,
    hasInterview: true,
    hasEssay: true,
    hasPresentation: false,
    description: '幅広い学問分野を横断するリベラルアーツ教育を実施。高い英語力と知的探究心を持つ学生を国内外から迎える。',
    tags: ['国際', '教養', '語学', '探究重視', 'リベラルアーツ'],
    similarSchools: ['早稲田大学', '慶應義塾大学（総合政策）', '上智大学'],
    aoProfile: {
      activity: 3,
      inquiry: 5,    // ICU最大の特徴：深い学術探究を重視
      initiative: 4, // 面接あり
      reason: 4,     // 面接あり + 志望理由の明確さ
    },
    recommendationProfile: null,
  },

  {
    id: 'u004',
    name: '上智大学',
    faculty: '総合グローバル学部',
    admissionType: '総合型',
    academicType: '文系',
    requiredGpa: null,
    hasInterview: true,
    hasEssay: true,
    hasPresentation: false,
    description: '国際問題・地域研究・開発協力などを多角的に学ぶ。海外経験や国際的な活動実績を持つ学生に適した選抜を行う。',
    tags: ['国際', '地域研究', '開発協力', '語学', '社会科学'],
    similarSchools: ['国際基督教大学', '明治大学', '青山学院大学'],
    aoProfile: {
      activity: 4,   // 海外経験・活動実績を重視
      inquiry: 4,    // 小論文あり
      initiative: 4, // 面接あり
      reason: 4,     // 面接あり + 志望分野との一貫性
    },
    recommendationProfile: null,
  },

  {
    id: 'u005',
    name: '明治大学',
    faculty: '国際日本学部',
    admissionType: '総合型',
    academicType: '文系',
    requiredGpa: null,
    hasInterview: true,
    hasEssay: true,
    hasPresentation: false,
    description: '日本文化・社会を国際的視点から研究する。海外発信力を養い、日本と世界を結ぶ人材を育成する。',
    tags: ['国際', '日本文化', '語学', '社会', 'コミュニケーション'],
    similarSchools: ['上智大学', '青山学院大学', '立命館大学'],
    aoProfile: {
      activity: 3,
      inquiry: 4,    // 小論文あり
      initiative: 4, // 面接あり
      reason: 4,     // 面接あり
    },
    recommendationProfile: null,
  },

  {
    id: 'u006',
    name: '立命館大学',
    faculty: '国際関係学部',
    admissionType: '総合型',
    academicType: '文系',
    requiredGpa: null,
    hasInterview: true,
    hasEssay: false,
    hasPresentation: false,
    description: '平和・国際協力・社会貢献活動に関心を持つ学生を広く迎える。ボランティア経験や地域活動の実績を重視する。',
    tags: ['国際', 'ボランティア', '平和', '社会貢献', '主体性重視'],
    similarSchools: ['明治大学', '同志社大学', '関西学院大学'],
    aoProfile: {
      activity: 4,   // 社会貢献・ボランティア活動を重視
      inquiry: 3,
      initiative: 4, // 面接あり
      reason: 4,     // 面接あり
    },
    recommendationProfile: null,
  },

  {
    id: 'u007',
    name: '青山学院大学',
    faculty: '国際政治経済学部',
    admissionType: '総合型',
    academicType: '文系',
    requiredGpa: null,
    hasInterview: true,
    hasEssay: true,
    hasPresentation: false,
    description: '政治・経済・国際コミュニケーションを融合して学ぶ。英語力と論理的思考力を活かした人材育成を目指す。',
    tags: ['国際', '政策', '経済', '語学', '論述'],
    similarSchools: ['明治大学', '上智大学', '立命館大学'],
    aoProfile: {
      activity: 3,
      inquiry: 4,    // 小論文あり
      initiative: 4, // 面接あり
      reason: 4,     // 面接あり
    },
    recommendationProfile: null,
  },

  {
    id: 'u008',
    name: '法政大学',
    faculty: '現代福祉学部',
    admissionType: '総合型',
    academicType: '文系',
    requiredGpa: null,
    hasInterview: true,
    hasEssay: false,
    hasPresentation: true,
    description: '福祉・臨床心理・コミュニティ支援を実践的に学ぶ。ボランティアや地域活動への積極的な参加を評価する。',
    tags: ['福祉', '社会', 'ボランティア', '心理', '主体性重視', '実践型'],
    similarSchools: ['立命館大学', '関西学院大学', '日本社会事業大学'],
    aoProfile: {
      activity: 4,   // 福祉ボランティアなどの活動実績を重視
      inquiry: 3,
      initiative: 5, // 面接+プレゼンあり
      reason: 3,
    },
    recommendationProfile: null,
  },

  // ── 理系・総合型 ─────────────────────────────────────────────

  {
    id: 'u009',
    name: '慶應義塾大学',
    faculty: '環境情報学部',
    admissionType: '総合型',
    academicType: '理系',
    requiredGpa: null,
    hasInterview: true,
    hasEssay: false,
    hasPresentation: true,
    description: '情報技術・環境・社会課題を横断する実践的な研究を重視。プログラミングや制作物の実績を具体的に問う選抜を行う。',
    tags: ['情報', '環境', 'テクノロジー', '探究重視', '実践型'],
    similarSchools: ['慶應義塾大学（総合政策）', '筑波大学', '東京大学'],
    aoProfile: {
      activity: 4,
      inquiry: 4,    // 技術探究を重視（SFC特色）
      initiative: 5, // 面接+プレゼンあり
      reason: 4,     // 面接あり
    },
    recommendationProfile: null,
  },

  {
    id: 'u010',
    name: '筑波大学',
    faculty: '情報学群',
    admissionType: '総合型',
    academicType: '理系',
    requiredGpa: null,
    hasInterview: true,
    hasEssay: false,
    hasPresentation: true,
    description: 'プログラミング・情報処理・AI分野での実績と深い探究活動を評価する。研究テーマの明確さと自己推薦書の内容を重視する。',
    tags: ['情報', 'プログラミング', '研究', '探究重視', 'AI'],
    similarSchools: ['慶應義塾大学（環境情報）', '同志社大学', '電気通信大学'],
    aoProfile: {
      activity: 4,   // 技術的な実績・制作物を評価
      inquiry: 5,    // CS探究の深さ + プレゼンで問われる
      initiative: 4, // 面接+プレゼンあり（initiativeは4に抑制）
      reason: 3,     // 理系のため reason より inquiry 重視
    },
    recommendationProfile: null,
  },

  {
    id: 'u011',
    name: '同志社大学',
    faculty: '理工学部',
    admissionType: '総合型',
    academicType: '理系',
    requiredGpa: null,
    hasInterview: true,
    hasEssay: true,
    hasPresentation: false,
    description: '科学技術への探究心と社会への応用意識を持つ学生を歓迎する。小論文で論理的思考力と関心分野の深さを評価する。',
    tags: ['理工', '探究', '社会貢献', '研究', '論述'],
    similarSchools: ['立命館大学', '関西学院大学', '筑波大学'],
    aoProfile: {
      activity: 3,
      inquiry: 4,    // 小論文+理工探究を重視
      initiative: 4, // 面接あり
      reason: 4,     // 面接+小論文あり
    },
    recommendationProfile: null,
  },

  // ── 文系・学校推薦型 ─────────────────────────────────────────

  {
    id: 'u012',
    name: '上智大学',
    faculty: '外国語学部',
    admissionType: '学校推薦型',
    academicType: '文系',
    requiredGpa: 4.0,
    hasInterview: true,
    hasEssay: false,
    hasPresentation: false,
    description: '語学力と評定を重視した指定校・公募推薦を実施。英語資格（英検準1級以上など）の取得が評価される。',
    tags: ['語学', '国際', 'コミュニケーション', '資格'],
    similarSchools: ['国際基督教大学', '青山学院大学', '立教大学'],
    aoProfile: null,
    recommendationProfile: {
      gpa: 4,           // requiredGpa=4.0 → 高評定必須
      qualification: 4, // 英語資格を特に重視
      academic: 3,
      reason: 4,        // 面接あり → 志望理由を問う
    },
  },

  {
    id: 'u013',
    name: '立教大学',
    faculty: '経営学部',
    admissionType: '学校推薦型',
    academicType: '文系',
    requiredGpa: 3.8,
    hasInterview: true,
    hasEssay: false,
    hasPresentation: false,
    description: '安定した評定と経営・マーケティングへの関心を評価する公募推薦。面接では志望動機と将来像を具体的に問う。',
    tags: ['経営', 'マーケティング', 'ビジネス'],
    similarSchools: ['青山学院大学', '上智大学', '明治大学'],
    aoProfile: null,
    recommendationProfile: {
      gpa: 3,           // requiredGpa=3.8
      qualification: 3,
      academic: 3,
      reason: 4,        // 面接あり → 志望理由を重視
    },
  },

  {
    id: 'u014',
    name: '青山学院大学',
    faculty: '経営学部',
    admissionType: '学校推薦型',
    academicType: '文系',
    requiredGpa: 3.8,
    hasInterview: true,
    hasEssay: false,
    hasPresentation: false,
    description: '評定と志望理由の明確さを重視した公募推薦。マーケティング・経営への実践的な関心を評価する。',
    tags: ['経営', 'マーケティング', 'ビジネス'],
    similarSchools: ['立教大学', '上智大学', '明治大学'],
    aoProfile: null,
    recommendationProfile: {
      gpa: 3,           // requiredGpa=3.8
      qualification: 3,
      academic: 3,
      reason: 4,        // 面接あり
    },
  },

  {
    id: 'u015',
    name: '関西学院大学',
    faculty: '社会学部',
    admissionType: '学校推薦型',
    academicType: '文系',
    requiredGpa: 3.8,
    hasInterview: true,
    hasEssay: false,
    hasPresentation: false,
    description: '社会調査・福祉・コミュニティ分野の学習意欲と安定した評定を重視する推薦入試。面接で社会への関心を確認する。',
    tags: ['社会', '福祉', 'コミュニティ', '社会科学'],
    similarSchools: ['立命館大学', '同志社大学', '法政大学'],
    aoProfile: null,
    recommendationProfile: {
      gpa: 3,           // requiredGpa=3.8
      qualification: 2,
      academic: 3,
      reason: 4,        // 面接あり
    },
  },

  // ── 理系・学校推薦型 ─────────────────────────────────────────

  {
    id: 'u016',
    name: '東京理科大学',
    faculty: '理工学部',
    admissionType: '学校推薦型',
    academicType: '理系',
    requiredGpa: 4.0,
    hasInterview: false,
    hasEssay: true,  // 理数系の記述試験あり
    hasPresentation: false,
    description: '理数系の基礎学力と継続的な学習姿勢を評価する。高い評定と数学・理科の記述試験によって学力水準を厳格に判定する。',
    tags: ['理工', '研究', '数学', '実力重視'],
    similarSchools: ['筑波大学', '同志社大学', '芝浦工業大学'],
    aoProfile: null,
    recommendationProfile: {
      gpa: 4,           // requiredGpa=4.0
      qualification: 3,
      academic: 5,      // 記述試験あり + 理科大の学力重視文化
      reason: 2,        // 面接なし
    },
  },
];
