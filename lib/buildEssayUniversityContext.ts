// 小論文添削・壁打ち AI に渡す大学DB context を生成する純関数。
//
// - 入力 university / faculty / department は basicInfo.preferences[0] 経由で
//   既に分離済みのため、interview のような parser は不要
// - lib/universities.ts の最小 helper（findUniversityEntriesByUserChoices /
//   getSelectionStepsByEntryId）を組み合わせる
// - 該当 entries の format / duration / evaluation_points / ai_strategy_hint /
//   admission_policy のうち、selection_type === "小論文" のものだけを集約する
// - duration_or_length は "分" または "字" を含む値のみ採用（日付始まりは除外）
// - selection_notes は "小論文" or "論述" を含む行のみ採用
// - 空欄 / "不明" / "なし" は prompt に含めない
// - 該当 entries が無い、または有意な情報が一つも無い場合は空文字を返す
//   （後続 STEP で essay-review / essay-chat prompt に差し込む際、
//   空文字なら既存挙動と完全一致）
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

// 小論文の duration_or_length には "60分" / "800字・60分" / "600字" /
// "11/15実施" / 空欄 が混在する。
// "分" / "字" を含むものを採用し、日付始まり ("11/15..." 等) は除外する。
const DATE_PREFIX_PATTERN = /^\d{1,2}\/\d{1,2}/;
function isEssayDurationOrLength(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (DATE_PREFIX_PATTERN.test(trimmed)) return false;
  return trimmed.includes('分') || trimmed.includes('字');
}

// selection_notes は入試方式全体の補足。小論文機能の文脈では
// "小論文" / "論述" を含む行のみ意味があるためそれだけ採用する。
function isEssayRelatedNote(note: string): boolean {
  return note.includes('小論文') || note.includes('論述');
}

export function buildEssayUniversityContext(input: {
  university: string;
  faculty?: string;
  department?: string;
}): string {
  const entries = findUniversityEntriesByUserChoices(input);
  if (entries.length === 0) return '';

  // ── 集約（universityEntries 側） ────────────────────────────
  const examTypes = uniqueMeaningful(entries.map((e) => e.exam_type));

  const selectionMethods: string[] = [];
  if (entries.some((e) => isYes(e.has_essay))) selectionMethods.push('小論文あり');

  const selectionNotes = uniqueMeaningful(
    entries.map((e) => e.selection_notes).filter(isEssayRelatedNote),
  );

  // ── 集約（selectionSteps 側、selection_type === "小論文" のみ） ──
  const essaySteps = entries.flatMap((e) =>
    getSelectionStepsByEntryId(e.entry_id).filter(
      (s) => s.selection_type === '小論文',
    ),
  );

  const essayFormats = uniqueMeaningful(essaySteps.map((s) => s.format));
  const essayDurations = uniqueMeaningful(
    essaySteps.map((s) => s.duration_or_length).filter(isEssayDurationOrLength),
  );
  const evaluationPoints = uniqueMeaningful(
    essaySteps.map((s) => s.evaluation_points),
  );
  const aiStrategyHints = uniqueMeaningful(
    essaySteps.map((s) => s.ai_strategy_hint),
  );
  const admissionPolicies = uniqueMeaningful(
    essaySteps.map((s) => s.admission_policy),
  );

  // ── 出力組み立て ────────────────────────────────────────────
  const blocks: string[] = [];

  const examTypeBlock = formatBulletSection('入試方式', examTypes);
  if (examTypeBlock) blocks.push(examTypeBlock);

  const formatBlock = formatBulletSection('小論文形式', essayFormats);
  if (formatBlock) blocks.push(formatBlock);

  const durationBlock = formatBulletSection('小論文時間・字数', essayDurations);
  if (durationBlock) blocks.push(durationBlock);

  const methodsBlock = formatBulletSection('選考方法', selectionMethods);
  if (methodsBlock) blocks.push(methodsBlock);

  const notesBlock = formatBulletSection('選考補足', selectionNotes);
  if (notesBlock) blocks.push(notesBlock);

  const evalBlock = formatBulletSection(
    '小論文で見られやすい観点',
    evaluationPoints,
  );
  if (evalBlock) blocks.push(evalBlock);

  const apBlock = formatBulletSection(
    '大学側が重視している方向性',
    admissionPolicies,
  );
  if (apBlock) blocks.push(apBlock);

  const hintBlock = formatBulletSection(
    'AI対策メモ（参考。人手の助言）',
    aiStrategyHints,
  );
  if (hintBlock) blocks.push(hintBlock);

  // 該当 entries はあるが、有意な情報が一つも無い場合は空文字を返す。
  // 大学名・学部だけのヘッダは既存 prompt の他セクションと重複するため出さない。
  if (blocks.length === 0) return '';

  // ── ヘッダ ───────────────────────────────────────────────
  const headerLines: string[] = [
    '【小論文大学DB情報】',
    `大学: ${input.university.trim()}`,
  ];
  const faculty = (input.faculty ?? '').trim();
  const department = (input.department ?? '').trim();
  if (faculty) headerLines.push(`学部: ${faculty}`);
  if (department) headerLines.push(`学科: ${department}`);

  return [headerLines.join('\n'), ...blocks].join('\n\n');
}
