import type { BasicInfo, SubjectGrades } from '@/types/basicInfo';

// AIプロンプトに差し込む「生徒の基本情報」セクションを生成する純関数。
// 全機能（マッチング/志望理由書/小論文/面接）から同じ形で呼び出せるよう、
// 受け取り型は @/types/basicInfo の BasicInfo に統一する。
//
// basicInfo が null・必須項目が空でも安全に動作する（'未入力' にフォールバック）。
// 出力は LLM の文脈として読みやすい日本語の固定フォーマット。
//
// STEP13: subjectGrades が存在し、かつ trim 後に非空 key が 1 つ以上ある場合のみ
// 【科目別評定・出席状況】セクションを末尾に追加する。
// subjectGrades 未入力ユーザーの prompt 出力は完全に従来どおり（byte-identical）。
// AI input hash 側も lib/aiInputHash.ts:normalize() が undefined フィールドを落とすため、
// 未入力ユーザーの hash は不変（PROMPT_VERSION bump は不要）。
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

  // STEP13: subjectGrades セクション（optional・全項目空なら 1 行も出さない）。
  // 前 section との視覚的セパレータ '' を caller 側で付与する設計（helper は自己完結）。
  const subjectLines = buildSubjectGradesPromptLines(basicInfo.subjectGrades);
  if (subjectLines.length > 0) {
    lines.push('', ...subjectLines);
  }

  return lines.join('\n');
}

// subjectGrades の AI prompt 表示順とラベル。
// 「全部未入力」を大量に並べないよう、入力された項目だけを出力する設計。
// 順序は UI 入力順（app/input/basic/page.tsx の SUBJECT_GRADE_FIELDS）と揃える。
const SUBJECT_GRADE_OUTPUT: ReadonlyArray<{
  key: keyof SubjectGrades;
  label: string;
  unit?: string;
}> = [
  { key: 'english',     label: '英語評定' },
  { key: 'japanese',    label: '国語評定' },
  { key: 'math',        label: '数学評定' },
  { key: 'science',     label: '理科評定' },
  { key: 'social',      label: '社会評定' },
  { key: 'absenceDays', label: '欠席日数', unit: '日' },
];

// 【科目別評定・出席状況】セクションを行配列として返す pure helper。
//   - trim 後に非空の key のみ出力（空文字 / undefined は完全に除外）
//   - 欠席日数だけ単位「日」を付ける（既に「日」が末尾にある場合は重複させない）
//   - 全 key が空なら空配列を返す → 呼び出し側で section 自体を出さない
//   - 末尾の注意行で「出願可否は断定しない / 公式要項を最終確認源とする」前提を AI に明示
//
// 呼び出し側は join 文脈に合わせて適宜セパレータを足す（'\n' 連結 / セクション結合など）。
// STEP14 で interview-questions の prompt builder からも再利用するため export 化。
export function buildSubjectGradesPromptLines(subjectGrades: SubjectGrades | undefined): string[] {
  if (!subjectGrades) return [];
  const items: string[] = [];
  for (const field of SUBJECT_GRADE_OUTPUT) {
    const raw = (subjectGrades[field.key] ?? '').trim();
    if (raw === '') continue;
    const value = field.unit && !raw.endsWith(field.unit) ? `${raw}${field.unit}` : raw;
    items.push(`${field.label}: ${value}`);
  }
  if (items.length === 0) return [];
  return [
    '【科目別評定・出席状況】',
    ...items,
    '※ 推薦条件・面接・志望理由書の判断材料として参照してください。出願可否は断定せず、公式要項を最終確認源とする前提でアドバイスしてください。',
  ];
}

// 志望校に1つでも学科指定があるかを返す。プロンプト分岐用のヘルパー。
export function hasAnyDepartmentSpecified(basicInfo: BasicInfo | null): boolean {
  if (!basicInfo) return false;
  return (basicInfo.preferences ?? []).some((p) => (p.department ?? '').trim() !== '');
}
