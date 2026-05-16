// STEP6.13: admission-matching の入力フォーム形式 (BasicInfo) を、matching スコアリング層が
//   受け取る MatchingBasicInfo 形式に変換する pure domain helper。
//   page.tsx 内に同居していたが、storage / state / UI に依存しないため lib へ移動した。
//   logic / shape / field order / fallback すべて page 内に同居していた時点から無変更。

import type { BasicInfo } from '@/types/basicInfo';
import type { MatchingBasicInfo } from '@/types/matching';

export function toBasicInfo(formData: BasicInfo): MatchingBasicInfo {
  return {
    name: formData.name,
    highSchool: '',
    grade: formData.grade,
    academicType: formData.track === '理系' ? '理系' : '文系',
    choices: formData.preferences
      .filter((p) => p.university.trim() !== '')
      .map((p) => ({ university: p.university, faculty: p.faculty })),
  };
}
