// 受験チューターAI 用 statement context の minimum section を作る純粋関数。
//
// 含める:
//   - university / faculty / department があれば 1 行（optional）
//   - statementDraft.statementText の冒頭（MAX_STATEMENT_EXCERPT_LENGTH 字、省略記号なし）
//   - statementReviewLatest.weakPoints[0] または improvements[0] のどちらか 1 件
//     （weakPoints 優先 — tutor は「何が詰まっているか」の整理が目的のため）
// 含めない:
//   - statementText 全文
//   - totalScore / scores（数値スコア露出禁止規約）
//   - reviewHistory（履歴、1 件 latest のみ受け取る）
//   - goodPoints / feedback 全体
//   - 評定値
//
// 入力欠損・型不一致時は throw せず空文字を返す。

import { MAX_STATEMENT_EXCERPT_LENGTH } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed === '') continue;
    out.push(trimmed);
  }
  return out;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

export function buildTutorStatementContext(input: {
  statementDraft?: unknown | null;
  statementReviewLatest?: unknown | null;
}): string {
  const lines: string[] = [];

  if (isPlainObject(input.statementDraft)) {
    const d = input.statementDraft;
    const university = safeString(d.university);
    const faculty = safeString(d.faculty);
    const department = safeString(d.department);
    const statementText = safeString(d.statementText);

    // 大学 / 学部 / 学科 を 1 行に
    const univParts: string[] = [];
    if (university) univParts.push(university);
    if (faculty) univParts.push(faculty);
    if (department) univParts.push(department);
    if (univParts.length > 0) {
      lines.push(`大学・学部: ${univParts.join(' / ')}`);
    }

    if (statementText) {
      lines.push(
        `書いてある内容の冒頭: ${truncate(statementText, MAX_STATEMENT_EXCERPT_LENGTH)}`,
      );
    }
  }

  if (isPlainObject(input.statementReviewLatest)) {
    const r = input.statementReviewLatest;
    const improvements = safeStringArray(r.improvements);
    const weakPoints = safeStringArray(r.weakPoints);

    // weakPoints 優先（tutor は詰まりの言語化が目的）。weakPoints 空なら improvements。
    if (weakPoints.length > 0) {
      lines.push(
        `直近の添削で出た弱み: ${truncate(weakPoints[0], MAX_STATEMENT_EXCERPT_LENGTH)}`,
      );
    } else if (improvements.length > 0) {
      lines.push(
        `直近の添削で出た改善点: ${truncate(improvements[0], MAX_STATEMENT_EXCERPT_LENGTH)}`,
      );
    }
  }

  if (lines.length === 0) return '';

  return ['【志望理由書の現状】', ...lines].join('\n');
}
