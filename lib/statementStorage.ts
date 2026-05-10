import type { StatementResult } from '@/types/statement';
import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

// ── 下書き保存 ───────────────────────────────────────────────────

const DRAFT_KEY = 'statementDraft';

type StatementDraft = {
  university: string;
  faculty: string;
  department: string; // 学科。STEP4 で追加。任意項目（空文字でOK）。
  statementText: string;
};

// 旧スキーマの department は「学部」を意味していた。STEP4 以降の department は「学科」。
// 互換性: faculty の有無で旧スキーマか新スキーマかを判定する。
//   - faculty なし & department あり → 旧スキーマ。department は学部 → faculty に昇格。
//   - faculty あり                  → 新スキーマ。department は学科として扱う（または未設定）。
type LegacyStatementDraft = Omit<StatementDraft, 'department'> & {
  faculty?: string;
  department?: string;
};

export function saveDraft(data: StatementDraft): void {
  safeSetStorage(DRAFT_KEY, data);
}

export function loadDraft(): StatementDraft | null {
  const raw = safeGetStorage<LegacyStatementDraft | null>(DRAFT_KEY, null);
  if (!raw) return null;
  return normalizeDraft(raw);
}

export function clearDraft(): void {
  safeRemoveStorage(DRAFT_KEY);
}

// ── 添削履歴 ─────────────────────────────────────────────────────

const HISTORY_KEY = 'statementReviewHistory';
const MAX_HISTORY = 10;

export type { StatementResult } from '@/types/statement';

export type ReviewHistoryItem = {
  id: string;
  createdAt: string;
  university: string;
  faculty: string;
  department: string; // 学科。STEP4 で追加。
  essay: string;
  result: StatementResult;
};

// 旧形式は STatementDraft と同じく department が「学部」だった可能性あり。
type LegacyReviewHistoryItem = Omit<ReviewHistoryItem, 'department'> & {
  faculty?: string;
  department?: string;
};

export function saveReviewHistory(item: ReviewHistoryItem): void {
  const existing = loadReviewHistory();
  const updated = [item, ...existing].slice(0, MAX_HISTORY);
  safeSetStorage(HISTORY_KEY, updated);
}

export function loadReviewHistory(): ReviewHistoryItem[] {
  const raw = safeGetStorage<LegacyReviewHistoryItem[]>(HISTORY_KEY, []);
  return raw.map(normalizeHistoryItem);
}

export function deleteReviewHistoryItem(id: string): void {
  const existing = loadReviewHistory();
  const updated = existing.filter((item) => item.id !== id);
  safeSetStorage(HISTORY_KEY, updated);
}

export function clearReviewHistory(): void {
  safeRemoveStorage(HISTORY_KEY);
}

// ── 正規化 ───────────────────────────────────────────────────────
// 互換性ルール:
//   旧スキーマ（faculty なし、department=学部）→ department を faculty に昇格、新 department は ''。
//   新スキーマ（faculty あり）                → department はそのまま「学科」として扱う。

function isLegacyShape(raw: { faculty?: string; department?: string }): boolean {
  return raw.faculty === undefined && raw.department !== undefined;
}

function normalizeDraft(raw: LegacyStatementDraft): StatementDraft {
  const legacy = isLegacyShape(raw);
  return {
    university: raw.university ?? '',
    faculty: legacy ? (raw.department ?? '') : (raw.faculty ?? ''),
    department: legacy ? '' : (raw.department ?? ''),
    statementText: raw.statementText ?? '',
  };
}

function normalizeHistoryItem(raw: LegacyReviewHistoryItem): ReviewHistoryItem {
  const legacy = isLegacyShape(raw);
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    university: raw.university ?? '',
    faculty: legacy ? (raw.department ?? '') : (raw.faculty ?? ''),
    department: legacy ? '' : (raw.department ?? ''),
    essay: raw.essay ?? '',
    result: raw.result,
  };
}
