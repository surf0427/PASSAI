import type { PersistedAnalyzeState } from '@/types/analysis';

const KEY = 'analyzeState';

export function saveAnalyzeState(state: PersistedAnalyzeState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('analyzeStorage: save failed', e);
  }
}

export function loadAnalyzeState(): PersistedAnalyzeState | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as PersistedAnalyzeState;
  } catch {
    return null;
  }
}

export function clearAnalyzeState(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
}
