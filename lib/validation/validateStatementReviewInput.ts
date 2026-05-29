import {
  containsPlaceholder,
  isEmpty,
  repeatedCharRatio,
  tooShort,
} from './rules/text';

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: 'EMPTY' | 'TOO_SHORT' | 'REPEATED_CHAR' | 'PLACEHOLDER';
      message: string;
    };

const MIN_LENGTH = 100;
const REPEATED_CHAR_GATE = 10;
const REPEATED_CHAR_THRESHOLD = 0.8;
const PLACEHOLDERS = ['未入力', 'あとで書く', '(仮)', '仮入力'] as const;

export function validateStatementReviewInput(essay: string): ValidationResult {
  if (isEmpty(essay)) {
    return {
      ok: false,
      code: 'EMPTY',
      message: '志望理由書本文を入力してください',
    };
  }
  if (tooShort(essay, MIN_LENGTH)) {
    return {
      ok: false,
      code: 'TOO_SHORT',
      message: '志望理由書本文をもう少し詳しく入力してください（100文字以上）',
    };
  }
  if (
    essay.length >= REPEATED_CHAR_GATE &&
    repeatedCharRatio(essay) >= REPEATED_CHAR_THRESHOLD
  ) {
    return {
      ok: false,
      code: 'REPEATED_CHAR',
      message:
        '同じ文字の繰り返しが多すぎます。志望理由書として読める内容を入力してください',
    };
  }
  if (containsPlaceholder(essay, PLACEHOLDERS)) {
    return {
      ok: false,
      code: 'PLACEHOLDER',
      message:
        '「未入力」「あとで書く」などの仮の文言が残っています。実際の本文を入力してください',
    };
  }
  return { ok: true };
}
