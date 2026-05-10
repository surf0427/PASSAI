import type { WallHittingResult } from '@/types/analysis';
import { safeGetStorage, safeSetStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'wallHittingResult';

export function saveWallHittingResult(result: WallHittingResult): void {
  safeSetStorage(STORAGE_KEY, result);
}

export function loadWallHittingResult(): WallHittingResult | null {
  return safeGetStorage<WallHittingResult | null>(STORAGE_KEY, null);
}
