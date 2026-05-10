// 面接添削 AI に渡す大学DB context を生成する純関数。
//
// - 入力 facultyName は "学部 学科" 連結文字列を許容するため
//   parseFacultyName で {faculty, department} に分解してから DB 検索する
// - lib/universities.ts の最小 helper（findUniversityEntriesByUserChoices /
//   getSelectionStepsByEntryId）を組み合わせる
// - 該当 entries の format / duration / evaluation_points / ai_strategy_hint /
//   admission_policy のうち、selection_type === "面接" のものだけを集約する
// - duration_or_length は /^\d+分$/ のみ採用（CSV には日付混入があるため）
// - selection_notes は "面接" or "口頭試問" を含む行のみ採用
// - 空欄 / "不明" / "なし" は prompt に含めない
// - 該当 entries が無い、または有意な情報が一つも無い場合は空文字を返す
//   （後続 STEP で interview-feedback prompt に差し込む際、空文字なら既存挙動と完全一致）
// - 大学DB全件を AI に渡さない。matching 以外で全件参照は禁止
//
// 詳細ルール: docs/principles/university_database_usage_guide.md 参照。

import { parseFacultyName } from '@/lib/parseFacultyName';
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

// CSV の duration_or_length には "20分" / "11/16実施" / 空欄 が混在する。
// 今は "○分" 形式のみ採用し、それ以外は無視する。
const DURATION_MINUTES_PATTERN = /^\d+分$/;
function isMinutesDuration(value: string): boolean {
  return DURATION_MINUTES_PATTERN.test(value.trim());
}

// selection_notes は入試方式全体の補足。面接機能の文脈では
// "面接" / "口頭試問" を含む行のみ意味があるためそれだけ採用する。
function isInterviewRelatedNote(note: string): boolean {
  return note.includes('面接') || note.includes('口頭試問');
}

export function buildInterviewUniversityContext(input: {
  university: string;
  facultyName?: string;
}): string {
  const { faculty, department } = parseFacultyName(input.facultyName ?? '');

  const entries = findUniversityEntriesByUserChoices({
    university: input.university,
    faculty,
    department,
  });
  if (entries.length === 0) return '';

  // ── 集約（universityEntries 側） ────────────────────────────
  const examTypes = uniqueMeaningful(entries.map((e) => e.exam_type));

  const selectionMethods: string[] = [];
  if (entries.some((e) => isYes(e.has_interview))) selectionMethods.push('面接あり');
  if (entries.some((e) => isYes(e.has_presentation))) selectionMethods.push('プレゼンあり');

  const selectionNotes = uniqueMeaningful(
    entries.map((e) => e.selection_notes).filter(isInterviewRelatedNote),
  );

  // ── 集約（selectionSteps 側、selection_type === "面接" のみ） ──
  const interviewSteps = entries.flatMap((e) =>
    getSelectionStepsByEntryId(e.entry_id).filter(
      (s) => s.selection_type === '面接',
    ),
  );

  const interviewFormats = uniqueMeaningful(interviewSteps.map((s) => s.format));
  const interviewDurations = uniqueMeaningful(
    interviewSteps.map((s) => s.duration_or_length).filter(isMinutesDuration),
  );
  const evaluationPoints = uniqueMeaningful(
    interviewSteps.map((s) => s.evaluation_points),
  );
  const aiStrategyHints = uniqueMeaningful(
    interviewSteps.map((s) => s.ai_strategy_hint),
  );
  const admissionPolicies = uniqueMeaningful(
    interviewSteps.map((s) => s.admission_policy),
  );

  // ── 出力組み立て ────────────────────────────────────────────
  const blocks: string[] = [];

  const examTypeBlock = formatBulletSection('入試方式', examTypes);
  if (examTypeBlock) blocks.push(examTypeBlock);

  const formatBlock = formatBulletSection('面接形式', interviewFormats);
  if (formatBlock) blocks.push(formatBlock);

  const durationBlock = formatBulletSection('面接時間', interviewDurations);
  if (durationBlock) blocks.push(durationBlock);

  const methodsBlock = formatBulletSection('選考方法', selectionMethods);
  if (methodsBlock) blocks.push(methodsBlock);

  const notesBlock = formatBulletSection('選考補足', selectionNotes);
  if (notesBlock) blocks.push(notesBlock);

  const evalBlock = formatBulletSection(
    '面接で見られやすい観点',
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
  // 大学名・学部だけのヘッダは既存 prompt の「受験情報」セクションと重複するため出さない。
  if (blocks.length === 0) return '';

  // ── ヘッダ ───────────────────────────────────────────────
  const headerLines: string[] = [
    '【面接大学DB情報】',
    `大学: ${input.university.trim()}`,
  ];
  if (faculty) headerLines.push(`学部: ${faculty}`);
  if (department) headerLines.push(`学科: ${department}`);

  return [headerLines.join('\n'), ...blocks].join('\n\n');
}
