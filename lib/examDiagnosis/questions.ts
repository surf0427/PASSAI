// 受験タイプ診断（9タイプ）の質問データ — 15問・各4択。
// 移植元: juken-shindan/data/questions.ts（content verbatim、import path のみ PASSAI 用に変更）。
// 1選択肢が複数タイプへ重み（3 or 1）を配る。配点モデルは lib/examDiagnosis/scoring.ts 参照。

import type { ExamQuestion } from '@/types/examDiagnosis';

export const EXAM_QUESTIONS: ExamQuestion[] = [
  {
    id: 1,
    text: '理想の大学生活は？',
    options: [
      { text: '友達と楽しくすごす', points: [{ type: 'riaju', score: 3 }, { type: 'jiyujin', score: 1 }] },
      { text: '成功につながることをする', points: [{ type: 'yutosei', score: 3 }] },
      { text: '自由で面白いことをする', points: [{ type: 'jiyujin', score: 3 }, { type: 'kakumeika', score: 1 }] },
      { text: '自分の好きなことに没頭する', points: [{ type: 'creator', score: 3 }, { type: 'jiyujin', score: 1 }] },
    ],
  },
  {
    id: 2,
    text: '周りから言われる性格は？',
    options: [
      { text: '明るい', points: [{ type: 'riaju', score: 3 }, { type: 'kaigai', score: 1 }] },
      { text: '行動力がある', points: [{ type: 'challenger', score: 3 }] },
      { text: '個性的である', points: [{ type: 'jiyujin', score: 3 }, { type: 'creator', score: 1 }] },
      { text: '真面目だ', points: [{ type: 'gariben', score: 3 }] },
    ],
  },
  {
    id: 3,
    text: '魅力的な授業',
    options: [
      { text: '留学交流', points: [{ type: 'kaigai', score: 3 }] },
      { text: '実践的な授業', points: [{ type: 'challenger', score: 3 }, { type: 'yutosei', score: 1 }] },
      { text: '自由な授業', points: [{ type: 'jiyujin', score: 3 }, { type: 'creator', score: 1 }] },
      { text: '専門的な授業', points: [{ type: 'kyoyo', score: 3 }, { type: 'gariben', score: 1 }] },
    ],
  },
  {
    id: 4,
    text: 'どっちの状況が一番ワクワクする？',
    options: [
      { text: '友達と何かやる', points: [{ type: 'riaju', score: 3 }, { type: 'creator', score: 1 }] },
      { text: '成功できそうな挑戦', points: [{ type: 'challenger', score: 3 }, { type: 'yutosei', score: 1 }] },
      { text: '誰もやってないこと', points: [{ type: 'challenger', score: 3 }, { type: 'kakumeika', score: 1 }] },
      { text: '1つのことを極める', points: [{ type: 'kyoyo', score: 3 }, { type: 'gariben', score: 1 }] },
    ],
  },
  {
    id: 5,
    text: '大学選びで1番重要視するところは？',
    options: [
      { text: '雰囲気が良い', points: [{ type: 'riaju', score: 3 }, { type: 'kaigai', score: 1 }] },
      { text: '成功できる環境だ', points: [{ type: 'yutosei', score: 3 }] },
      { text: '自由な校風だ', points: [{ type: 'jiyujin', score: 3 }, { type: 'creator', score: 1 }] },
      { text: '学問が専門的だ', points: [{ type: 'kyoyo', score: 3 }, { type: 'gariben', score: 1 }] },
    ],
  },
  {
    id: 6,
    text: '留学について',
    options: [
      { text: '絶対行きたい', points: [{ type: 'kaigai', score: 3 }] },
      { text: '興味ある', points: [{ type: 'challenger', score: 3 }, { type: 'kaigai', score: 1 }] },
      { text: 'あまり興味ない', points: [{ type: 'gariben', score: 3 }] },
      { text: '日本で勉強', points: [{ type: 'kyoyo', score: 3 }] },
    ],
  },
  {
    id: 7,
    text: '好きな授業テーマは？',
    options: [
      { text: '世界の文化について', points: [{ type: 'kaigai', score: 3 }] },
      { text: 'ビジネスについて', points: [{ type: 'yutosei', score: 3 }, { type: 'challenger', score: 1 }] },
      { text: '社会問題について', points: [{ type: 'kakumeika', score: 3 }] },
      { text: '科学について', points: [{ type: 'kyoyo', score: 3 }] },
    ],
  },
  {
    id: 8,
    text: '将来の理想的な働き方は？',
    options: [
      { text: '楽しく働く', points: [{ type: 'riaju', score: 3 }, { type: 'creator', score: 1 }] },
      { text: 'お金を稼ぐ', points: [{ type: 'yutosei', score: 3 }] },
      { text: '社会を変える', points: [{ type: 'kakumeika', score: 3 }] },
      { text: '専門職', points: [{ type: 'kyoyo', score: 3 }] },
    ],
  },
  {
    id: 9,
    text: '好きな教科は？',
    options: [
      { text: '英語', points: [{ type: 'kaigai', score: 3 }] },
      { text: '社会', points: [{ type: 'kakumeika', score: 3 }] },
      { text: '国語', points: [{ type: 'creator', score: 3 }] },
      { text: '数学理科', points: [{ type: 'gariben', score: 3 }] },
    ],
  },
  {
    id: 10,
    text: '大学でサークルに入るなら？',
    options: [
      { text: 'スポーツやイベントで盛り上がるサークル', points: [{ type: 'riaju', score: 3 }, { type: 'challenger', score: 1 }] },
      { text: '資格・勉強系サークル', points: [{ type: 'challenger', score: 3 }, { type: 'yutosei', score: 1 }] },
      { text: '音楽・映像・デザインなど制作系サークル', points: [{ type: 'creator', score: 3 }, { type: 'kakumeika', score: 1 }] },
      { text: '旅・ゲーム・趣味など自由なサークル', points: [{ type: 'jiyujin', score: 3 }, { type: 'kakumeika', score: 1 }] },
    ],
  },
  {
    id: 11,
    text: 'クラスでの立ち位置は？',
    options: [
      { text: '友達が多い', points: [{ type: 'riaju', score: 3 }, { type: 'kaigai', score: 1 }] },
      { text: 'リーダー的な役回り', points: [{ type: 'yutosei', score: 3 }, { type: 'challenger', score: 1 }] },
      { text: '面白い人', points: [{ type: 'creator', score: 3 }, { type: 'kakumeika', score: 1 }] },
      { text: '静かな努力型', points: [{ type: 'gariben', score: 3 }] },
    ],
  },
  {
    id: 12,
    text: '学祭や学校イベントでやるなら、どれが一番楽しそう？',
    options: [
      { text: 'みんなで盛り上がる企画', points: [{ type: 'riaju', score: 3 }, { type: 'kaigai', score: 1 }] },
      { text: '結果が出そうな企画', points: [{ type: 'yutosei', score: 3 }, { type: 'challenger', score: 1 }] },
      { text: 'ポスターや動画を作る役', points: [{ type: 'creator', score: 3 }, { type: 'kakumeika', score: 1 }] },
      { text: '裏で準備を整える役', points: [{ type: 'gariben', score: 3 }] },
    ],
  },
  {
    id: 13,
    text: '学校で「もっとこうなったらいいのに」と思うのは？',
    options: [
      { text: '海外や他校との交流がもっと増える', points: [{ type: 'kaigai', score: 3 }, { type: 'challenger', score: 1 }] },
      { text: '将来に役立つ授業がもっと増える', points: [{ type: 'yutosei', score: 3 }] },
      { text: '校則やルールがもっと自由になる', points: [{ type: 'jiyujin', score: 3 }, { type: 'creator', score: 1 }] },
      { text: '静かで勉強のしやすい環境になる', points: [{ type: 'gariben', score: 3 }] },
    ],
  },
  {
    id: 14,
    text: '理想の学び方は？',
    options: [
      { text: '人と話し合いながら学ぶ', points: [{ type: 'riaju', score: 3 }, { type: 'creator', score: 1 }] },
      { text: '実践的に学ぶ', points: [{ type: 'challenger', score: 3 }, { type: 'yutosei', score: 1 }] },
      { text: '複数の分野を組み合わせて新しい考えを生みたい', points: [{ type: 'kakumeika', score: 3 }] },
      { text: 'ひとつのことを深く学ぶ', points: [{ type: 'kyoyo', score: 3 }] },
    ],
  },
  {
    id: 15,
    text: '憧れる人',
    options: [
      { text: '人気者', points: [{ type: 'riaju', score: 3 }, { type: 'creator', score: 1 }] },
      { text: '成功者', points: [{ type: 'yutosei', score: 3 }] },
      { text: '社会活動家', points: [{ type: 'kakumeika', score: 3 }] },
      { text: '研究者', points: [{ type: 'kyoyo', score: 3 }] },
    ],
  },
];
