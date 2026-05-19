// 受験チューターAI 用 interview context の minimum section を作る純粋関数。
//
// 含める:
//   - latest questionsAndAnswers[0].question 冒頭（MAX_INTERVIEW_QUESTION_LENGTH 字）
//   - latest questionsAndAnswers[0].answer 冒頭（MAX_INTERVIEW_ANSWER_LENGTH 字）
//   - interviewFeedbackLatest.improvements[0]（MAX_INTERVIEW_ANSWER_LENGTH 字で truncate）
// 含めない:
//   - 全 Q&A ペア（latest 1 件のみ）
//   - betterAnswer（既存規約で AI 生成済み、tutor では再入力しない）
//   - followUpQuestions
//   - levelEvaluation（5 軸評価、tutor では不要）
//   - 数値評価
//
// 入力欠損・型不一致時は throw せず空文字を返す。

import {
  MAX_INTERVIEW_QUESTION_LENGTH,
  MAX_INTERVIEW_ANSWER_LENGTH,
} from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed === '') continue;
    out.push(trimmed);
  }
  return out;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

export function buildTutorInterviewContext(input: {
  interviewRecordLatest?: unknown | null;
  interviewFeedbackLatest?: unknown | null;
}): string {
  const lines: string[] = [];

  if (isPlainObject(input.interviewRecordLatest)) {
    const r = input.interviewRecordLatest;
    if (Array.isArray(r.questionsAndAnswers) && r.questionsAndAnswers.length > 0) {
      const first = r.questionsAndAnswers[0];
      if (isPlainObject(first)) {
        const question = safeString(first.question);
        const answer = safeString(first.answer);
        if (question) {
          lines.push(`質問: ${truncate(question, MAX_INTERVIEW_QUESTION_LENGTH)}`);
        }
        if (answer) {
          lines.push(`回答の冒頭: ${truncate(answer, MAX_INTERVIEW_ANSWER_LENGTH)}`);
        }
      }
    }
  }

  if (isPlainObject(input.interviewFeedbackLatest)) {
    const improvements = safeStringArray(input.interviewFeedbackLatest.improvements);
    if (improvements.length > 0) {
      lines.push(`直近の改善点: ${truncate(improvements[0], MAX_INTERVIEW_ANSWER_LENGTH)}`);
    }
  }

  if (lines.length === 0) return '';

  return ['【直近の面接練習】', ...lines].join('\n');
}
