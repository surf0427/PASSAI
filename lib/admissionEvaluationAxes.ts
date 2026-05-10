// ── 型定義 ───────────────────────────────────────────────────────

export type EvaluationAxis = {
  id: string;
  label: string;
  description: string;
  checkQuestion: string;
  keywords: string[]; // 本文との簡易マッチに使用
};

export type EvaluationAxisPreset = {
  id: string;
  university?: string;        // 特定大学プリセットの場合のみ設定
  facultyKeyword: string;
  displayName: string;
  axes: EvaluationAxis[];
};

export type AxisCheckResult = {
  axis: EvaluationAxis;
  status: 'maybe' | 'missing';
  reason: string;
};

// ── 評価軸チェック関数 ────────────────────────────────────────────

export function checkAxis(text: string, axis: EvaluationAxis): AxisCheckResult {
  const matched = axis.keywords.some((kw) => text.includes(kw));
  if (matched) {
    return {
      axis,
      status: 'maybe',
      reason: '関連する表現が含まれている可能性があります',
    };
  }
  return {
    axis,
    status: 'missing',
    reason: 'まだ触れられていないかもしれません。確認してみましょう',
  };
}

// ── プリセットデータ ──────────────────────────────────────────────

// 法政大学 国際文化学部（個別プリセット）
const PRESET_HOSEI_INTERNATIONAL: EvaluationAxisPreset = {
  id: 'hosei-international',
  university: '法政',
  facultyKeyword: '国際文化',
  displayName: '法政大学 国際文化学部',
  axes: [
    {
      id: 'intercultural-understanding',
      label: '異文化理解',
      description:
        '異なる文化や価値観に触れた経験を、自分の考え方の変化につなげられているか。',
      checkQuestion: '異文化に触れた経験から、何を考えるようになりましたか？',
      keywords: ['異文化', '文化', '価値観', '外国', '海外', '語学'],
    },
    {
      id: 'overseas-meaning',
      label: '留学・海外経験の意味づけ',
      description:
        '海外経験や留学が単なる体験談に終わらず、志望理由につながっているか。',
      checkQuestion:
        '海外経験から得たものを、なぜ国際文化学部で深めたいのですか？',
      keywords: ['留学', '海外', '外国', '渡航', '英語'],
    },
    {
      id: 'self-initiative',
      label: '主体性',
      description: '自分から動いた経験、探究した姿勢が見えるか。',
      checkQuestion:
        'この志望に向けて、自分から取り組んだことはありますか？',
      keywords: ['私は', '自分で', '取り組', '挑戦', '調べ', '参加'],
    },
    {
      id: 'faculty-reason',
      label: '国際文化学部で学ぶ理由',
      description:
        'なぜ国際文化学部でなければならないかが、自分の経験から説明されているか。',
      checkQuestion:
        '国際文化学部でしか学べないことで、あなたが求めるものは何ですか？',
      keywords: ['国際文化', '学部', '貴学', 'この大学', 'なぜ'],
    },
    {
      id: 'future-connection',
      label: '将来目標との接続',
      description: '大学での学びが将来のビジョンにつながっているか。',
      checkQuestion:
        '国際文化学部での学びを、将来どう活かしたいですか？',
      keywords: ['将来', '卒業後', '仕事', '目指', '活かし', '役立'],
    },
  ],
};

// 国際系学部
const PRESET_INTERNATIONAL: EvaluationAxisPreset = {
  id: 'international',
  facultyKeyword: '国際',
  displayName: '国際系学部（汎用）',
  axes: [
    {
      id: 'intercultural',
      label: '異文化理解',
      description: '異なる文化・価値観との接触経験が書かれているか。',
      checkQuestion: '異文化に触れた体験から、何を学びましたか？',
      keywords: ['異文化', '文化', '価値観', '外国', '海外'],
    },
    {
      id: 'language-purpose',
      label: '語学を学ぶ目的',
      description: '語学をツールとして使う目的が見えるか。',
      checkQuestion: '語学を学ぶのは、どんな目的のためですか？',
      keywords: ['語学', '英語', '言語', 'コミュニケーション'],
    },
    {
      id: 'global-issue',
      label: '国際課題への関心',
      description: '世界の課題や国際問題への関心が書かれているか。',
      checkQuestion: '関心を持っている国際的な課題はありますか？',
      keywords: ['国際', '世界', 'グローバル', '課題', '問題'],
    },
    {
      id: 'overseas-specifics',
      label: '海外経験・関心の具体性',
      description: '海外への関心が抽象的でなく、具体的に書かれているか。',
      checkQuestion: '海外への関心はどんな経験から来ていますか？',
      keywords: ['留学', '海外', '外国', '現地', '渡航'],
    },
    {
      id: 'future-global',
      label: '将来との接続',
      description: '国際的な学びが将来の活動につながっているか。',
      checkQuestion: '国際的な学びを将来どう活かしたいですか？',
      keywords: ['将来', '卒業後', '国際的', '活かし', '目指'],
    },
  ],
};

