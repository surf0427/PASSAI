export type StructureElement =
  | 'trigger'
  | 'problem'
  | 'action'
  | 'learning'
  | 'future'
  | 'universityConnection';

export type StructureAnalysis = {
  type: StructureElement;
  exists: boolean;
  score: 0 | 1 | 2;
  reason: string;
  hint: string;
};

// ── 汎用ヘルパー ──────────────────────────────────────────────────

/** 数字・時期・場所・活動名などの具体的な要素がある */
function hasConcreteDetail(text: string): boolean {
  return (
    /\d/.test(text) ||
    /(高校|中学|小学|\d+年生|\d+ヶ月|\d+年間|先月|去年|昨年|幼い頃)/.test(text) ||
    /[゠-ヿ]{3,}/.test(text) || // カタカナ3文字以上（固有名詞）
    /(部活|クラブ|大会|コンテスト|留学|実験|研究|インターン|ボランティア|発表会|授業)/.test(text)
  );
}

/** 因果・接続の表現がある（経験→気づき→志望 のつながり） */
function hasCausalConnection(text: string): boolean {
  return /(そのため|だから|このため|そこで|その結果|この経験(から|を通して|により)|をきっかけ(に|として)|を通して|を通じて|によって|から気づ|から学|から考える)/.test(text);
}

/** 自分主体の行動表現がある */
function hasSelfAction(text: string): boolean {
  return /(私は.{0,30}(した|しました)|自分は.{0,30}(した|しました)|取り組(んだ|みました)|実践し(た|ました)|挑戦し(た|ました)|活動し(た|ました)|参加し(た|ました)|経験し(た|ました))/.test(text);
}

/** 大学・学部レベルの具体性がある（単なる「貴学」以上） */
function hasUniversitySpecificity(text: string): boolean {
  return /(教授|研究室|ゼミ|カリキュラム|学科|専攻|学びたい.{0,20}(理由|から|ため)|この大学(でなければ|だから|の)|なぜ(この|貴))/.test(text);
}

/** 価値観・考え方の変化が書かれている */
function hasValueChange(text: string): boolean {
  return /(価値観が変わ|考え方が変わ|気づ(いた|きました)|以前とは違|見方が変わ|改めて|ようになった|変わった|変化した|深まった)/.test(text);
}

// ── 各要素の score 判定 ───────────────────────────────────────────

function scoreTrigger(text: string): 0 | 1 | 2 {
  const hasKeyword = /(きっかけ|経験(し|を|が|から)|出来事|印象に残|出会(い|った)|体験)/.test(text);
  if (!hasKeyword) return 0;

  const isConcrete = hasConcreteDetail(text);
  const hasConnection = hasCausalConnection(text);
  if (isConcrete && hasConnection) return 2;
  return 1;
}

function scoreProblem(text: string): 0 | 1 | 2 {
  const hasKeyword = /(課題|問題意識|疑問|解決したい|変えたい|何とかしたい|難し(い|かった)|困(った|り)|悩(んだ|み))/.test(text);
  if (!hasKeyword) return 0;

  // 課題として言語化されている（単なる「大変」「難しい」だけでなく）
  const isArticulated = /(課題|問題意識|疑問を(持|感)|解決したい|変えたい|何とかしたい)/.test(text);
  const hasConnection = hasCausalConnection(text);
  if (isArticulated && (hasConnection || hasConcreteDetail(text))) return 2;
  return 1;
}

function scoreAction(text: string): 0 | 1 | 2 {
  const hasKeyword = /(取り組|実践|挑戦|活動|参加|行動|勉強|調べ|練習|やってみ|行(った|いました)|経験し)/.test(text);
  if (!hasKeyword) return 0;

  const isSelfAction = hasSelfAction(text);
  const hasSpecificAction = /(取り組(んだ|みました)|実践し(た|ました)|挑戦し(た|ました)|活動し(た|ました)|参加し(た|ました))/.test(text);
  const isConcrete = hasConcreteDetail(text);
  if ((isSelfAction || hasSpecificAction) && isConcrete) return 2;
  return 1;
}

function scoreLearning(text: string): 0 | 1 | 2 {
  const hasKeyword = /(学(んだ|びました|び)|気づ(い|き)|感じた|考えるよう|わかった|身につけ|得た)/.test(text);
  if (!hasKeyword) return 0;

  // 学びとして言語化されている（単なる感想でなく）
  const isArticulated = /(学(んだ|びました)|気づ(いた|きました)|気づきを|身につけ|改めて)/.test(text);
  const hasChange = hasValueChange(text);
  const hasConnection = hasCausalConnection(text);
  if (isArticulated && (hasChange || hasConnection)) return 2;
  return 1;
}

