import type { ActivityData } from '@/types/activity';

export type NgWordIssue = {
  phrase: string;
  reason: string;
  suggestion: string;
  activityHint?: string;
  severity: 'high' | 'medium';
  kind: 'phrase' | 'quality';
  qualityType?: 'length' | 'specificity' | 'experience' | 'universityConnection';
  missingElements?: string[];
  priorityReason?: string;
  starterHint?: string;
};

type UniversalRule = {
  patterns: string[];
  phrase: string;
  reason: string;
  suggestion: string;
};

type ActivityOnlyRule = {
  activityCheck: (a: ActivityData) => boolean;
  patterns: string[];
  phrase: string;
  reason: string;
  suggestion: string;
  activityHint: string;
};

// ── 汎用NGワードルール（常に検出対象） ─────────────────────────────

const UNIVERSAL_RULES: UniversalRule[] = [
  {
    patterns: ['海外に興味'],
    phrase: '海外に興味がある',
    reason:
      '「海外」という範囲が広く、どの国・文化・出来事に関心を持ったのかが分からないため、他の受験生との差別化が難しいです。',
    suggestion:
      '「いつ、どこの国や文化に触れ、何に違和感や関心を持ったのか」を書くと具体性が増します。',
  },
  {
    patterns: ['異文化に興味', '異文化への興味', '異文化に触れたい'],
    phrase: '異文化に興味がある',
    reason:
      '「異文化」は漠然としており、具体的にどの文化のどの側面に引かれたかが伝わりません。',
    suggestion:
      '実際に経験した文化的な驚きや発見を、具体的なエピソードで示しましょう。',
  },
  {
    patterns: ['将来役立てたい', '将来に役立てたい', '将来活かしたい', '将来に活かしたい'],
    phrase: '将来役立てたい',
    reason:
      '何をどう役立てるのかが不明確で、どんな受験生でも書けるような表現になっています。',
    suggestion:
      '「〇〇の知識を使って、△△という課題に取り組みたい」のように具体的な活用場面を書きましょう。',
  },
  {
    patterns: [
      'コミュニケーション能力を高めたい',
      'コミュニケーション力を高めたい',
      'コミュニケーション能力を磨きたい',
    ],
    phrase: 'コミュニケーション能力を高めたい',
    reason:
      '「コミュニケーション能力」は曖昧で、どんな場面でどう向上させたいのかが伝わりません。',
    suggestion:
      '「〇〇な場面で△△が不足していると感じたので、□□を通じて改善したい」と具体化しましょう。',
  },
  {
    patterns: ['視野を広げたい', '視野を広げ'],
    phrase: '視野を広げたい',
    reason:
      '「視野」は比喩的で抽象的です。何を知ることで、どのような考え方ができるようになりたいのかが伝わりません。',
    suggestion:
      '「〇〇という分野の知見を得ることで、△△の問題をより多角的に考えられるようになりたい」と書くと明確になります。',
  },
  {
    patterns: ['国際的に活躍したい', '国際的に活躍'],
    phrase: '国際的に活躍したい',
    reason:
      '「国際的」という言葉は範囲が広く、具体的な活動や職種が見えないため印象に残りません。',
    suggestion:
      '「どの国で、どんな仕事を通じて、何を実現したいか」を具体的に書きましょう。',
  },
  {
    patterns: ['グローバルに活躍したい', 'グローバルに活躍'],
    phrase: 'グローバルに活躍したい',
    reason:
      '「グローバル」は使い古されており、受験生全員が使える差別化されない表現です。',
    suggestion:
      '「〇〇という問題を△△という形で解決するために、国境を越えた活動をしたい」と具体化しましょう。',
  },
  {
    patterns: ['様々な文化', 'さまざまな文化'],
    phrase: '様々な文化を学びたい',
    reason:
      '「様々な」という表現は何も特定していないため、強い動機として受け取られません。',
    suggestion:
      '具体的にどの国・地域の文化について、何が知りたいのかを書きましょう。',
  },
  {
    patterns: ['多様な価値観'],
    phrase: '多様な価値観を学びたい',
    reason:
      '「多様な価値観」も抽象的で、なぜそれが必要なのかが伝わりません。',
    suggestion:
      '「〇〇という経験から△△に疑問を持ち、それを解決するために異なる価値観に触れたい」と書きましょう。',
  },
  {
    patterns: ['貴学で学びたい', '貴学に入学したい'],
    phrase: '貴学で学びたい',
    reason:
      'どの志望理由書にも書けるコピペ表現です。なぜこの大学でなければならないのかが伝わりません。',
    suggestion:
      '「貴学の〇〇教授の△△研究」「□□というカリキュラム」「××という環境」など、具体的な理由を挙げましょう。',
  },
  {
    patterns: ['社会に貢献したい', '社会貢献したい'],
    phrase: '社会に貢献したい',
    reason:
      '「社会」は広すぎて、どの社会の誰に何をしたいのかが伝わらない表現です。',
    suggestion:
      '「〇〇という課題を抱える△△の人々に対して、□□という形で関わりたい」と絞り込みましょう。',
  },
  {
    patterns: ['人の役に立ちたい', '人々の役に立ちたい'],
    phrase: '人の役に立ちたい',
    reason: '善意は伝わりますが、誰の・何の役に立ちたいのかが不明確です。',
    suggestion:
      '「〇〇に悩む△△の人々に対して、□□という方法で力になりたい」と具体化しましょう。',
  },
  {
    patterns: ['成長したい', '成長できると'],
    phrase: '成長したい',
    reason:
      '「成長」という目標は曖昧で、どのような能力・知識・人間性を伸ばしたいのかが分かりません。',
    suggestion:
      '「〇〇という弱点を克服し、△△ができるようになりたい」と具体的に書きましょう。',
  },
  {
    patterns: ['学びたいです'],
    phrase: '学びたいです（単体）',
    reason:
      '何を・なぜ・どのように学びたいのかが書かれていないと、動機の弱さを示してしまいます。',
    suggestion:
      '「〇〇という問いに答えるために、△△を□□という方法で学びたい」と構造化しましょう。',
  },
  {
    patterns: ['魅力を感じました', '魅力を感じ'],
    phrase: '魅力を感じました',
    reason:
      '「魅力」の中身が書かれていないと、単なる印象論に見えてしまいます。',
    suggestion:
      '「〇〇という点が、自分の△△という経験と重なり、強く惹かれました」と具体化しましょう。',
  },
];

