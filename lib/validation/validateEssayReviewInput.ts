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

const MIN_LENGTH = 80;
const REPEATED_CHAR_GATE = 10;
const REPEATED_CHAR_THRESHOLD = 0.8;
const PLACEHOLDERS = ['未入力', 'あとで書く', '(仮)', '仮入力'] as const;

export function validateEssayReviewInput(essayBody: string): ValidationResult {
  if (isEmpty(essayBody)) {
    return {
      ok: false,
      code: 'EMPTY',
      message: '本文を入力してください',
    };
  }
  if (tooShort(essayBody, MIN_LENGTH)) {
    return {
      ok: false,
      code: 'TOO_SHORT',
      message: '本文をもう少し詳しく入力してください（80文字以上）',
    };
  }
  if (
    essayBody.length >= REPEATED_CHAR_GATE &&
    repeatedCharRatio(essayBody) >= REPEATED_CHAR_THRESHOLD
  ) {
    return {
      ok: false,
      code: 'REPEATED_CHAR',
      message:
        '同じ文字の繰り返しが多すぎます。小論文として読める内容を入力してください',
    };
  }
  if (containsPlaceholder(essayBody, PLACEHOLDERS)) {
    return {
      ok: false,
      code: 'PLACEHOLDER',
      message:
        '「未入力」「あとで書く」などの仮の文言が残っています。実際の本文を入力してください',
    };
  }
  return { ok: true };
}
