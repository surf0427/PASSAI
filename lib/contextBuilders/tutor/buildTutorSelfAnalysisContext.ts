// 受験チューターAI 用 self-analysis (壁打ち) context を作る純粋関数。
//
// 含める:
//   - wallHittingResult.questions[0]（truncate しない — 壁打ち質問は短文の前提）
//   - wallHittingResult.answers[0] 冒頭（MAX_SELF_ANALYSIS_ANSWER_LENGTH 字、optional）
// 含めない:
//   - 全質問配列 / 全回答配列（latest 1 件のみ）
//   - additionalQuestions
//   - summarize cache
//   - StudentProfile 全体（別 builder 経由）
//
// 入力欠損・型不一致時は throw せず空文字を返す。

import { MAX_SELF_ANALYSIS_ANSWER_LENGTH } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function buildTutorSelfAnalysisContext(input: unknown): string {
  if (!isPlainObject(input)) return '';

  const questions = safeStringArray(input.questions);
  const answers = safeStringArray(input.answers);

  const lines: string[] = [];
  if (questions.length > 0) {
    lines.push(`直近の壁打ち質問: ${questions[0]}`);
  }
  if (answers.length > 0) {
    lines.push(`自分の回答メモ: ${truncate(answers[0], MAX_SELF_ANALYSIS_ANSWER_LENGTH)}`);
  }

  if (lines.length === 0) return '';

  return ['【自己分析の進捗】', ...lines].join('\n');
}
