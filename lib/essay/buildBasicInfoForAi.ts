// AI 添削 / 改善まとめ用の basicInfo 生成（Phase 2 STEP P 新規 extract）。
//
// 役割:
//   ユーザーの基本情報（loadBasicInfo() の戻り値）と、対象 workspace の target を
//   合成して、AI route に送る BasicInfo を作る。
//
// 仕様:
//   - preferences[0] は target で上書き（残り preferences は基本情報側を保持）
//   - examTypes は target.examType が空でなければ [target.examType] のみで上書き、
//     空なら baseInfo.examTypes をそのまま使う
//   - baseInfo が null かつ target も全部空なら null を返す
//   - baseInfo が null かつ target に何か入っていれば、空の name/grade/track を埋めた
//     新しい BasicInfo を返す
//
// 不変条件:
//   - 戻り値 shape は **byte-identical** に保つ。AI 入力 hash に影響する。
//   - キャッシュ互換性のため、prompt 改修 / shape 変更時は ESSAY_REVIEW_PROMPT_VERSION 等を bump
//
// 利用箇所（STEP P extract 後）:
//   - app/essay-practice/page.tsx
//   - app/essay/improve/[wid]/rewrite/page.tsx
//   - app/essay/structure/[wid]/body/page.tsx
//   - app/essay/write/[wid]/body/page.tsx

import type { BasicInfo } from '@/types/basicInfo';

// target の shape は EssayWorkspace.target と SelectedEssayTarget (essay-practice) で共通。
// 依存方向を片方向に保つため inline 定義（types/essay.ts に依存しない）。
type EssayTargetForAi = {
  university: string;
  faculty: string;
  department: string;
  examType: string;
};

export function buildBasicInfoForAi(
  baseInfo: BasicInfo | null,
  target: EssayTargetForAi,
): BasicInfo | null {
  const hasAnyTarget =
    target.university.trim() !== '' ||
    target.faculty.trim() !== '' ||
    target.department.trim() !== '';

  const preferenceFromTarget = {
    university: target.university,
    faculty: target.faculty,
    department: target.department,
  };

  const overrideExamTypes = (original?: string[]): string[] => {
    const trimmed = target.examType.trim();
    if (trimmed !== '') return [trimmed];
    return original ?? [];
  };

  if (!baseInfo) {
    if (!hasAnyTarget && target.examType.trim() === '') return null;
    return {
      name: '',
      grade: '',
      track: '',
      preferences: [preferenceFromTarget],
      examTypes: overrideExamTypes(),
    };
  }

  const rest = (baseInfo.preferences ?? []).slice(1);
  return {
    ...baseInfo,
    preferences: [preferenceFromTarget, ...rest],
    examTypes: overrideExamTypes(baseInfo.examTypes),
  };
}
