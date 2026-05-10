// 自己分析添削 → AI志望校マッチング へのデータ引き継ぎユーティリティ。
// 将来 Supabase に移行するときはこのファイルだけ書き換える。
//
// 【保存先】localStorage（ブラウザを閉じても残る）
// 【用途】/ （自己分析添削）→ /matching（マッチング）へのページ間の一時的な受け渡し
// 　　　　basicInfo・activityData・selfPRs の3つをまとめて1キーに保存する
// 【ライフサイクル】「AI志望校マッチングへ進む」ボタン押下時に保存 → /matching で読み込む

import type { AdmissionMatchingInput } from '@/types/admissionMatchingInput';
import { loadBasicInfo } from './basicInfoStorage';
import { loadActivityData } from './activityStorage';
import { loadSelfPRs } from './selfPRStorage';
import { loadWallHittingResult } from './wallHittingStorage';
import { safeGetStorage, safeSetStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'admissionMatchingInput';

// localStorage から basicInfo・activityData・selfPRs・wallHittingResult を集めて保存する
export function collectAndSaveMatchingInput(): AdmissionMatchingInput {
  const input: AdmissionMatchingInput = {
    basicInfo: loadBasicInfo(),
    activityData: loadActivityData(),
    selfPRs: loadSelfPRs(),
    wallHittingResult: loadWallHittingResult(),
    savedAt: new Date().toISOString(),
  };
  safeSetStorage(STORAGE_KEY, input);
  return input;
}

// 保存済みの入力データを読み込む
export function loadMatchingInput(): AdmissionMatchingInput | null {
  return safeGetStorage<AdmissionMatchingInput | null>(STORAGE_KEY, null);
}

// ── マッチング完了フラグ ──────────────────────────────────────────
// 【保存先】localStorage
// 【用途】/admission-matching でマッチング結果が表示されたことを記録する
// 【ライフサイクル】結果計算後にセット → Home の進捗判定で参照

const MATCHING_RESULT_KEY = 'admissionMatchingResult';

export function markMatchingCompleted(): void {
  safeSetStorage(MATCHING_RESULT_KEY, { completed: true });
}

export function loadMatchingResult(): { completed: boolean } | null {
  return safeGetStorage<{ completed: boolean } | null>(MATCHING_RESULT_KEY, null);
}

// 不足しているデータ項目名を返す（マッチングページでの警告表示に使う）
export function getMissingItems(input: AdmissionMatchingInput): string[] {
  const missing: string[] = [];
  if (!input.basicInfo) missing.push('基本情報');
  if (!input.activityData) missing.push('活動整理');
  if (input.selfPRs.length === 0) missing.push('自己分析添削');
  return missing;
}
