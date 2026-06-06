// 受験タイプ診断（9タイプ ExamType）→ Tutor 会話補助 hint の単一情報源（純粋・依存なし）。
//
// ⚠️ Tutor へ渡してよいのはこの「傾向 hint」だけ。タイプ名 / catchphrase / 推薦大学 /
//    NG行動・失敗例の生文 / score / raw JSON は **一切渡さない**。各タイプの strategy
//    （強み起点）と ngBehavior（注意傾向）を、断定しない支援方針へ言い換えてある。
//
// server-only な lib/contextBuilders/tutorContext.ts から import される。pure module に
// 切り出してあるのは、scripts/exam-diagnosis-scoring-qa.ts が next/headers 連鎖を踏まずに
// hint の中身（タイプ名 / score 非混入）を検証できるようにするため。

import type { ExamType } from '@/types/examDiagnosis';

export const EXAM_DIAGNOSIS_TYPE_HINTS: Record<ExamType, string> = {
  riaju: '人や環境を活かしつつ、自分の軸を一緒に言語化していくと進みやすそうです',
  yutosei: '効率よく逆算できる強みを活かしつつ、独自性も一緒に引き出すと進みやすそうです',
  jiyujin: '興味を強みに活かしつつ、無理なく続けられる進め方を一緒に整理するとよさそうです',
  kyoyo: '考える力を活かしつつ、早めに形にして出していく後押しが役立ちそうです',
  kaigai: '広い視野を活かしつつ、自分の経験と結びつけて語れるよう一緒に整理するとよさそうです',
  challenger: '挑戦する力を活かしつつ、ひとつの成果に深めていく支援が役立ちそうです',
  gariben: '積み上げる力を活かしつつ、努力の方向を一緒に確認していくと進みやすそうです',
  kakumeika: '問題意識を活かしつつ、自分の体験に結びつけて具体化する支援が役立ちそうです',
  creator: '表現する力を活かしつつ、中身を先に固めてから伝える進め方が役立ちそうです',
};
