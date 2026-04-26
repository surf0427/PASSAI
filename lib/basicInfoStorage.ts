import type { BasicFormData } from '@/types/basicInfo';

const STORAGE_KEY = 'basicFormData';

export function saveBasicInfo(data: BasicFormData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadBasicInfo(): BasicFormData | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as BasicFormData;
  } catch {
    return null;
  }
}