// ── 活動連動型NGルール（活動データが存在し、かつ本文にパターンがある場合） ───

const ACTIVITY_ONLY_RULES: ActivityOnlyRule[] = [
  {
    activityCheck: (a) => a.clubActivities.some((c) => c.role.trim() !== ''),
    patterns: [
      '協調性を学んだ',
      '協調性が身についた',
      'リーダーシップを学んだ',
      'リーダーシップを身につけた',
    ],
    phrase: '部活の役割があるのに能力を抽象的に表現している',
    reason:
      '部活での具体的な役割があるにもかかわらず、能力を曖昧な言葉だけで説明しています。',
    suggestion:
      '「どんな場面で、どんな行動をして、どんな結果になったか」という形で書きましょう。',
    activityHint:
      '部活での役割（入力済み）を活かせます。「〇〇という立場で△△という状況に直面し、□□という方法で対処した」という書き方で能力を具体的に示せます。',
  },
  {
    activityCheck: (a) => a.certificationActivities.length > 0,
    patterns: ['スキルを身につけたい', '能力を高めたい', '力をつけたい'],
    phrase: '資格取得経験があるのに能力向上を抽象的に書いている',
    reason:
      '既に資格取得という実績があるにもかかわらず、抽象的な能力向上の意欲にとどまっています。',
    suggestion:
      '取得した資格・勉強プロセス・得た知識を根拠として志望理由に組み込みましょう。',
    activityHint:
      '取得済みの資格（入力済み）を根拠にできます。「〇〇の資格取得を通じて△△を学び、大学でさらに□□を深めたい」という流れで書きましょう。',
  },
];

// ── 活動連動ヒント（汎用NG表現に追加で表示する） ─────────────────────

