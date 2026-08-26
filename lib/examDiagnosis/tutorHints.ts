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
import { isExamType } from '@/types/examDiagnosis';

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

// ── legacy 4 タイプ（number）──────────────────────────────────────────
//
// `app/diagnosis/page.tsx` の RESULT_TYPES（1-4）に対応する旧診断の hint。
// Stage 5.2 まで `lib/contextBuilders/tutorContext.ts` の module private 定数だったが、
// Canonical Exam Context 側の diagnosis block が **同じ言い換え**を使う必要があるため、
// ExamType 版と同じ pure module へ移した（値は 1 文字も変えていない）。
//
// ★ 2 箇所に置かない ★
//   device / server / legacy / canonical のどれかで言い換えがずれると、
//   同じ診断結果から違う prompt が出る。正本はこの 1 箇所とする。
export const LEGACY_DIAGNOSIS_TYPE_HINTS: Readonly<Record<number, string>> = {
  1: '何から手をつけるかを一緒に整理していくと進みやすそうです',
  2: '経験を言語化する支援が役立ちそうです',
  3: '書類の完成度を一段上げる方向で整理すると進みやすそうです',
  4: '一般受験と並行しやすいよう、優先順位をつけて整理すると進みやすそうです',
};

/**
 * `diagnosis_logs.payload.resultType` → Tutor 会話補助 hint（純関数）。
 *
 * 2 系統を `typeof` で判別する:
 *   number（legacy 1-4）      → `LEGACY_DIAGNOSIS_TYPE_HINTS`
 *   string（ExamType 9 種）   → `EXAM_DIAGNOSIS_TYPE_HINTS`（`isExamType` で guard）
 *
 * ★ hint 以外は返さない ★
 *   タイプ名 / catchphrase / score / answers / 推薦大学 / NG 行動の生文は
 *   この関数の戻り値に現れない。呼び出し側が payload を直接読む必要をなくすことで、
 *   「うっかり resultTitle を prompt に載せる」経路を塞ぐ。
 *
 * どちらの系統でもなければ `null`（＝ diagnosis を使わない）。
 */
export function resolveDiagnosisTypeHint(resultType: unknown): string | null {
  if (typeof resultType === 'number') {
    return LEGACY_DIAGNOSIS_TYPE_HINTS[resultType] ?? null;
  }
  if (isExamType(resultType)) {
    return EXAM_DIAGNOSIS_TYPE_HINTS[resultType] ?? null;
  }
  return null;
}
