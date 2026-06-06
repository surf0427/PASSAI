// validator（lib/validation/validate*Input.ts）を持たない AI route 用の最大長ガード。
//
// validator 系 5 route は ValidationResult の 'TOO_LONG' code 経由で同じ目的を果たす。
// それ以外の route は本 helper で複数フィールドをまとめて検査し、最初の超過を返す。
// route 側は返ってきた message を各 route 既存の 400 エラー形状に載せ替える
// （error に文言を入れる route / { error:'INPUT_TOO_LONG', message } 形式の route）。
//
// tutor の MESSAGE_TOO_LONG パターンの横展開。検査は raw length（trim しない）。
import { tooLong } from './rules/text';

// 文字列 1 本、または自由記述配列（合計長で判定）を受ける。
export interface MaxLengthField {
  /** ユーザー向けフィールド名（例: '質問', '本文'）。エラー文言に埋め込む。 */
  label: string;
  /** 検査対象。string 以外（null / undefined / 非文字列）は型ガード側の責務なので skip。 */
  value: unknown;
  /** 上限文字数（lib/validation/inputLimits.ts の INPUT_MAX_LENGTHS）。 */
  max: number;
}

export type MaxLengthResult =
  | { ok: true }
  | { ok: false; code: 'TOO_LONG'; label: string; max: number; message: string };

function combinedLength(value: readonly unknown[]): number {
  let total = 0;
  for (const item of value) {
    if (typeof item === 'string') total += item.length;
  }
  return total;
}

/**
 * 各フィールドを順に検査し、最初に上限を超えたものを返す。
 * - string: その長さ
 * - string[]（配列）: 文字列要素の合計長
 * いずれも超過しなければ { ok: true }。
 */
export function checkMaxLengths(
  fields: readonly MaxLengthField[],
): MaxLengthResult {
  for (const field of fields) {
    if (typeof field.value === 'string') {
      if (tooLong(field.value, field.max)) {
        return reject(field, `「${field.label}」が長すぎます。${field.max}字以内で入力してください。`);
      }
    } else if (Array.isArray(field.value)) {
      if (combinedLength(field.value) > field.max) {
        return reject(field, `「${field.label}」が長すぎます。全体で${field.max}字以内にしてください。`);
      }
    }
  }
  return { ok: true };
}

function reject(field: MaxLengthField, message: string): MaxLengthResult {
  return { ok: false, code: 'TOO_LONG', label: field.label, max: field.max, message };
}
