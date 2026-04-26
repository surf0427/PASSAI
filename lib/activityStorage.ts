import type { ActivityData } from '@/types/activity';

// 【保存先】localStorage（ブラウザを閉じても残る）
// 【用途】活動整理フォームの入力途中データを保持する
// 　　　　ページを離れても再開できるようにするための保存
// 【注意】AI分析に渡す「提出済みデータ」は sessionStorage の 'activityData' キーに別途保存される
// 　　　　→ この2つは別物なので混同しないこと
const STORAGE_KEY = 'activityFormData';

export function saveActivityData(data: ActivityData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('activityStorage: save failed', e);
  }
}

export function loadActivityData(): ActivityData | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as ActivityData;
  } catch {
    return null;
  }
}

export function clearActivityData(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
