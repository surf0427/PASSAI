import type { ActivityData } from '@/types/activity';
import { formatActivityData } from '@/lib/formatActivity';
import { isEmpty } from './rules/text';

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: 'EMPTY';
      message: string;
    };

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
  return { ok: true };
}
