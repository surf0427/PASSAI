import type { NgWordIssue } from '@/lib/detectNgWords';

export type QualityType = NonNullable<NgWordIssue['qualityType']>;

export type QualityMessage = {
  role: 'ai' | 'user' | 'feedback';
  content: string;
};

export type QualityDeepDiveQuestion = {
  question: string;
  feedbackAfterAnswer: string;
};

export type QualityDeepDiveConfig = {
  questions: [QualityDeepDiveQuestion, QualityDeepDiveQuestion, QualityDeepDiveQuestion];
  writingHint: string;
};

export const TOTAL_QUESTIONS = 3;

const CONFIGS: Record<QualityType, QualityDeepDiveConfig> = {
  length: {
    questions: [
      {
        question:
          '一番心に残っている経験は何ですか？その経験を選んだ理由も教えてください。',
        feedbackAfterAnswer:
          'いいですね。次は、その経験の中で感じた感情や違和感を深掘りしましょう。',
      },
      {
        question:
          'その経験の中で、強く感じたことや違和感は何でしたか？',
        feedbackAfterAnswer:
          'その視点は使えます。次に、それが今の志望とどうつながるかを整理しましょう。',
      },
      {
        question:
          'その経験が、今の志望理由にどうつながっていますか？',
        feedbackAfterAnswer: 'ここまで書ければ材料になります。',
      },
    ],
    writingHint:
      'この経験を通して何に気づき、なぜ志望につながったのかを一文で整理してみましょう。',
  },

  specificity: {
    questions: [
      {
        question:
          'その経験の中で、特に印象に残っている場面はいつ・どこで起きましたか？',
        feedbackAfterAnswer:
          'いいですね。次はなぜその場面が印象に残ったのかを深掘りしましょう。',
      },
      {
        question:
          'その場面で、あなたはなぜ強く印象に残ったと感じたのですか？',
        feedbackAfterAnswer:
          'その感覚が大切です。次に、それが今の志望とどうつながるかを考えましょう。',
      },
      {
        question:
          'その出来事がなければ、今の志望はどう違っていたと思いますか？',
        feedbackAfterAnswer: 'ここまで書ければ材料になります。',
      },
    ],
    writingHint:
      '具体的な場面 → 感じたこと → 志望理由への接続、の順で書くと伝わりやすくなります。',
  },

  experience: {
    questions: [
      {
        question: 'その時、あなたはなぜ行動しようと思ったのですか？',
        feedbackAfterAnswer:
          'いいですね。次は、実際に行動してみて何が難しかったかを振り返りましょう。',
      },
      {
        question:
          '実際に行動する中で、難しかったことや迷ったことは何ですか？',
        feedbackAfterAnswer:
          'その視点は使えます。次に、その経験が自分の考え方をどう変えたかを整理しましょう。',
      },
      {
        question:
          'その経験を通して、自分の考え方や価値観はどう変わりましたか？',
        feedbackAfterAnswer: 'ここまで書ければ材料になります。',
      },
    ],
    writingHint:
      '自分がなぜ行動したのか、行動後に何が変わったのかを中心に書きましょう。',
  },

  universityConnection: {
    questions: [
      {
        question: 'その大学・学部を選んだ一番の理由は何ですか？',
        feedbackAfterAnswer:
          'いいですね。次は、自分の経験・関心と大学の学びのつながりを深掘りしましょう。',
      },
      {
        question:
          '自分の経験や関心と、その大学で学べる内容はどこでつながっていますか？',
        feedbackAfterAnswer:
          'その接続が核心です。最後に、もしその経験がなかった場合を考えてみましょう。',
      },
      {
        question:
          'もしその経験がなかったら、今の志望大学・学部を選んでいたと思いますか？理由も教えてください。',
        feedbackAfterAnswer: 'ここまで書ければ材料になります。',
      },
    ],
    writingHint:
      '自分の経験と、その大学で学びたい内容を一対一でつなげて書きましょう。',
  },
};

export function getConfig(qualityType: QualityType): QualityDeepDiveConfig {
  return CONFIGS[qualityType];
}
