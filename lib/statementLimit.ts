import { createDailyLimit } from '@/lib/dailyLimit';

const STORAGE_KEY = 'statementReviewLimit';
const DAILY_LIMIT = 5;

// createDailyLimit は日付変更時の自動リセットも含む
const limit = createDailyLimit(STORAGE_KEY, DAILY_LIMIT);

export function getTodayReviewCount(): number {
  return limit.loadUsage().count;
}

export function canUseStatementReview(): boolean {
  return limit.canUse(limit.loadUsage());
}

export function incrementStatementReviewCount(): void {
  limit.incrementUsage(limit.loadUsage());
}

export function getRemainingStatementReviewCount(): number {
  return limit.getRemainingCount(limit.loadUsage());
}
