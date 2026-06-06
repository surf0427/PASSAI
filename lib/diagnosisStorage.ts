// 受験タイプ診断（/diagnosis）の結果を localStorage に保存するユーティリティ。
// 将来 Supabase に移行するときは、このファイルだけを書き換える。
//
// 【保存先】localStorage（ブラウザを閉じても残る）
// 【用途】LP → 診断 → 結果 → 有料サイト の動線で、結果を再訪時に復元する
// 【ライフサイクル】診断完了時に save、/diagnosis 初回マウント時に load して結果画面へ復帰

import type { DiagnosisType } from '@/types/diagnosis';
import type { ExamType } from '@/types/examDiagnosis';
import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

// resultType は 2 系統を取り得る（恒久併存・STEP-DIAGNOSIS-MIGRATION）:
//   - number（DiagnosisType 1-4）: legacy 4タイプ診断。
//   - string（ExamType 9種）     : 9タイプ診断（feature flag ON 時）。
// 読み手（home / mypage / tutorContext）は `typeof resultType` で系統を判別する。
// answers が唯一の真実源。scoreVector は保存しない（必要時に再計算）。
export type DiagnosisResultType = DiagnosisType | ExamType;

export type DiagnosisResult = {
  resultType: DiagnosisResultType;
  resultTitle: string;
  resultDescription: string;
  answers: number[];
  createdAt: string;
};

const KEY = 'passai_diagnosis_result';

export function saveDiagnosisResult(result: DiagnosisResult): void {
  safeSetStorage(KEY, result);

  // Phase1: Supabase へ best-effort mirror（fire-and-forget）。
  // canonical (localStorage) 書き込み成功後に発火。await しない /
  // throw させない / UX を妨げない。
  //
  // 動的 import を使う理由: 本ファイルが将来 server-side から import される
  // 可能性に備え、browser boundary file（"use client"）を server bundle に
  // 静的に引き込まない（mirrorStudentProfile.ts / mirrorBasicInfo.ts と同パターン）。
  // diagnosis payload は user 自由記述を一切含まないため strip 不要 — mirror
  // helper 側で source_hash を derive するのみ。
  //
  // mirror helper は契約上 throw しないが、防御として .catch を付ける。
  void import('@/lib/supabase/mirrorDiagnosis')
    .then((mod) =>
      mod.mirrorDiagnosisToSupabase({
        payload: result as unknown as Record<string, unknown>,
      }),
    )
    .catch(() => {});
}

export function loadDiagnosisResult(): DiagnosisResult | null {
  return safeGetStorage<DiagnosisResult | null>(KEY, null);
}

export function clearDiagnosisResult(): void {
  safeRemoveStorage(KEY);
}