// 経済・経営系学部
const PRESET_ECONOMICS: EvaluationAxisPreset = {
  id: 'economics',
  facultyKeyword: '経済',
  displayName: '経済・経営系学部（汎用）',
  axes: [
    {
      id: 'social-issue',
      label: '社会課題への関心',
      description: '経済的・社会的な課題への問題意識が書かれているか。',
      checkQuestion: 'どんな社会・経済的な課題に関心がありますか？',
      keywords: ['社会', '課題', '問題', '格差', '経済', '市場'],
    },
    {
      id: 'data-awareness',
      label: '数字・データへの意識',
      description: '根拠となる数字やデータへの関心が見えるか。',
      checkQuestion: '関心のある課題で、数字やデータに注目したことはありますか？',
      keywords: ['数字', 'データ', '統計', '分析', '数値'],
    },
    {
      id: 'business-interest',
      label: 'ビジネス・経済活動への関心',
      description: '企業・市場・経営への具体的な関心が書かれているか。',
      checkQuestion: 'ビジネスや経済活動のどんな側面に興味がありますか？',
      keywords: ['ビジネス', '経済', '経営', '企業', '市場', '商業'],
    },
    {
      id: 'career-vision',
      label: '将来の職業観',
      description: '卒業後にどんな仕事をしたいかが見えるか。',
      checkQuestion: '経済・経営の知識を将来どんな仕事に活かしたいですか？',
      keywords: ['仕事', '職業', '企業', '働き', 'キャリア', '将来'],
    },
    {
      id: 'faculty-reason-ec',
      label: '学部で学ぶ理由',
      description: 'なぜ経済・経営学部でなければならないかが書かれているか。',
      checkQuestion: 'この学部でしか学べないと思うことは何ですか？',
      keywords: ['経済', '経営', '学部', '貴学', 'この大学'],
    },
  ],
};

// 法学系学部
const PRESET_LAW: EvaluationAxisPreset = {
  id: 'law',
  facultyKeyword: '法',
  displayName: '法学系学部（汎用）',
  axes: [
    {
      id: 'social-problem',
      label: '社会問題への関心',
      description: '社会的な不公正や問題への関心が書かれているか。',
      checkQuestion: '社会のどんな問題や不公正に関心がありますか？',
      keywords: ['社会', '問題', '不公平', '差別', '権利', '課題'],
    },
    {
      id: 'rule-awareness',
      label: 'ルール・制度への問題意識',
      description: '法律・制度・ルールへの問題意識や関心が見えるか。',
      checkQuestion: '現行の法律や制度で、変えたいと感じることはありますか？',
      keywords: ['法律', '制度', 'ルール', '権利', '法', '規則'],
    },
    {
      id: 'logical-thinking',
      label: '論理的に考える姿勢',
      description: '根拠や理由を示しながら考えを展開できているか。',
      checkQuestion: '問題を考えるとき、どのように根拠を集めていますか？',
      keywords: ['論理', '根拠', '考え', '分析', '理由', 'なぜなら'],
    },
    {
      id: 'social-contribution-law',
      label: '将来の社会貢献',
      description: '法律の知識を社会にどう役立てたいかが見えるか。',
      checkQuestion: '法学の知識を将来どんな形で社会に活かしたいですか？',
      keywords: ['社会貢献', '弁護士', '法曹', '公務員', '将来', '検察', '司法'],
    },
    {
      id: 'faculty-reason-law',
      label: '法学部で学ぶ理由',
      description: 'なぜ法学部でなければならないかが書かれているか。',
      checkQuestion: '法学部で学びたい理由を具体的に説明できますか？',
      keywords: ['法学', '法律', '学部', '貴学', 'この大学'],
    },
  ],
};

