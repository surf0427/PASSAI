// /api/interview-feedback の AI 出力 JSON normalize 層。
//
// 役割:
//   anthropic.messages.create() から返ってきた JSON.parse 後の unknown を、
//   InterviewFeedback shape に正規化する純粋関数群。
//   - perQuestionFeedback[].question / answer / followUpQuestions[].originalQuestion は
//     入力 questionsAndAnswers から server 側で補完する（AI に出力させない設計）。
//   - 各要素の missing field は安全な fallback 値で埋める。
//   - levelEvaluation の missing 軸は 'normal' フォールバック。
//   - questionNumber が範囲外なら配列 index に丸める。
//
// 切り出し経緯:
//   元は app/api/interview-feedback/route.ts に同居していたが、route.ts が肥大化していたため
//   切り出した。AI 呼び出し経路 / SYSTEM_PROMPT / feedbackToText（formatter）とは無関係で、
//   AI 出力をパースした後の defensive 正規化のみを担う。
//
// 注意:
//   - 戻り値 InterviewFeedback shape を変えてはいけない。downstream の feedbackToText /
//     localStorage 保存 / InterviewHistoryCard のパーサーがこの shape に依存している。
//   - sanitizeStringArray / normalizeLevelEvaluation / lookupPair は本 module 内 private。
//     外部から呼ぶのは fillEchoBackFromInput のみ。

import type { InterviewFeedback, Level, LevelEvaluation } from '@/types/interview';

// ── STEP2.2: AI echo back を server 側で補完する ──────────────────
// perQuestionFeedback[].question / answer と followUpQuestions[].originalQuestion は
// 「入力 questionsAndAnswers の値そのもの」なので AI に出力させず、ここで補完する。
// これにより output token を約 30% 削減できる（STEP2 調査ベース）。
//
// 出力 shape (InterviewFeedback) は不変。
// → feedbackToText / feedbackJson / previousFeedback 経路はすべて互換維持。
//
// AI が schema 違反で echo back を残してきても無視し、入力データ側を真実とする
// （次の AI 呼び出しで sourceless drift を防ぐ）。
//
// defensive guard:
//   - perQuestionFeedback / followUpQuestions が array でない → []
//   - 各要素の missing field → 安全な fallback 値で埋める
//   - questionNumber が範囲外 → index ベースに丸める
//   - levelEvaluation の missing 軸 → 'normal' フォールバック

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function normalizeLevelEvaluation(value: unknown): LevelEvaluation {
  const obj = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const safeLevel = (v: unknown): Level => (v === 'weak' || v === 'strong' ? v : 'normal');
  return {
    logical: safeLevel(obj.logical),
    concrete: safeLevel(obj.concrete),
    consistency: safeLevel(obj.consistency),
    originality: safeLevel(obj.originality),
    interviewReadiness: safeLevel(obj.interviewReadiness),
  };
}

// AI 出力の questionNumber と要素 index から、対応する input pair を引く。
// 信頼順: questionNumber が valid 範囲 → そのインデックス、ダメなら配列 index、ダメなら空文字 pair。
function lookupPair(
  qaPairs: { question: string; answer: string }[],
  questionNumber: unknown,
  index: number,
): { question: string; answer: string } {
  if (
    typeof questionNumber === 'number' &&
    Number.isInteger(questionNumber) &&
    questionNumber >= 1 &&
    questionNumber - 1 < qaPairs.length
  ) {
    return qaPairs[questionNumber - 1];
  }
  if (index >= 0 && index < qaPairs.length) return qaPairs[index];
  return { question: '', answer: '' };
}

export function fillEchoBackFromInput(
  raw: unknown,
  qaPairs: { question: string; answer: string }[],
): InterviewFeedback {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const overallEvaluation = typeof r.overallEvaluation === 'string' ? r.overallEvaluation : '';
  const goodPoints = sanitizeStringArray(r.goodPoints);
  const improvements = sanitizeStringArray(r.improvements);
  const nextPractice = sanitizeStringArray(r.nextPractice);

  const rawPerQ = Array.isArray(r.perQuestionFeedback) ? r.perQuestionFeedback : [];
  const perQuestionFeedback: InterviewFeedback['perQuestionFeedback'] = rawPerQ.map((item, i) => {
    const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    // perQuestionFeedback には questionNumber が schema 上含まれないため index ベースで補完。
    const pair = lookupPair(qaPairs, undefined, i);
    return {
      question: pair.question,
      answer: pair.answer,
      evaluation: typeof obj.evaluation === 'string' ? obj.evaluation : '',
      improvement: typeof obj.improvement === 'string' ? obj.improvement : '',
      betterAnswer: typeof obj.betterAnswer === 'string' ? obj.betterAnswer : '',
      levelEvaluation: normalizeLevelEvaluation(obj.levelEvaluation),
    };
  });

  const rawFollowUps = Array.isArray(r.followUpQuestions) ? r.followUpQuestions : [];
  const followUpQuestions: InterviewFeedback['followUpQuestions'] = rawFollowUps.map((item, i) => {
    const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const pair = lookupPair(qaPairs, obj.questionNumber, i);
    // questionNumber は AI 出力を優先、不正なら index+1 に丸める。
    const questionNumber =
      typeof obj.questionNumber === 'number' &&
      Number.isInteger(obj.questionNumber) &&
      obj.questionNumber >= 1
        ? obj.questionNumber
        : i + 1;
    return {
      questionNumber,
      originalQuestion: pair.question,
      followUps: sanitizeStringArray(obj.followUps),
    };
  });

  return {
    overallEvaluation,
    goodPoints,
    improvements,
    perQuestionFeedback,
    followUpQuestions,
    nextPractice,
  };
}
