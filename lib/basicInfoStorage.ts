import type { BasicInfo, SchoolPreference } from '@/types/basicInfo';
import { safeGetStorage, safeSetStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'basicFormData';

export function saveBasicInfo(data: BasicInfo): void {
  safeSetStorage(STORAGE_KEY, data);
}

export function loadBasicInfo(): BasicInfo | null {
  const raw = safeGetStorage<BasicInfo | null>(STORAGE_KEY, null);
  if (!raw) return null;
  return normalizeBasicInfo(raw);
}

// 旧スキーマ（department / overallGpa 未保存）でも安全に読み込めるよう正規化する。
function normalizeBasicInfo(data: BasicInfo): BasicInfo {
  return {
    ...data,
    overallGpa: data.overallGpa ?? '',
    examTypes: data.examTypes ?? [],
    preferences: (data.preferences ?? []).map(normalizePreference),
  };
}

function normalizePreference(pref: SchoolPreference): SchoolPreference {
  return {
    university: pref.university ?? '',
    faculty: pref.faculty ?? '',
    department: pref.department ?? '',
  };
}
