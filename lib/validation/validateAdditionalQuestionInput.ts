import type { ActivityData } from '@/types/activity';
import { formatActivityData } from '@/lib/formatActivity';
import { isEmpty, tooLong } from './rules/text';
import { INPUT_MAX_LENGTHS } from './inputLimits';

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: 'EMPTY' | 'TOO_LONG';
      message: string;
    };

const MAX_LENGTH = INPUT_MAX_LENGTHS.ACTIVITY_TOTAL;

export function validateAdditionalQuestionInput(
  activityData: ActivityData,
): ValidationResult {
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
  return { ok: true };
}