function getActivityHint(phrase: string, activities: ActivityData): string | undefined {
  const isAbroad =
    phrase === '海外に興味がある' ||
    phrase === '異文化に興味がある' ||
    phrase === '国際的に活躍したい' ||
    phrase === 'グローバルに活躍したい';
  if (isAbroad && activities.studyAbroadActivities.length > 0) {
    return 'あなたの「留学経験」と関連づけると、より説得力が出ます。留学先での具体的な体験を根拠として書いてみましょう。';
  }

  const isContribution =
    phrase === '社会に貢献したい' || phrase === '人の役に立ちたい';
  if (isContribution && activities.volunteerActivities.length > 0) {
    return 'あなたの「ボランティア経験」と関連づけると、抽象表現ではなく具体的な活動として伝えられます。現場で感じたことを書いてみましょう。';
  }

  const isLearning =
    phrase === '視野を広げたい' ||
    phrase === '様々な文化を学びたい' ||
    phrase === '多様な価値観を学びたい' ||
    phrase === '学びたいです（単体）';
  if (isLearning && activities.researchActivities.length > 0) {
    return 'あなたの「探究活動」と関連づけると、志望理由に一貫性が出ます。探究テーマを動機の核心に据えてみましょう。';
  }

  const isGrowth = phrase === '成長したい';
  if (isGrowth && activities.contestActivities.length > 0) {
    return 'あなたの「コンテスト経験」と関連づけると、「成長したい」の代わりに具体的な挑戦として伝えられます。';
  }
  if (isGrowth && activities.clubActivities.length > 0) {
    return 'あなたの「部活動経験」と関連づけると、具体的な行動・経験として書き直せます。';
  }

  return undefined;
}

// ── Quality Check ヘルパー ────────────────────────────────────────

function getSpecificityMissing(text: string): string[] {
  const missing: string[] = [];
  if (!/\d/.test(text))
    missing.push('数字・規模（どのくらいの大きさか）');
  if (!/[゠-ヿ]{3,}/.test(text))
    missing.push('固有名詞（どの場所・組織・プログラムの話か）');
  if (!/(高校|中学|小学|\d+年生|\d+ヶ月|\d+年間)/.test(text))
    missing.push('具体的な時期（いつの話か）');
  if (!/(大会|コンテスト|留学|実験|研究|インターン|ボランティア|部活)/.test(text))
    missing.push('活動名・組織名（何に取り組んだのか）');
  return missing;
}

function hasPersonalExperience(text: string): boolean {
  return [
    /取り組(んだ|みました)/,
    /経験(した|しました)/,
    /参加(した|しました)/,
    /挑戦(した|しました)/,
    /活動(した|しました)/,
    /体験(した|しました)/,
    /私は.{1,30}(した|しました)/,
    /(した|しました|していた)ことで/,
  ].some((p) => p.test(text));
}

function textMentionsTarget(text: string, target: string): boolean {
  if (!target) return false;
  if (text.includes(target)) return true;
  const stripped = target
    .replace(/(大学院?|大学|学部|学科|研究科)$/, '')
    .trim();
  return stripped.length >= 3 && text.includes(stripped);
}