function scoreFuture(text: string): 0 | 1 | 2 {
  const hasKeyword = /(将来|卒業後|なりたい|目指|実現|役立て|活かし|貢献|社会(で|に)|職業)/.test(text);
  if (!hasKeyword) return 0;

  // 「社会に貢献したい」「役立てたい」だけは score 1
  const isVague = /^[^。]*?(社会に貢献したい|人の役に立ちたい|役立てたい|活かしたい)[^。]*?$/.test(text);
  if (isVague && !hasConcreteDetail(text)) return 1;

  // 具体的な分野・職業・活動領域がある
  const hasSpecific = hasConcreteDetail(text) || hasCausalConnection(text);
  const hasSpecificTarget = /(分野|職業|仕事|研究|活動|社会課題|教育|医療|環境|国際|地域|IT|テクノロジー|経営|法律|福祉)/.test(text);
  if (hasSpecific && hasSpecificTarget) return 2;
  if (/(将来|卒業後|なりたい|目指)/.test(text) && hasSpecific) return 2;
  return 1;
}

function scoreUniversityConnection(text: string): 0 | 1 | 2 {
  const hasKeyword = /(貴学|この大学|大学で学|学部で|専攻|教授|研究室|ゼミ|カリキュラム)/.test(text);
  if (!hasKeyword) return 0;

  // 「貴学で学びたい」「この大学に魅力を感じた」だけは score 1
  const hasSpecificity = hasUniversitySpecificity(text);
  const hasConnection = hasCausalConnection(text);
  const hasPersonalLink = /(自分の経験|この経験|から|ため|なぜなら|なぜ(この|貴))/.test(text) && hasKeyword;
  if (hasSpecificity && (hasConnection || hasPersonalLink)) return 2;
  return 1;
}

// ── 各要素の定義 ─────────────────────────────────────────────────

type ElementDef = {
  score: (text: string) => 0 | 1 | 2;
  reasons: { 2: string; 1: string; 0: string };
  hint: string;
};

const ELEMENT_DEFS: Record<StructureElement, ElementDef> = {
  trigger: {
    score: scoreTrigger,
    reasons: {
      2: '具体的な出来事や体験と、そこからのつながりが書かれています',
      1: '経験に関する表現はありますが、具体的な出来事や理由がもう少し欲しいです',
      0: 'この要素はまだ本文から読み取りにくいです',
    },
    hint: 'どんな出来事や体験がきっかけで、この志望につながったのかを書きましょう',
  },

  problem: {
    score: scoreProblem,
    reasons: {
      2: '課題意識と、その背景や理由が書かれています',
      1: '関連する表現はありますが、何が課題なのかをもう少し言語化できます',
      0: 'この要素はまだ本文から読み取りにくいです',
    },
    hint: '社会や自分自身の課題・問題意識と、そう感じた理由を書きましょう',
  },

  action: {
    score: scoreAction,
    reasons: {
      2: '自分がしたことが具体的に書かれています',
      1: '行動に触れていますが、何をどうしたのかをもう少し具体的に書けます',
      0: 'この要素はまだ本文から読み取りにくいです',
    },
    hint: 'あなた自身が取り組んだこと・経験したことを具体的に書きましょう',
  },

  learning: {
    score: scoreLearning,
    reasons: {
      2: '経験から得た学びと、考え方への影響が書かれています',
      1: '感想や学びの言葉はありますが、何がどう変わったかがもう少し欲しいです',
      0: 'この要素はまだ本文から読み取りにくいです',
    },
    hint: 'その経験を通して何に気づき、考え方がどう変わったかを書きましょう',
  },

  future: {
    score: scoreFuture,
    reasons: {
      2: '具体的な分野・目標と大学での学びへの接続が書かれています',
      1: '将来に触れていますが、具体的な分野や目標がもう少し欲しいです',
      0: 'この要素はまだ本文から読み取りにくいです',
    },
    hint: '大学で学んだことを将来どう活かしたいのか、具体的な分野や目標を書きましょう',
  },

  universityConnection: {
    score: scoreUniversityConnection,
    reasons: {
      2: 'この大学・学部での学びと、自分の経験や目標がつながっています',
      1: '大学に触れていますが、なぜこの大学でなければならないかがもう少し欲しいです',
      0: 'この要素はまだ本文から読み取りにくいです',
    },
    hint: '教員名・カリキュラム・研究内容など、この大学ならではの理由と、自分の経験とのつながりを書きましょう',
  },
};

// ── メイン関数 ────────────────────────────────────────────────────

export function analyzeStructure(text: string): StructureAnalysis[] {
  return (Object.keys(ELEMENT_DEFS) as StructureElement[]).map((type) => {
    const def = ELEMENT_DEFS[type];
    const score = def.score(text);
    return {
      type,
      exists: score > 0,
      score,
      reason: def.reasons[score],
      hint: def.hint,
    };
  });
}
