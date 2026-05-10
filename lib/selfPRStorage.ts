import type { SelfPR } from '@/types/selfPR';
import { safeGetStorage, safeSetStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'selfPRs';

export function loadSelfPRs(): SelfPR[] {
  return safeGetStorage<SelfPR[]>(STORAGE_KEY, []);
}

export function saveSelfPRs(entries: SelfPR[]): void {
  safeSetStorage(STORAGE_KEY, entries);
}
