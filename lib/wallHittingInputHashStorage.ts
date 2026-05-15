// STEP5.2: /api/analysis の input hash cache の保存層。
//
// 役割:
//   hashAnalysisInput() の結果を localStorage に保存し、次回 run() 時に同入力か判定する。
//   保存対象は「ハッシュとメタ情報」のみ。本体結果（wallHittingResult）は別 storage に置いて
//   ある（lib/wallHittingStorage.ts）ので、判定時は両方を AND で確認する。
//
// Supabase 移行ロードマップ:
//   本 key は client 側 cache の前段にすぎないため、Supabase 化時に
//   (a) 残して client cache のまま使う / (b) server 側 dedup に昇格して廃止
//   のどちらでも選べる。output hash (StudentProfile.sourceHash) のような canonical
//   artifact ではない点に注意。
//
// 関連: lib/aiInputHash.ts / lib/wallHittingStorage.ts / docs/principles/ai_cache_observability.md

import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'wallHittingInputHash';

export type WallHittingInputHashRecord = {
  inputHash: string;
  model: string;
  promptVersion: number;
  savedAt: string;
};

export function saveWallHittingInputHash(value: WallHittingInputHashRecord): void {
  safeSetStorage(STORAGE_KEY, value);
}

export function loadWallHittingInputHash(): WallHittingInputHashRecord | null {
  // safeGetStorage が SSR ガード / JSON.parse 失敗を吸収するので、ここでは shape のみ検査する。
  const raw = safeGetStorage<unknown>(STORAGE_KEY, null);
  if (!isRecord(raw)) return null;
  return raw;
}

export function clearWallHittingInputHash(): void {
  safeRemoveStorage(STORAGE_KEY);
}

// 旧形式 / 破損データを「壊れたまま hit 判定に流す」のを防ぐための最小限の runtime guard。
function isRecord(value: unknown): value is WallHittingInputHashRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.inputHash === 'string' &&
    typeof v.model === 'string' &&
    typeof v.promptVersion === 'number' &&
    typeof v.savedAt === 'string'
  );
}
