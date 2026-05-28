import type { InterviewQuestionFormData } from '../types';
import type { GeneratedQuestion } from './generateInterviewQuestions';

type QuestionTemplate = {
  question: (params: { university: string; faculty: string; futureGoals: string }) => string;
  answerTip: string;
};

// 志望理由に関する追加質問プール
const MOTIVATION_POOL: QuestionTemplate[] = [
  {
    question: ({ university, faculty }) =>
      `${university}の${faculty}と似た専攻は他大学にもありますが、なぜ${university}でなければならないのですか？`,
    answerTip:
      'オープンキャンパス・説明会・パンフレットで得た「この大学ならでは」の情報を具体的に挙げる。カリキュラム・教授・環境など。',
  },
  {
    question: ({ faculty }) =>
      `${faculty}への関心はいつ頃、どのようなきっかけで生まれましたか？`,
    answerTip:
      '具体的な体験・出来事・読んだ本・出会った人物などと結びつけると説得力が増す。「なんとなく好き」では終わらせない。',
  },
  {
    question: ({ faculty, futureGoals }) =>
      `将来「${futureGoals}」を目指す上で、${faculty}での学びが必要な理由を教えてください。`,
    answerTip:
      '「目標→必要な知識・スキル→学部で学べること」の順で話すと論理的に伝わる。他の方法ではなくこの学部である理由を明確に。',
  },
  {
    question: ({ university }) =>
      `もし${university}に不合格だった場合、あなたの進路はどうしますか？`,
    answerTip:
      '動揺を見せず、「目標に向かって別の手段で進む」意志を示す。大学ではなく「何を学びたいか」が本質だと伝える。',
  },
];

// 活動内容の深掘り追加質問プール
const ACTIVITY_POOL: QuestionTemplate[] = [
  {
    question: () =>
      '活動の中で最大の失敗は何でしたか？そこからどう立て直しましたか？',
    answerTip:
      '失敗そのものより「その後の行動と学び」が評価される。事実→自分の反省→次の行動の流れで話す。',
  },
  {
    question: () =>
      'チームや集団の中で、あなたはどんな役割を担っていましたか？それは自分から選んだ役割ですか？',
    answerTip:
      '役割の名前だけでなく「なぜその役割を担ったか」「そこでの具体的な行動」まで話すと深みが出る。',
  },
  {
    question: ({ faculty }) =>
      `その活動で得た経験や視点は、${faculty}での学びにどう活かせると思いますか？`,
    answerTip:
      '活動で得た「考え方・姿勢・視点」を学問・研究と結びつける。直接関係がなくても思考プロセスで繋げられる。',
  },
  {
    question: () =>
      '活動を続ける中で、自分の限界や苦手に気づいた瞬間はありましたか？それをどう補いましたか？',
    answerTip:
      '弱みを正直に認めつつ「どう補ったか・克服しようとしたか」まで話す。自己分析力をアピールするチャンスにする。',
  },
];

// 大学・学部理解に関する追加質問プール
const UNIVERSITY_POOL: QuestionTemplate[] = [
  {
    question: ({ university, faculty }) =>
      `${university}の${faculty}のカリキュラムや授業の特色について、知っていることを教えてください。`,
    answerTip:
      'シラバス・オープンキャンパス・公式サイトで確認した内容を具体的に挙げる。「なんとなく良さそう」は禁物。',
  },
  {
    question: ({ university, faculty }) =>
      `${university}の${faculty}で、特に関心のある研究室・ゼミ・教授はいますか？`,
    answerTip:
      '教授名・研究テーマまで言えると本気度が伝わる。見つかっていない場合は「現在調べています」という姿勢を見せる。',
  },
  {
    question: ({ faculty }) =>
      `${faculty}での4年間で、どのような知識やスキルを身につけたいですか？`,
    answerTip:
      '卒業後の姿と学部での学びを結びつける。「データ分析力」「英語力」など具体的なスキルを挙げると良い。',
  },
  {
    question: ({ university }) =>
      `${university}が大切にしている教育理念や特色について、あなたはどう理解していますか？`,
    answerTip:
      'アドミッションポリシー・建学の精神などを事前に調べておく。「〜という理念に共感している、なぜなら…」の形で話す。',
  },
];

const POOL_MAP: Record<string, QuestionTemplate[]> = {
  '志望理由に関する質問': MOTIVATION_POOL,
  '活動内容の深掘り質問': ACTIVITY_POOL,
  '大学・学部理解に関する質問': UNIVERSITY_POOL,
};

// 「さらに質問を生成する」ボタンを表示するカテゴリ
export const EXPANDABLE_CATEGORIES = Object.keys(POOL_MAP);

// alreadyGenerated: すでに追加済みの問数（プールを循環して重複しないようにする）。
// 旧 signature には AI 化拡張用の `_basicInfo: BasicInfo | null` 引数があったが、現状の
// deterministic テンプレート実装では未使用のため、no-unused-vars 解消を兼ねて削除した。
// 将来 AI 化する STEP では必要に応じて再追加する。
export function generateAdditionalQuestions(
  category: string,
  formData: InterviewQuestionFormData,
  alreadyGenerated: number,
  count = 1,
): GeneratedQuestion[] {
  const pool = POOL_MAP[category];
  if (!pool || pool.length === 0) return [];

  const params = {
    university: formData.universityName || '志望校',
    faculty: formData.facultyName || 'この学部',
    futureGoals: formData.futureGoals || '目標',
  };

  return Array.from({ length: count }, (_, i) => {
    const template = pool[(alreadyGenerated + i) % pool.length];
    return {
      category,
      question: template.question(params),
      answerTip: template.answerTip,
    };
  });
}
