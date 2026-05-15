// /statement/prepare のAI整理にかける1日あたりの利用回数制限。
// 既存の lib/statementLimit.ts と同じく lib/dailyLimit.ts の createDailyLimit を使う。
// 日付変更時の自動リセットも createDailyLimit 側で吸収される。

import { createDailyLimit } from '@/lib/dailyLimit';

const STORAGE_KEY = 'statement_prepare_limit';
const DAILY_LIMIT = 3;

const limit = createDailyLimit(STORAGE_KEY, DAILY_LIMIT);

export type StatementPrepareLimitStatus = {
  canUse: boolean;
  count: number;
  limit: number;
  remaining: number;
};

// SSR 時に呼ばれてもクラッシュしないよう、limit.loadUsage は内部で safeGetStorage を経由する。
// 戻り値は count=0 / canUse=true / remaining=DAILY_LIMIT になり、UI 初期値と一致する。
export function getStatementPrepareLimitStatus(): StatementPrepareLimitStatus {
  const usage = limit.loadUsage();
  return {
    canUse: limit.canUse(usage),
    count: usage.count,
    limit: DAILY_LIMIT,
    remaining: limit.getRemainingCount(usage),
  };
}

export function canUseStatementPrepare(): boolean {
  return limit.canUse(limit.loadUsage());
}

export function incrementStatementPrepareUsage(): void {
  limit.incrementUsage(limit.loadUsage());
}
