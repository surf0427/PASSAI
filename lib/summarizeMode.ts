// /api/summarize の mode 判定（純粋関数・client / server 共有）。
//
// 役割:
//   answers と deepAnswers の入力量から 'light' / 'deep' を都度算出する。
//   PersistedAnalyzeState には永続化せず、derived state として handleSummarize の度に再計算する。
//   永続化すると「answers を増やしたのに mode が古いまま固定」される事故が起きるため。
//
// 判定方針（MVP）:
//   1. 入力字数（answers と deepAnswers の trim 後合計） >= DEEP_MODE_THRESHOLD_CHARS
//      かつ
//   2. answers のうち空でないものが DEEP_MODE_MIN_FILLED 件以上
//   両方満たすときだけ 'deep'。それ以外は 'light'（保守的）。
//
// なぜ filledCount は answers のみ?:
//   「1 問だけ長文で他は未回答」を deep に誤判定させないため。deepAnswers は accordion 任意入力で、
//   そもそも回答していない人は触らない領域。filledCount の母数は main answers に限定する。
//
// const を export しているのは threshold を後で tune するため。

import type { SummarizeMode } from '@/types/analysis';

export const DEEP_MODE_THRESHOLD_CHARS = 250;
export const DEEP_MODE_MIN_FILLED = 3;

export function decideSummarizeMode(
  answers: string[],
  deepAnswers: string[] | undefined,
): SummarizeMode {
  const normalizedAnswers = answers.map((s) =>
    typeof s === 'string' ? s.trim() : '',
  );
  const normalizedDeepAnswers = (deepAnswers ?? []).map((s) =>
    typeof s === 'string' ? s.trim() : '',
  );

  const totalChars = [...normalizedAnswers, ...normalizedDeepAnswers].reduce(
    (sum, s) => sum + s.length,
    0,
  );

  const filledCount = normalizedAnswers.filter((s) => s.length > 0).length;

  if (
    totalChars >= DEEP_MODE_THRESHOLD_CHARS &&
    filledCount >= DEEP_MODE_MIN_FILLED
  ) {
    return 'deep';
  }
  return 'light';
}
