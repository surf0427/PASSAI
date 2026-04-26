import type { SelfPR } from '@/types/selfPR';

const STORAGE_KEY = 'selfPRs';

export function loadSelfPRs(): SelfPR[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as SelfPR[];
  } catch {
    return [];
  }
}

export function saveSelfPRs(entries: SelfPR[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.error('selfPRStorage: save failed', e);
  }
}
