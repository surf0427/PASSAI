import type { ActivityData } from '@/types/activity';
import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

// 【保存先】localStorage（ブラウザを閉じても残る）
// 【用途】活動整理フォームの入力途中データを保持する
// 　　　　ページを離れても再開できるようにするための保存
// 【注意】AI分析に渡す「提出済みデータ」は sessionStorage の 'activityData' キーに別途保存される
// 　　　　→ この2つは別物なので混同しないこと
const STORAGE_KEY = 'activityFormData';

export function saveActivityData(data: ActivityData): void {
  safeSetStorage(STORAGE_KEY, data);
}

export function loadActivityData(): ActivityData | null {
  return safeGetStorage<ActivityData | null>(STORAGE_KEY, null);
}

export function clearActivityData(): void {
  safeRemoveStorage(STORAGE_KEY);
}
