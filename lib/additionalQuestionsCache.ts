// STEP5.4: /api/analysis/additional の input hash + response 同居キャッシュ。
//
// 役割:
//   hashAdditionalQuestionsInput() の結果と、対応する AI 生成 questions を 1 つの
//   localStorage key にまとめて保存する。同入力なら AI call を skip して questions を
//   そのまま復元する。
//
// 1 key で hash と value を同居させる理由:
//   "localStorage key 追加は 1 個まで" 制約を守るため。
//   両者は cache key / cache value という不可分の対なので、別 key に分離すると
//   片方だけ書かれた中途状態に脆くなる（同居なら shape guard 1 回で両方検査できる）。
//
// 出力 hash との責務分離:
//   StudentProfile.sourceHash（出力素材の hash） とは別レーン。
//   こちらは AI 入力の hash であり、cache key 用途のみに使う。
//
// daily limit:
//   cache hit 時は AI call が起きないため daily limit を消費しない。
//   miss + success の時のみ消費する（呼び出し側 page で制御）。本ファイルは limit に直接関与しない。
//
// 関連:
//   - lib/aiInputHash.ts:hashAdditionalQuestionsInput
//   - lib/aiCacheLog.ts
//   - docs/principles/ai_cache_observability.md

import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'additionalQuestionsInputHash';

export type AdditionalQuestionsCacheRecord = {
  inputHash: string;
  model: string;
  promptVersion: number;
  savedAt: string;
  questions: string[];
};

export function saveAdditionalQuestionsCache(value: AdditionalQuestionsCacheRecord): void {
  safeSetStorage(STORAGE_KEY, value);
}

export function loadAdditionalQuestionsCache(): AdditionalQuestionsCacheRecord | null {
  // safeGetStorage が SSR ガード / JSON.parse 失敗を吸収するので、ここでは shape のみ検査する。
  const raw = safeGetStorage<unknown>(STORAGE_KEY, null);
  if (!isRecord(raw)) return null;
  return raw;
}

export function clearAdditionalQuestionsCache(): void {
  safeRemoveStorage(STORAGE_KEY);
}

// 旧形式 / 破損データを「壊れたまま hit 判定に流す」のを防ぐ最小限の runtime guard。
// hash 一致でも questions が壊れていたら null を返して miss に倒す。
function isRecord(value: unknown): value is AdditionalQuestionsCacheRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.inputHash !== 'string') return false;
  if (typeof v.model !== 'string') return false;
  if (typeof v.promptVersion !== 'number') return false;
  if (typeof v.savedAt !== 'string') return false;
  if (!Array.isArray(v.questions)) return false;
  if (!v.questions.every((q) => typeof q === 'string')) return false;
  return true;
}
