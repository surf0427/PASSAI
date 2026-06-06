import type { ActivityData } from '@/types/activity';
import { formatActivityData } from '@/lib/formatActivity';
import {
  containsPlaceholder,
  isEmpty,
  repeatedCharRatio,
  tooLong,
} from './rules/text';
import { INPUT_MAX_LENGTHS } from './inputLimits';

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: 'EMPTY' | 'TOO_LONG' | 'REPEATED_CHAR' | 'PLACEHOLDER';
      message: string;
    };

const MAX_LENGTH = INPUT_MAX_LENGTHS.ACTIVITY_TOTAL;
const REPEATED_CHAR_GATE = 10;
const REPEATED_CHAR_THRESHOLD = 0.8;
const PLACEHOLDERS = ['未入力', 'あとで書く', '(仮)', '仮入力'] as const;

export function validateSummarizeInput(activityData: ActivityData): ValidationResult {
  const text = formatActivityData(activityData);

  if (isEmpty(text)) {
    return {
      ok: false,
      code: 'EMPTY',
      message: '活動内容を入力してください',
    };
  }
  if (tooLong(text, MAX_LENGTH)) {
    return {
      ok: false,
      code: 'TOO_LONG',
      message: `活動内容が長すぎます。全体で${MAX_LENGTH}文字以内に収めてください`,
    };
  }
  if (
    text.length >= REPEATED_CHAR_GATE &&
    repeatedCharRatio(text) >= REPEATED_CHAR_THRESHOLD
  ) {
    return {
      ok: false,
      code: 'REPEATED_CHAR',
      message:
        '活動内容に同じ文字の繰り返しが多すぎます。実際の内容を入力してください',
    };
  }
  if (containsPlaceholder(text, PLACEHOLDERS)) {
    return {
      ok: false,
      code: 'PLACEHOLDER',
      message:
        '「未入力」「あとで書く」などの仮の文言が残っています。実際の活動内容を入力してください',
    };
  }
  return { ok: true };
}
