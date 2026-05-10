import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';
import { buildSelfAnalysisUniversityContext } from '@/lib/buildSelfAnalysisUniversityContext';

// basicInfo から UniversityContext を組み立てる。
// 第一志望（preferences[0]）を対象大学とする。
//
// basicInfo 由来で埋まるフィールド: universityName / facultyName / departmentName / examTypes
// 大学DB由来で enrich されるフィールド: admissionPolicy / preferredExperiences / preferredTraits
//   （buildSelfAnalysisUniversityContext の戻り値を spread merge）
//   未登録大学の場合は enrichment が {} を返すため、basicInfo 由来フィールドだけが残る。
export function buildUniversityContextFromBasicInfo(
  basicInfo: BasicInfo | null,
): UniversityContext | null {
  if (!basicInfo) return null;
  const pref = basicInfo.preferences?.[0];
  if (!pref || !pref.university.trim()) return null;

  const baseContext: UniversityContext = {
    universityName: pref.university,
    facultyName: pref.faculty?.trim() ? pref.faculty : undefined,
    departmentName: (pref.department ?? '').trim() || undefined,
    examTypes: basicInfo.examTypes,
  };

  const enrichment = buildSelfAnalysisUniversityContext({
    university: pref.university,
    faculty: pref.faculty ?? '',
    department: pref.department ?? '',
  });

  return {
    ...baseContext,
    ...enrichment,
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