// 教育系学部
const PRESET_EDUCATION: EvaluationAxisPreset = {
  id: 'education',
  facultyKeyword: '教育',
  displayName: '教育系学部（汎用）',
  axes: [
    {
      id: 'growth-interest',
      label: '人の成長への関心',
      description: '人が学び・成長していく過程への関心が書かれているか。',
      checkQuestion: '誰かの成長に関わった経験や、成長を感じた場面はありますか？',
      keywords: ['成長', '学び', '教育', '子ども', '人'],
    },
    {
      id: 'education-awareness',
      label: '教育現場や学習経験への気づき',
      description: '学校・授業・学習経験から得た気づきが書かれているか。',
      checkQuestion: '自分が学んできた経験で、気づいたことはありますか？',
      keywords: ['教育', '学校', '授業', '学習', '塾', '先生'],
    },
    {
      id: 'learner-perspective',
      label: '子ども・学習者への視点',
      description: '子どもや学習者を主体として見る視点が書かれているか。',
      checkQuestion: '子どもや学習者のどんな点に関心がありますか？',
      keywords: ['子ども', '生徒', '学習者', '児童', '学生'],
    },
    {
      id: 'teaching-motivation',
      label: '教員・教育職への動機',
      description: '教えることや教育に関わる仕事への動機が書かれているか。',
      checkQuestion: 'なぜ教員・教育職を目指そうと思ったのですか？',
      keywords: ['教員', '先生', '教師', '教職', '教える'],
    },
    {
      id: 'faculty-reason-edu',
      label: '学部で学ぶ理由',
      description: 'なぜ教育学部でなければならないかが書かれているか。',
      checkQuestion: '教育学部でしか学べないと思うことは何ですか？',
      keywords: ['教育学部', '教育', '学部', '貴学', 'この大学'],
    },
  ],
};

// 社会・福祉系学部
const PRESET_SOCIALWORK: EvaluationAxisPreset = {
  id: 'socialwork',
  facultyKeyword: '社会',
  displayName: '社会・福祉系学部（汎用）',
  axes: [
    {
      id: 'vulnerable-interest',
      label: '社会的弱者や地域課題への関心',
      description: '困難を抱える人々や地域の問題への関心が書かれているか。',
      checkQuestion: 'どんな人々の困難や地域課題に関心がありますか？',
      keywords: ['高齢者', '障害', '困窮', '地域', '弱者', '社会問題'],
    },
    {
      id: 'volunteer-experience',
      label: '支援・ボランティア経験',
      description: '支援活動やボランティア経験が書かれているか。',
      checkQuestion: '支援やボランティアを通じて感じたことはありますか？',
      keywords: ['支援', 'ボランティア', '活動', '福祉', '介護'],
    },
    {
      id: 'field-awareness',
      label: '現場で感じた課題',
      description: '現場での体験から課題を感じた経験が書かれているか。',
      checkQuestion: '現場や体験を通して感じた課題は何ですか？',
      keywords: ['現場', '課題', '感じた', '問題', '体験'],
    },
    {
      id: 'social-system',
      label: '社会制度への関心',
      description: '福祉・社会保障の制度への関心や問題意識が見えるか。',
      checkQuestion: '社会制度や福祉の仕組みについて、関心のある点はありますか？',
      keywords: ['制度', '福祉', '社会保障', 'サービス', '行政'],
    },
    {
      id: 'future-support',
      label: '将来の支援・貢献像',
      description: '将来どんな形で支援や貢献をしたいかが書かれているか。',
      checkQuestion: '将来どんな支援や社会貢献をしたいですか？',
      keywords: ['将来', '支援', '貢献', '福祉士', '社会福祉', '社会'],
    },
  ],
};

