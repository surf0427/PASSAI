// 志望理由書添削 AI に渡す大学DB context を生成する純関数。
//
// - lib/universities.ts の最小 helper（findUniversityEntriesByUserChoices /
//   getSelectionStepsByEntryId）を組み合わせる
// - 該当 entries の admission_policy / evaluation_points / ai_strategy_hint
//   などのうち、selection_type === "書類" のものだけを集約する
// - 空欄 / "不明" / "なし" は prompt に含めない
// - 該当 entries が無い、または有意な情報が一つも無い場合は空文字を返す
//   （STEP4 で statementPrompt.ts に差し込む際、空文字なら既存挙動と完全一致）
// - 大学DB全件を AI に渡さない。matching 以外で全件参照は禁止
//
// 詳細ルール: docs/principles/university_database_usage_guide.md 参照。

import {
  findUniversityEntriesByUserChoices,
  getSelectionStepsByEntryId,
} from '@/lib/universities';

// "あり" のみ意味あり。"なし" / "不明" / 空欄 は false。
function isYes(value: string): boolean {
  return value.trim() === 'あり';
}

// AI prompt に渡す価値のある値か。空欄 / "不明" / "なし" は除外。
function isMeaningfulValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (trimmed === '不明') return false;
  if (trimmed === 'なし') return false;
  return true;
}

// 入力配列から有意でない値を除外し、trim した上で重複削除（順序保持）。
function uniqueMeaningful(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    if (!isMeaningfulValue(v)) continue;
    const trimmed = v.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

// "{title}:\n- v1\n- v2" 形式のセクション文字列を生成。values が空なら ""。
function formatBulletSection(title: string, values: string[]): string {
  if (values.length === 0) return '';
  return [`${title}:`, ...values.map((v) => `- ${v}`)].join('\n');
}

export function buildStatementUniversityContext(input: {
  university: string;
  faculty?: string;
  department?: string;
}): string {
  const entries = findUniversityEntriesByUserChoices(input);
  if (entries.length === 0) return '';

  // ── 集約（universityEntries 側） ────────────────────────────
  const examTypes = uniqueMeaningful(entries.map((e) => e.exam_type));
  const qualifications = uniqueMeaningful(
    entries.map((e) => e.qualification_required),
  );

  const selectionMethods: string[] = [];
  if (entries.some((e) => isYes(e.has_document))) selectionMethods.push('書類審査あり');
  if (entries.some((e) => isYes(e.has_essay))) selectionMethods.push('小論文あり');
  if (entries.some((e) => isYes(e.has_interview))) selectionMethods.push('面接あり');
  if (entries.some((e) => isYes(e.has_presentation))) selectionMethods.push('プレゼンあり');

  const selectionNotes = uniqueMeaningful(entries.map((e) => e.selection_notes));

  // ── 集約（selectionSteps 側、selection_type === "書類" のみ） ──
  const documentSteps = entries.flatMap((e) =>
    getSelectionStepsByEntryId(e.entry_id).filter(
      (s) => s.selection_type === '書類',
    ),
  );
  const admissionPolicies = uniqueMeaningful(
    documentSteps.map((s) => s.admission_policy),
  );
  const evaluationPoints = uniqueMeaningful(
    documentSteps.map((s) => s.evaluation_points),
  );
  const aiStrategyHints = uniqueMeaningful(
    documentSteps.map((s) => s.ai_strategy_hint),
  );

  // ── 出力組み立て ────────────────────────────────────────────
  const blocks: string[] = [];
  const examTypeBlock = formatBulletSection('入試方式', examTypes);
  if (examTypeBlock) blocks.push(examTypeBlock);

  const qualificationBlock = formatBulletSection(
    '出願に必要な資格・条件',
    qualifications,
  );
  if (qualificationBlock) blocks.push(qualificationBlock);

  const methodsBlock = formatBulletSection('選考方法', selectionMethods);
  if (methodsBlock) blocks.push(methodsBlock);

  const notesBlock = formatBulletSection('選考補足', selectionNotes);
  if (notesBlock) blocks.push(notesBlock);

  const apBlock = formatBulletSection(
    'アドミッションポリシー',
    admissionPolicies,
  );
  if (apBlock) blocks.push(apBlock);

  const evalBlock = formatBulletSection(
    '志望理由書・書類審査で見られやすい観点',
    evaluationPoints,
  );
  if (evalBlock) blocks.push(evalBlock);

  const hintBlock = formatBulletSection(
    'AI対策メモ（参考。人手の助言）',
    aiStrategyHints,
  );
  if (hintBlock) blocks.push(hintBlock);

  // 該当 entries はあるが、有意な情報が一つも無い場合は空文字を返す。
  // 大学名・学部だけのヘッダは既存 prompt の「添削対象」セクションと重複するため出さない。
  if (blocks.length === 0) return '';

  // ── ヘッダ ───────────────────────────────────────────────
  const headerLines: string[] = [
    '【志望大学DB情報】',
    `大学: ${input.university.trim()}`,
  ];
  const faculty = (input.faculty ?? '').trim();
  const department = (input.department ?? '').trim();
  if (faculty) headerLines.push(`学部: ${faculty}`);
  if (department) headerLines.push(`学科: ${department}`);

  return [headerLines.join('\n'), ...blocks].join('\n\n');
}
