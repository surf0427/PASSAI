import type { PersistedAnalyzeState } from '@/types/analysis';
import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

const KEY = 'analyzeState';

export function saveAnalyzeState(state: PersistedAnalyzeState): void {
  safeSetStorage(KEY, state);
}

export function loadAnalyzeState(): PersistedAnalyzeState | null {
  return safeGetStorage<PersistedAnalyzeState | null>(KEY, null);
}

export function clearAnalyzeState(): void {
  safeRemoveStorage(KEY);
}
