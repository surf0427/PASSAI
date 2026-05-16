// InterviewFeedback JSON の runtime type guard。
//
// 役割:
//   localStorage 由来の feedbackJson を JSON.parse した値を、
//   buildStatementImprovementHints へ流す前に「最低限の安全性」だけ確認する。
//
// スコープ:
//   - builder が実際に読むフィールドは厳密に検証する
//     improvements / perQuestionFeedback[].improvement /
//     levelEvaluation.concrete / levelEvaluation.consistency /
//     followUpQuestions[].followUps / nextPractice (存在する場合)
//   - 他のフィールド（overallEvaluation / goodPoints / betterAnswer 等）は
//     旧記録との互換性のため緩く扱う（存在しなくても guard を通す）
//
// 制約:
//   - pure function。AI / fetch / storage / DOM に触れない
//   - zod / yup 等のライブラリは導入しない
//
// 関連:
//   types/interview.ts(InterviewFeedback)
//   lib/interview/buildStatementImprovementHints.ts(消費者)

import type { InterviewFeedback, Level } from '@/types/interview';

const LEVELS: readonly Level[] = ['strong', 'normal', 'weak'];

export function isInterviewFeedback(value: unknown): value is InterviewFeedback {
  if (!isPlainObject(value)) return false;

  // builder が直接読むフィールド ─ 厳密チェック
  if (!isStringArray(value.improvements)) return false;

  if (!Array.isArray(value.perQuestionFeedback)) return false;
  if (!value.perQuestionFeedback.every(isPerQuestionFeedbackItem)) return false;

  if (!Array.isArray(value.followUpQuestions)) return false;
  if (!value.followUpQuestions.every(isFollowUpQuestionItem)) return false;

  // nextPractice は型上は必須だが、旧記録との互換のため
  // 「存在する場合は string[] であること」だけ確認する。
  if (value.nextPractice !== undefined && !isStringArray(value.nextPractice)) {
    return false;
  }

  return true;
}

// ── 内部 helper ───────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string');
}

function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

// levelEvaluation のうち builder が読むのは concrete / consistency のみ。
// 他軸（logical / originality / interviewReadiness）は旧記録との互換のため緩く扱う。
function isLevelEvaluationShape(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!isLevel(value.concrete)) return false;
  if (!isLevel(value.consistency)) return false;
  return true;
}

function isPerQuestionFeedbackItem(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value.improvement !== 'string') return false;
  if (!isLevelEvaluationShape(value.levelEvaluation)) return false;
  return true;
}

function isFollowUpQuestionItem(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!isStringArray(value.followUps)) return false;
  return true;
}
