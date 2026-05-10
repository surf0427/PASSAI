// 受験タイプ診断（/diagnosis）の結果を localStorage に保存するユーティリティ。
// 将来 Supabase に移行するときは、このファイルだけを書き換える。
//
// 【保存先】localStorage（ブラウザを閉じても残る）
// 【用途】LP → 診断 → 結果 → 有料サイト の動線で、結果を再訪時に復元する
// 【ライフサイクル】診断完了時に save、/diagnosis 初回マウント時に load して結果画面へ復帰

import type { DiagnosisType } from '@/types/diagnosis';
import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

export type DiagnosisResult = {
  resultType: DiagnosisType;
  resultTitle: string;
  resultDescription: string;
  answers: number[];
  createdAt: string;
};

const KEY = 'passai_diagnosis_result';

export function saveDiagnosisResult(result: DiagnosisResult): void {
  safeSetStorage(KEY, result);
}

export function loadDiagnosisResult(): DiagnosisResult | null {
  return safeGetStorage<DiagnosisResult | null>(KEY, null);
}

export function clearDiagnosisResult(): void {
  safeRemoveStorage(KEY);
}
