import type { InterviewQuestionFormData } from '../types';
import type { BasicInfo } from '@/types/basicInfo';

export type GeneratedQuestion = {
  category: string;
  question: string;
  answerTip: string;
};

// 受験方式に応じた追加質問。examTypes が複数選択されている場合は該当するものを併記する。
// テンプレート段階だが、将来 AI 化したときは buildBasicInfoPromptSection と組み合わせて使う想定。
function buildExamTypeQuestions(examTypes: string[] | undefined): GeneratedQuestion[] {
  const types = examTypes ?? [];
  const out: GeneratedQuestion[] = [];

  if (types.includes('学校推薦型選抜（公募・指定校）')) {
    out.push({
      category: '受験方式に関する質問（学校推薦型）',
      question: 'これまで評定平均や日々の学校生活で意識してきたことを教えてください。',
      answerTip: '推薦型は校内での姿勢・継続性を重視される。具体的な科目・取り組み・周囲との関わりを1つ挙げて、それを通じて何を学んだかまで話す。',
    });
  }
  if (types.includes('総合型選抜（AO入試）')) {
    out.push({
      category: '受験方式に関する質問（総合型）',
      question: 'あなたの活動・自己分析・志望理由は、一本の線でどうつながっていますか？',
      answerTip: '総合型は一貫性が最重要。「経験 → 気づき → 志望理由 → 将来像」の流れを30秒で言えるように整理しておく。',
    });
  }
  if (types.includes('一般選抜') || types.includes('共通テスト利用')) {
    out.push({
      category: '受験方式に関する質問（一般併願）',
      question: 'なぜ一般選抜だけでなく、推薦・総合型も併願しているのですか？',
      answerTip: '「保険」ではなく「この大学に行きたい強い意志」を語る。一般と推薦で評価される側面が違うことを理解している前置きを入れると説得力が出る。',
    });
  }
  if (types.includes('まだ決まっていない')) {
    out.push({
      category: '受験方式に関する質問',
      question: '現時点で受験方式が確定していないとのことですが、どのような基準で選ぼうと考えていますか？',
      answerTip: '迷っている事実は隠さず、選定基準（評定／活動実績／一般学力）を冷静に説明する。決断のための行動予定もセットで話せると良い。',
    });
  }
  return out;
}

// フォーム入力 + 基本情報をもとに、カテゴリ別予想質問を生成する。
// Claude API 接続前の暫定実装。将来 AI 化する際も同じ引数（formData, basicInfo）で差し替えられる。
export function generateInterviewQuestions(
  formData: InterviewQuestionFormData,
  basicInfo: BasicInfo | null = null,
): GeneratedQuestion[] {
  const university = formData.universityName || '志望校';
  const faculty = formData.facultyName || 'この学部';
  const futureGoals = formData.futureGoals || '目標';

  const baseQuestions: GeneratedQuestion[] = [
    {
      category: '志望理由に関する質問',
      question: `なぜ他大学ではなく、${university}の${faculty}を志望したのですか？`,
      answerTip: '大学名・学部名・自分の経験・将来目標を一本の線でつなげて答える。「この大学でなければならない理由」を具体的に伝えることがポイント。',
    },
    {
      category: '活動内容の深掘り質問',
      question: '活動の中で最も苦労したことと、それをどう乗り越えたか教えてください。',
      answerTip: '「状況→課題→自分の判断・行動→結果・学び」の順で話すと分かりやすい。感想だけで終わらず、自分が何を考えて動いたかを必ず入れる。',
    },
    {
      category: '大学・学部理解に関する質問',
      question: `${faculty}で学びたいことと、あなたの将来目標はどうつながっていますか？`,
      answerTip: '大学のカリキュラムや教授の専門分野など具体的な情報を調べた上で話す。「なんとなく学びたい」ではなく「この授業・研究が必要だから」と言える状態にしておく。',
    },
    {
      category: '将来目標に関する質問',
      question: `10年後、あなたはどのような仕事をしていたいですか？${university}での学びとどうつなげますか？`,
      answerTip: `「${futureGoals}」という目標を具体的な職種・社会貢献とあわせて話す。大学での学びがその目標にどう貢献するかを明確にすること。`,
    },
    {
      category: '弱点確認の質問',
      question: 'あなたの短所は何ですか？それをどう改善しようとしていますか？',
      answerTip: '短所を正直に認めた上で、改善のための具体的な行動を伝える。自己分析ができているかを見られているので、表面的な答えは避ける。',
    },
    {
      category: '圧迫気味の質問',
      question: `あなたの志望理由は、他の受験生と何が違うのですか？なぜあなたを合格させるべきだと思いますか？`,
      answerTip: '動揺せず落ち着いて答えることが最重要。自信の根拠を具体的なエピソードで示す。「私だけの経験・視点」を軸に答えると差別化しやすい。',
    },
  ];

  return [...baseQuestions, ...buildExamTypeQuestions(basicInfo?.examTypes)];
}