// 情報系学部
const PRESET_INFORMATION: EvaluationAxisPreset = {
  id: 'information',
  facultyKeyword: '情報',
  displayName: '情報・理工系学部（汎用）',
  axes: [
    {
      id: 'tech-interest',
      label: '技術への関心',
      description: 'ITや技術への具体的な関心・興味が書かれているか。',
      checkQuestion: 'どんな技術に関心がありますか？きっかけも教えてください。',
      keywords: ['技術', 'プログラミング', 'IT', 'システム', 'コンピュータ', 'AI'],
    },
    {
      id: 'hands-on',
      label: '作ったもの・調べた経験',
      description: '実際に作ったり調べたりした経験が書かれているか。',
      checkQuestion: 'プログラミングや技術で取り組んだことはありますか？',
      keywords: ['作った', '開発', 'プログラム', '研究', '調べた', '制作'],
    },
    {
      id: 'it-social',
      label: '社会課題とITの接続',
      description: 'ITで社会の課題を解決したいという視点が見えるか。',
      checkQuestion: 'IT・技術を使って解決したい社会課題はありますか？',
      keywords: ['社会', '課題', 'AI', 'デジタル', '解決', '活用'],
    },
    {
      id: 'logical',
      label: '論理的思考',
      description: '問題を筋道立てて考える姿勢が書かれているか。',
      checkQuestion: '問題を解くとき、どのように考えを整理しますか？',
      keywords: ['論理', '考え', '分析', '設計', '整理', '根拠'],
    },
    {
      id: 'future-tech',
      label: '将来の活用イメージ',
      description: '技術を将来どう活用したいかが書かれているか。',
      checkQuestion: '技術の知識を将来どんな場面で活かしたいですか？',
      keywords: ['将来', 'エンジニア', '開発', 'IT', 'システム', '活かし'],
    },
  ],
};

// 汎用プリセット（fallback）
const PRESET_GENERAL: EvaluationAxisPreset = {
  id: 'general',
  facultyKeyword: '',
  displayName: '汎用（大学・学部共通）',
  axes: [
    {
      id: 'general-motivation',
      label: '志望理由の一貫性',
      description: '経験・関心・志望・将来がひとつの流れでつながっているか。',
      checkQuestion: '経験から志望、そして将来目標まで一貫した流れで説明できますか？',
      keywords: ['きっかけ', '理由', '志望', 'なぜ', '経験'],
    },
    {
      id: 'general-experience',
      label: '具体的な経験',
      description: '実際の体験・活動が書かれているか。',
      checkQuestion: 'どんな具体的な経験がこの志望につながっていますか？',
      keywords: ['経験', '体験', '取り組', '参加', '活動'],
    },
    {
      id: 'general-university',
      label: '大学で学ぶ理由',
      description: 'なぜこの大学・学部でなければならないかが書かれているか。',
      checkQuestion: 'この大学・学部でしか学べないことは何ですか？',
      keywords: ['大学', '学部', '貴学', '学びたい', 'この大学'],
    },
    {
      id: 'general-future',
      label: '将来目標との接続',
      description: '大学での学びと将来の姿がつながっているか。',
      checkQuestion: '大学での学びを将来どのように活かしたいですか？',
      keywords: ['将来', '卒業後', '目指', '役立て', '活かし'],
    },
    {
      id: 'general-initiative',
      label: '主体性',
      description: '自分から動いた・考えた姿勢が見えるか。',
      checkQuestion: 'この志望に向けて、自分から行動したことはありますか？',
      keywords: ['私は', '自分で', '取り組', '挑戦', '調べ'],
    },
  ],
};

// ── プリセット選択ロジック ─────────────────────────────────────────

const SPECIFIC_PRESETS: EvaluationAxisPreset[] = [
  PRESET_HOSEI_INTERNATIONAL,
];

const GENRE_PRESETS: Array<{
  keywords: string[];
  preset: EvaluationAxisPreset;
}> = [
  { keywords: ['国際', '外国語', 'グローバル', '異文化'], preset: PRESET_INTERNATIONAL },
  { keywords: ['経済', '経営', '商'], preset: PRESET_ECONOMICS },
  { keywords: ['法'], preset: PRESET_LAW },
  { keywords: ['教育', '教員', '児童', '保育'], preset: PRESET_EDUCATION },
  { keywords: ['福祉', '地域', 'コミュニティ'], preset: PRESET_SOCIALWORK },
  { keywords: ['情報', 'データ', '理工', '工学', 'AI', 'IT'], preset: PRESET_INFORMATION },
];

export function getEvaluationAxes(
  university: string,
  faculty: string
): EvaluationAxisPreset {
  // 1. 大学 + 学部の個別プリセット
  for (const preset of SPECIFIC_PRESETS) {
    if (
      preset.university &&
      university.includes(preset.university) &&
      faculty.includes(preset.facultyKeyword)
    ) {
      return preset;
    }
  }

  // 2. 学部キーワードによるジャンル判定
  for (const { keywords, preset } of GENRE_PRESETS) {
    if (keywords.some((kw) => faculty.includes(kw))) {
      return preset;
    }
  }

  // 3. fallback
  return PRESET_GENERAL;
}
