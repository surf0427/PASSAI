// /api/analysis 初期 5 問の deterministic catalog。
//
// 役割:
//   ActivityData から初期 5 問を deterministic に生成する。AI に質問生成を委ねていた旧経路の
//   置き換え（responsibility (B) の deterministic 化）。出力は WallHittingResult.questions と
//   同じ `【カテゴリ】質問文` shape を完全に維持する。
//
// 5 軸（順序固定）:
//   1. 【動機】 - なぜ始めたか
//   2. 【課題】 - 何が難しかったか
//   3. 【行動】 - どう取り組んだか
//   4. 【成果】 - 何を得たか
//   5. 【将来】 - 志望にどうつながるか
//
// 受験生タイプ ApplicantType の推定は AI 側の責務として残るため本 catalog では扱わない。
//
// 不変条件:
//   - 返却件数は必ず 5 件（旧 AI 出力の questions と同じ）
//   - 各要素は `【カテゴリ】本文` の string shape
//   - summarizePrompt.ts の QA section は本 catalog の文字列をそのままラベルとして使うため、
//     文面は短く・自然な敬体で揃える

import type { ActivityData, Activity } from '@/types/activity';

type ActivityKind = Activity['type'];

// 同数の場合は本 KIND_ORDER 上で先に来る kind を採用する。
// 探究 / コンテスト / 留学を上位に置き、汎用的な部活 / ボランティアより
// 「自己分析素材として深掘り価値の高い」順に並べる。
const KIND_ORDER: ActivityKind[] = [
  'research',
  'contest',
  'studyAbroad',
  'club',
  'volunteer',
  'partTimeJob',
  'other',
  'hobby',
  'reading',
  'certification',
];

// 各 ActivityKind に対する 5 問テンプレート。category prefix を含む完成形を返す。
// テンプレが summarizePrompt の QA section へそのまま渡るため、各文は 1 文 70 字以内・
// 自然な敬体に揃える。質問の主題は活動種別に合わせるが、設問順は常に 5 軸固定。
const KIND_TEMPLATES: Record<ActivityKind, string[]> = {
  club: [
    '【動機】その部活を始めた最初のきっかけと、続けている理由を教えてください。',
    '【課題】活動の中で一番苦労した場面と、その背景にあった事情は何でしたか。',
    '【行動】その課題に対して、自分でどんな工夫や役割の取り方を試しましたか。',
    '【成果】活動を通じて見えてきた自分の成長や、周囲との関係の変化はありますか。',
    '【将来】この経験が志望学部での学びや将来の目標とどう結びついていますか。',
  ],
  volunteer: [
    '【動機】そのボランティアに参加しようと思った直接のきっかけは何でしたか。',
    '【課題】活動中に「うまく届かない」「難しい」と感じた瞬間はどこにありましたか。',
    '【行動】対象の人や場所に合わせて自分で工夫したことを具体的に教えてください。',
    '【成果】活動を通じて変わった自分の価値観や視点があれば教えてください。',
    '【将来】社会との関わり方として、この経験を志望先でどう発展させたいですか。',
  ],
  studyAbroad: [
    '【動機】留学先・プログラムを選んだ理由と、出発前に持っていた期待を教えてください。',
    '【課題】現地で一番戸惑った場面と、その時に自分が感じていたことを教えてください。',
    '【行動】言語や文化の壁を越えるために自分から取った行動は何ですか。',
    '【成果】帰国後に変わった考え方や、新しく身についた力を挙げてください。',
    '【将来】この経験を志望学部や将来の進路にどう接続させたいですか。',
  ],
  research: [
    '【動機】その探究テーマに惹かれた最初の問いや違和感は何でしたか。',
    '【課題】仮説や方法を考える過程で行き詰まった瞬間はどこでしたか。',
    '【行動】調査・分析を進めるために、どんな方法や情報源を選びましたか。',
    '【成果】探究を通して得られた結論と、自分の中に残った新しい問いは何ですか。',
    '【将来】この探究の延長として、志望学部でさらに深めたい問いを教えてください。',
  ],
  partTimeJob: [
    '【動機】そのアルバイトを選んだ理由と、最初に意識していた目的を教えてください。',
    '【課題】業務の中で「人とどう関わるか」で悩んだ場面はどこでしたか。',
    '【行動】仕事の質を上げるために、自分から行った工夫を具体的に教えてください。',
    '【成果】働く中で気づいた自分の強み・弱みは何ですか。',
    '【将来】社会人としての姿勢として、この経験を志望先でどう活かしたいですか。',
  ],
  contest: [
    '【動機】そのコンテストに挑戦しようと思ったきっかけは何でしたか。',
    '【課題】準備や本番で「ここが越えにくい」と感じた点はどこでしたか。',
    '【行動】結果に向けて、自分で立てた戦略や練習内容を教えてください。',
    '【成果】結果を踏まえて、自分の取り組み方で評価できる点・改善点は何ですか。',
    '【将来】この挑戦は、志望学部や将来やりたいことにどう繋がりますか。',
  ],
  reading: [
    '【動機】その本を手に取った理由と、読み始める前の自分の関心を教えてください。',
    '【課題】読み進める中で「分からない」「違和感がある」と感じた箇所はどこですか。',
    '【行動】内容を深めるために、自分で調べたり考えを言葉にしたことはありますか。',
    '【成果】読後に変わった考え方や、新しく持つようになった視点は何ですか。',
    '【将来】この本から得た視点を、志望学部での学びにどう活かしたいですか。',
  ],
  hobby: [
    '【動機】その趣味を続けている理由と、自分にとっての位置づけを教えてください。',
    '【課題】続ける中で「マンネリ」「壁」と感じた時期はありましたか。',
    '【行動】上達や継続のために自分で取り入れている工夫は何ですか。',
    '【成果】趣味を通して身についたスキルや、価値観の変化は何ですか。',
    '【将来】この継続性や工夫を志望学部や進路にどう繋げたいですか。',
  ],
  certification: [
    '【動機】その資格を取ろうと思った直接のきっかけは何でしたか。',
    '【課題】学習の途中で一番苦労した範囲や、習慣作りの難しさはどこでしたか。',
    '【行動】継続的に学ぶために自分で取り入れた方法を具体的に教えてください。',
    '【成果】資格取得を通して得られた力や、学び方の発見は何ですか。',
    '【将来】この資格を志望学部や将来の進路にどう活かしたいですか。',
  ],
  other: [
    '【動機】その活動を始めた最初のきっかけと、続けている理由を教えてください。',
    '【課題】活動の中で一番苦労した場面と、その時に感じていたことは何でしたか。',
    '【行動】その課題に対して、自分で工夫したことや取った行動を教えてください。',
    '【成果】活動を通じて得られた力や、自分の中で変わったことは何ですか。',
    '【将来】この経験を志望学部での学びや将来にどう接続させたいですか。',
  ],
};

