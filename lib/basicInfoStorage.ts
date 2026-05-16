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
//
// subjectGrades は意図的に「未保存なら追加しない（undefined のまま）」設計。
// 空オブジェクトを差し込むと AI input hash（lib/aiInputHash.ts）が既存ユーザーで
// 一斉に変わり、5 ルート分の cache が miss するため。
// 値が既に存在するときだけ shape を保ったまま素通しする。
function normalizeBasicInfo(data: BasicInfo): BasicInfo {
  const normalized: BasicInfo = {
    ...data,
    overallGpa: data.overallGpa ?? '',
    examTypes: data.examTypes ?? [],
    preferences: (data.preferences ?? []).map(normalizePreference),
  };
  if (data.subjectGrades === undefined) {
    delete normalized.subjectGrades;
  }
  return normalized;
}

function normalizePreference(pref: SchoolPreference): SchoolPreference {
  return {
    university: pref.university ?? '',
    faculty: pref.faculty ?? '',
    department: pref.department ?? '',
  };
}
