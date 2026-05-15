// /api/interview-questions の POST handler 専用 helper。
//
// 役割:
//   - isPlainObject: 汎用 type guard（オブジェクト判定）
//   - isStatementDraftShape: body.statementDraft の最小 shape guard
//   - buildFacultyNameInput: buildInterviewUniversityContext に渡す facultyName（学部 + 学科）の連結
//   - buildExamTypeQuestionGuidance: 受験方式に応じた質問生成方針の dynamic 部
//
// 切り出し経緯:
//   元は app/api/interview-questions/route.ts の末尾に「内部 helper」として並んでいたが、
//   route.ts が肥大化していたため切り出した。AI 呼び出し経路 / SYSTEM_PROMPT / parse 経路とは
//   無関係で、純粋関数のみ。
//
// 注意:
//   - buildExamTypeQuestionGuidance の文字列リテラル（5 つの受験方式ルールおよび
//     【受験方式に応じた質問生成方針】見出し）は user prompt の dynamic data として
//     buildInterviewQuestionUserPrompt の examTypeGuidance フィールドに流れ込む。
//     1 文字でも変えると AI 入力バイトが変わるため逐字保持すること。
//   - interview-feedback の同名 helper（buildExamTypeInterviewGuidance）とは
//     「フィードバック宛て」と「質問生成宛て」で文言が異なるため共通化しない。

import type { StatementDraft } from '@/lib/statement/review/statementStorage';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// statementDraft の最小 shape guard。中身の正規化は client 側で行われている前提で、
// ここでは「想定外の型を勝手に通さない」ことだけを保証する。
export function isStatementDraftShape(value: unknown): value is StatementDraft {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.university === 'string' &&
    typeof value.faculty === 'string' &&
    typeof value.department === 'string' &&
    typeof value.statementText === 'string'
  );
}

// buildInterviewUniversityContext は facultyName を「学部 学科」連結文字列で受ける契約のため、
// materials.faculty / department を半角スペースで結合してから渡す。空欄は空文字に揃える。
export function buildFacultyNameInput(
  faculty: string | null,
  department: string | null,
): string {
  const f = faculty?.trim() ?? '';
  const d = department?.trim() ?? '';
  if (f && d) return `${f} ${d}`;
  return f || d;
}

// 受験方式に応じた質問生成方針。interview-feedback の同名 helper は「フィードバック宛て」の
// 文言なので共通化しない。本 helper は「質問を作るときに何を意識させるか」を書く。
// examTypes が空のときは空文字を返す（prompt 側で「ガイダンスなし」と扱われる）。
export function buildExamTypeQuestionGuidance(examTypes: readonly string[]): string {
  const rules: string[] = [];
  if (examTypes.includes('総合型選抜（AO入試）')) {
    rules.push('- 総合型選抜（AO）志望のため、活動・自己分析・志望理由の一貫性を確認する質問を必ず含める。');
  }
  if (examTypes.includes('学校推薦型選抜（公募・指定校）')) {
    rules.push('- 学校推薦型選抜志望のため、評定平均・学校生活の継続性・推薦理由の妥当性を問う質問を含める。');
  }
  if (examTypes.includes('一般選抜') || examTypes.includes('共通テスト利用')) {
    rules.push('- 一般選抜（共通テスト利用を含む）も併願しているため、「なぜ一般受験だけでなく推薦・総合型も使うのか」を問う質問を含める。');
  }
  if (examTypes.includes('海外大学受験')) {
    rules.push('- 海外大学受験を含むため、語学力・国際経験との接続を問う質問を含める。');
  }
  if (examTypes.includes('まだ決まっていない')) {
    rules.push('- 受験方式が未確定のため、特定方式に偏らず幅広く使える質問を優先する。');
  }
  if (rules.length === 0) return '';
  return ['【受験方式に応じた質問生成方針】', ...rules].join('\n');
}
