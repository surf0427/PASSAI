import type { BasicInfo } from '@/types/basicInfo';

// AIプロンプトに差し込む「生徒の基本情報」セクションを生成する純関数。
// 全機能（マッチング/志望理由書/小論文/面接）から同じ形で呼び出せるよう、
// 受け取り型は @/types/basicInfo の BasicInfo に統一する。
//
// basicInfo が null・必須項目が空でも安全に動作する（'未入力' にフォールバック）。
// 出力は LLM の文脈として読みやすい日本語の固定フォーマット。
export function buildBasicInfoPromptSection(basicInfo: BasicInfo | null): string {
  const lines: string[] = ['【生徒の基本情報】'];

  if (!basicInfo) {
    lines.push('（未登録）');
    return lines.join('\n');
  }

  lines.push(`氏名: ${basicInfo.name || '未入力'}`);
  lines.push(`学年: ${basicInfo.grade || '未入力'}`);
  lines.push(`文理: ${basicInfo.track || '未入力'}`);
  lines.push(`評定平均: ${(basicInfo.overallGpa ?? '').trim() || '未入力'}`);

  const examTypes = basicInfo.examTypes ?? [];
  lines.push(`受験予定の方式: ${examTypes.length > 0 ? examTypes.join('、') : '未入力'}`);

  const filled = (basicInfo.preferences ?? []).filter((p) => p.university.trim() !== '');
  if (filled.length === 0) {
    lines.push('志望校: 未入力');
  } else {
    lines.push('志望校:');
    filled.forEach((p, i) => {
      const segments = [p.university, p.faculty].filter((s) => s && s.trim());
      const dept = (p.department ?? '').trim();
      if (dept) segments.push(dept);
      lines.push(`  ${i + 1}. ${segments.join(' / ')}`);
    });
  }

  return lines.join('\n');
}

// 志望校に1つでも学科指定があるかを返す。プロンプト分岐用のヘルパー。
export function hasAnyDepartmentSpecified(basicInfo: BasicInfo | null): boolean {
  if (!basicInfo) return false;
  return (basicInfo.preferences ?? []).some((p) => (p.department ?? '').trim() !== '');
}
