// 日次利用制限のユーティリティ。
// createDailyLimit(storageKey, limit) でインスタンスを作り、各機能で使う。
// 将来 Supabase に移行するときはこのファイルだけ書き換える。

export type DailyUsage = {
  date: string;  // 例: '2026-04-24'
  count: number;
};

function getTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadUsage(storageKey: string): DailyUsage {
  if (typeof window === 'undefined') return { date: getTodayString(), count: 0 };
  const stored = localStorage.getItem(storageKey);
  if (!stored) return { date: getTodayString(), count: 0 };
  try {
    const parsed = JSON.parse(stored) as DailyUsage;
    // 保存日付が今日と違う → 日が変わったのでリセット
    if (parsed.date !== getTodayString()) return { date: getTodayString(), count: 0 };
    return parsed;
  } catch {
    return { date: getTodayString(), count: 0 };
  }
}

function incrementUsage(storageKey: string, usage: DailyUsage): DailyUsage {
  const updated: DailyUsage = { date: getTodayString(), count: usage.count + 1 };
  localStorage.setItem(storageKey, JSON.stringify(updated));
  return updated;
}

export function createDailyLimit(storageKey: string, limit: number) {
  return {
    loadUsage:         ()                  => loadUsage(storageKey),
    getRemainingCount: (usage: DailyUsage) => Math.max(0, limit - usage.count),
    canUse:            (usage: DailyUsage) => usage.count < limit,
    incrementUsage:    (usage: DailyUsage) => incrementUsage(storageKey, usage),
  };
}

// 各機能のインスタンス
// storageKey はもとの deepDiveLimit.ts / selfAnalysisLimit.ts と同じ値を使う
// → 既存ユーザーのカウントがリセットされない
export const deepDiveLimit     = createDailyLimit('deepDiveUsage',     4);
export const selfAnalysisLimit = createDailyLimit('selfAnalysisUsage', 3);
