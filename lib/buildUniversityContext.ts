import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';

// basicInfo から UniversityContext を組み立てる暫定実装。
// 第一志望（preferences[0]）を対象大学とする。
//
// 現状埋まるフィールド: universityName / facultyName / departmentName / examTypes
//
// TODO: 大学DBが整備されたら以下の処理を追加する
//   1. universityName から universityId を引き当てる
//   2. universityId / facultyId / departmentId をキーに、
//      admissionPolicy / preferredTraits / preferredExperiences /
//      essayThemes / interviewTopics / requiredGpa を取得する
//   3. それらをマージしてより充実した UniversityContext を返す
//
//   API側の設計上、buildUniversityContextFromBasicInfo の返り値を上書きする
//   別ヘルパー（例: enrichUniversityContextFromDB）を後付けで挟めるようにしておく。
export function buildUniversityContextFromBasicInfo(
  basicInfo: BasicInfo | null,
): UniversityContext | null {
  if (!basicInfo) return null;
  const pref = basicInfo.preferences?.[0];
  if (!pref || !pref.university.trim()) return null;

  return {
    universityName: pref.university,
    facultyName: pref.faculty?.trim() ? pref.faculty : undefined,
    departmentName: (pref.department ?? '').trim() || undefined,
    examTypes: basicInfo.examTypes,
  };
}

// AIプロンプトに差し込む UniversityContext セクションを生成する純関数。
// 全機能から再利用できる。null や未設定フィールドは行ごと省略する。
// セクション全体が空（=志望情報が一切ない）なら空文字を返す。
export function buildUniversityContextPromptSection(
  ctx: UniversityContext | null,
): string {
  if (!ctx) return '';
  const lines: string[] = ['【志望先の文脈】'];

  if (ctx.universityName) lines.push(`志望大学: ${ctx.universityName}`);
  if (ctx.facultyName) lines.push(`志望学部: ${ctx.facultyName}`);
  if (ctx.departmentName) lines.push(`志望学科: ${ctx.departmentName}`);
  if (ctx.admissionPolicy) lines.push(`アドミッションポリシー: ${ctx.admissionPolicy}`);
  if (ctx.preferredTraits?.length) lines.push(`求める人物像: ${ctx.preferredTraits.join('、')}`);
  if (ctx.preferredExperiences?.length) lines.push(`評価される経験: ${ctx.preferredExperiences.join('、')}`);
  if (ctx.essayThemes?.length) lines.push(`志望理由書テーマ例: ${ctx.essayThemes.join('、')}`);
  if (ctx.interviewTopics?.length) lines.push(`面接頻出トピック: ${ctx.interviewTopics.join('、')}`);
  if (typeof ctx.requiredGpa === 'number') lines.push(`評定基準: ${ctx.requiredGpa}`);
  if (ctx.examTypes?.length) lines.push(`受験予定の方式: ${ctx.examTypes.join('、')}`);

  // ヘッダーしかない場合はセクションごと出さない
  if (lines.length <= 1) return '';
  return lines.join('\n');
}
