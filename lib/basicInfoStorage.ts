import type { BasicInfo, SchoolPreference } from '@/types/basicInfo';
import { safeGetStorage, safeSetStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'basicFormData';

export function saveBasicInfo(data: BasicInfo): void {
  safeSetStorage(STORAGE_KEY, data);

  // Phase1: Supabase へ best-effort mirror（fire-and-forget）。
  // canonical (localStorage) 書き込み成功後に発火。await しない /
  // throw させない / UX を妨げない。
  //
  // 動的 import を使う理由: 本ファイル自体は他 feature / route から static
  // import される可能性に備え、browser boundary file（"use client"）を
  // server bundle に静的に引き込まない（mirrorStudentProfile.ts と同パターン）。
  // mirror helper 側で `name` を strip するため、PII (raw user name) は
  // browser を出ない。
  //
  // mirror helper は契約上 throw しないが、防御として .catch を付ける。
  void import('@/lib/supabase/mirrorBasicInfo')
    .then((mod) =>
      mod.mirrorBasicInfoToSupabase({
        payload: data as unknown as Record<string, unknown>,
      }),
    )
    .catch(() => {});
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