// 活動配列がすべて空（validateAnalysisInput を通った free-text のみのケース等）に備える
// generic 5 問。文字数下限は validateAnalysisInput で担保されているため、ここではテンプレが
// 必ず 5 件返ることだけ保証する。
const GENERIC_TEMPLATES: string[] = [
  '【動機】今までで一番「自分から動いた」経験と、そのきっかけを教えてください。',
  '【課題】その経験の中で乗り越えにくかった壁は何で、なぜ難しかったですか。',
  '【行動】その壁に対して自分が選んだ行動・工夫を具体的に教えてください。',
  '【成果】その経験を通じて、自分の中で変わった価値観や強みは何ですか。',
  '【将来】この経験を志望学部・将来の方向性にどう接続させたいですか。',
];

function pickPrimaryActivityKind(data: ActivityData): ActivityKind | null {
  const counts: Record<ActivityKind, number> = {
    club: data.clubActivities.length,
    volunteer: data.volunteerActivities.length,
    studyAbroad: data.studyAbroadActivities.length,
    research: data.researchActivities.length,
    partTimeJob: data.partTimeJobActivities.length,
    certification: data.certificationActivities.length,
    contest: data.contestActivities.length,
    reading: data.readingActivities.length,
    hobby: data.hobbyActivities.length,
    other: data.otherActivities.length,
  };
  let best: ActivityKind | null = null;
  let bestCount = 0;
  for (const kind of KIND_ORDER) {
    if (counts[kind] > bestCount) {
      best = kind;
      bestCount = counts[kind];
    }
  }
  return best;
}

export function buildInitialQuestions(activityData: ActivityData): string[] {
  const primary = pickPrimaryActivityKind(activityData);
  if (primary === null) return [...GENERIC_TEMPLATES];
  return [...KIND_TEMPLATES[primary]];
}