function checkQuality(
  text: string,
  university: string,
  faculty: string
): NgWordIssue[] {
  const issues: NgWordIssue[] = [];
  const len = text.length;

  if (len < 5) return issues;

  // 1. 文字数チェック
  if (len < 300) {
    issues.push({
      phrase: '文章量不足',
      reason:
        len < 150
          ? `現在 ${len} 字です。志望理由書として説得力を持たせるには300字以上が目安です。このままでは内容が薄く見えてしまいます。`
          : `現在 ${len} 字です。志望理由書として説得力を持たせるには300字以上が目安です。`,
      suggestion:
        'きっかけ・課題・行動・学び・将来目標・大学との接続の6要素を意識して書くと、自然に文字数が増えます。',
      severity: len < 150 ? 'high' : 'medium',
      kind: 'quality',
      qualityType: 'length',
      priorityReason:
        `現在の文章は ${len} 文字です。志望理由書としては情報量が少なく、大学側があなたの経験や志望理由を判断しにくい状態です。`,
      starterHint:
        '「私は〇〇の経験から、△△に興味を持ちました。」',
    });
  }

  // 2. 具体性チェック（100字以上の文章のみ対象）
  if (len >= 100 && getSpecificityMissing(text).length >= 3) {
    issues.push({
      phrase: '具体性不足',
      reason:
        '数字・固有名詞・時期・場所・具体的な活動名など、「実際にあった出来事」と読み手が認識できる要素が少ないです。',
      suggestion:
        '「いつ（時期）」「どこで（場所・組織）」「何人で（規模）」「どんな結果（数字）」を1つでも入れると具体性が大きく上がります。',
      severity: 'medium',
      kind: 'quality',
      qualityType: 'specificity',
      priorityReason:
        '現在の文章には、具体的な時期・場所・活動名・数字などが少なく、経験のリアリティが伝わりにくい状態です。',
      missingElements: getSpecificityMissing(text),
      starterHint:
        '「特に印象に残っているのは、〇〇の場面です。」',
    });
  }

  // 3. 大学接続チェック（100字以上の文章のみ対象）
  const targets = [university.trim(), faculty.trim()].filter(Boolean);
  if (len >= 100 && targets.length > 0) {
    const anyMentioned = targets.some((t) => textMentionsTarget(text, t));
    if (!anyMentioned) {
      const missingTargets = targets.map((t) => `「${t}」の記載`);
      issues.push({
        phrase: '大学・学部との接続不足',
        reason: `「${targets.join('」「')}」が本文に一度も登場していません。なぜこの大学・学部でなければならないのかが伝わりません。`,
        suggestion:
          '大学名・学部名・教員名・カリキュラム名・設備など、この大学固有の情報を最低1つ入れましょう。',
        severity: 'medium',
        kind: 'quality',
        qualityType: 'universityConnection',
        priorityReason:
          '本文内に志望大学名・志望学部名との接続が弱く、「なぜこの大学なのか」が伝わりにくい状態です。',
        missingElements: [
          ...missingTargets,
          '教員・カリキュラム・設備などこの大学固有の情報',
        ],
        starterHint:
          '「この経験から、私は貴学の〇〇学部で△△を学びたいと考えました。」',
      });
    }
  }

  // 4. 経験不足チェック（100字以上の文章のみ対象）
  if (len >= 100 && !hasPersonalExperience(text)) {
    issues.push({
      phrase: '経験・行動不足',
      reason:
        '「私は〜した」「〜に取り組んだ」「〜を経験した」など、自分が実際に行動した表現が見当たりません。',
      suggestion:
        '「いつ・どこで・自分が何をしたか」という具体的な行動エピソードを1つ入れましょう。それだけで説得力が大きく変わります。',
      severity: 'medium',
      kind: 'quality',
      qualityType: 'experience',
      priorityReason:
        '現在の文章では、あなた自身が何をしたのか、どのように考えて行動したのかが見えにくい状態です。',
      missingElements: [
        '自分が実際に取った行動・工夫（何をしたのか）',
        'どんな課題・困難に向き合ったか（何が大変だったのか）',
        'その経験から何を考えたか（どう変わったのか）',
      ],
      starterHint:
        '「その時、私は〇〇という課題に対して、△△に取り組みました。」',
    });
  }

  return issues;
}

// ── メイン関数 ────────────────────────────────────────────────────

export function detectNgWords(
  text: string,
  activities: ActivityData | null,
  university = '',
  faculty = ''
): NgWordIssue[] {
  const issues: NgWordIssue[] = [];

  // Phase 1: 汎用NGワード検出
  for (const rule of UNIVERSAL_RULES) {
    if (!rule.patterns.some((p) => text.includes(p))) continue;
    const activityHint =
      activities !== null ? getActivityHint(rule.phrase, activities) : undefined;
    issues.push({
      phrase: rule.phrase,
      reason: rule.reason,
      suggestion: rule.suggestion,
      activityHint,
      severity: 'medium',
      kind: 'phrase',
    });
  }

  // Phase 2: 活動連動型NG検出（汎用ルールに含まれない専用パターン）
  if (activities !== null) {
    for (const rule of ACTIVITY_ONLY_RULES) {
      if (!rule.activityCheck(activities)) continue;
      if (!rule.patterns.some((p) => text.includes(p))) continue;
      issues.push({
        phrase: rule.phrase,
        reason: rule.reason,
        suggestion: rule.suggestion,
        activityHint: rule.activityHint,
        severity: 'medium',
        kind: 'phrase',
      });
    }
  }

  // Phase 3: 品質チェック（文字数・具体性・大学接続・経験）
  issues.push(...checkQuality(text, university, faculty));

  // 優先度が高いものを先頭へ
  return issues.sort((a, b) => {
    if (a.severity === 'high' && b.severity !== 'high') return -1;
    if (b.severity === 'high' && a.severity !== 'high') return 1;
    return 0;
  });
}
