import { safeGetStorage, safeSetStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'interviewAdditionalQuestionUsage';
const MAX_ADDITIONAL_PER_CATEGORY = 2;

// カテゴリ表示名 → storage キーのマッピング
export const CATEGORY_KEYS: Record<string, string> = {
  '志望理由に関する質問':     'reason',
  '活動内容の深掘り質問':     'activity',
  '大学・学部理解に関する質問': 'university',
};

type CategoryCounts = Record<string, number>;

export type InterviewAdditionalUsage = {
  date: string;
  categoryCounts: CategoryCounts;
};

const INITIAL_COUNTS: CategoryCounts = { reason: 0, activity: 0, university: 0 };

function getTodayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function loadAdditionalUsage(): InterviewAdditionalUsage {
  const today = getTodayString();
  const stored = safeGetStorage<InterviewAdditionalUsage | null>(STORAGE_KEY, null);
  if (!stored || stored.date !== today || !stored.categoryCounts) {
    return { date: today, categoryCounts: { ...INITIAL_COUNTS } };
  }
  return stored;
}

export function getRemaining(usage: InterviewAdditionalUsage, categoryKey: string): number {
  return Math.max(0, MAX_ADDITIONAL_PER_CATEGORY - (usage.categoryCounts[categoryKey] ?? 0));
}

export function canUseCategory(usage: InterviewAdditionalUsage, categoryKey: string): boolean {
  return getRemaining(usage, categoryKey) > 0;
}

export function incrementCategory(
  usage: InterviewAdditionalUsage,
  categoryKey: string,
): InterviewAdditionalUsage {
  const updated: InterviewAdditionalUsage = {
    date: getTodayString(),
    categoryCounts: {
      ...usage.categoryCounts,
      [categoryKey]: (usage.categoryCounts[categoryKey] ?? 0) + 1,
    },
  };
  safeSetStorage(STORAGE_KEY, updated);
  return updated;
}

// Preview に渡す用：カテゴリ表示名 → 残り回数
export function getCategoryRemainingMap(usage: InterviewAdditionalUsage): Record<string, number> {
  return Object.fromEntries(
    Object.entries(CATEGORY_KEYS).map(([displayName, key]) => [
      displayName,
      getRemaining(usage, key),
    ]),
  );
}
