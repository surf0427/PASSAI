import type { WallHittingResult } from '@/types/analysis';

const STORAGE_KEY = 'wallHittingResult';

export function saveWallHittingResult(result: WallHittingResult): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
}

export function loadWallHittingResult(): WallHittingResult | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as WallHittingResult;
  } catch {
    return null;
  }
}
