// STEP5.11: /api/essay-review の input hash + ReviewResult 同居キャッシュ。
//
// 役割:
//   hashEssayReviewInput() の結果と、対応する AI 生成 ReviewResult を 1 つの
//   localStorage key にまとめて保存する。同入力なら AI call を skip して review を
//   そのまま復元する。
//
// 1 key で hash と value を同居させる理由:
//   "localStorage key 追加は 1 個まで" 制約を守るため。
//   両者は cache key / cache value という不可分の対なので、別 key に分離すると
//   片方だけ書かれた中途状態に脆くなる（同居なら shape guard 1 回で両方検査できる）。
//   既存 `essayPracticeReview`（SavedReview = ReviewResult + metadata）とは別経路で
//   独立保存しておく。
//
// 出力 hash との責務分離:
//   StudentProfile.sourceHash（出力素材の hash）とは別レーン。こちらは AI 入力の hash で、
//   cache key 用途のみに使う。
//
// 型:
//   ReviewResult は lib/essayPracticeStorage.ts の canonical 定義をそのまま import する。
//   route.ts は型を export しないため、storage 側の export を再利用する形（route.ts からの
//   runtime import は行わない）。
//
// 関連:
//   - lib/aiInputHash.ts:hashEssayReviewInput
//   - lib/aiCacheLog.ts
//   - docs/principles/ai_cache_observability.md

import type { ReviewResult } from '@/lib/essayPracticeStorage';
import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'essayReviewInputHash';

export type EssayReviewCacheRecord = {
  inputHash: string;
  model: string;
  promptVersion: number;
  savedAt: string;
  review: ReviewResult;
};

export function saveEssayReviewCache(record: EssayReviewCacheRecord): void {
  safeSetStorage(STORAGE_KEY, record);
}

export function loadEssayReviewCache(): EssayReviewCacheRecord | null {
  // safeGetStorage が SSR ガード / JSON.parse 失敗を吸収するので、ここでは shape のみ検査する。
  const raw = safeGetStorage<unknown>(STORAGE_KEY, null);
  if (!isRecord(raw)) return null;
  return raw;
}

export function clearEssayReviewCache(): void {
  safeRemoveStorage(STORAGE_KEY);
}

// 旧形式 / 破損データを「壊れたまま hit 判定に流す」のを防ぐ最小限の runtime guard。
// hash 一致でも review が壊れていたら null を返して miss に倒す。
function isRecord(value: unknown): value is EssayReviewCacheRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.inputHash !== 'string') return false;
  if (typeof v.model !== 'string') return false;
  if (typeof v.promptVersion !== 'number') return false;
  if (typeof v.savedAt !== 'string') return false;
  if (!isReviewResult(v.review)) return false;
  return true;
}

function isReviewResult(value: unknown): value is ReviewResult {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  if (typeof r.totalScore !== 'number') return false;
  if (typeof r.verdict !== 'string') return false;
  if (typeof r.improvement !== 'string') return false;
  if (!isStringArray(r.goodPoints)) return false;
  if (!isStringArray(r.weakPoints)) return false;
  if (!Array.isArray(r.breakdown)) return false;
  if (!r.breakdown.every(isBreakdownItem)) return false;
  return true;
}

function isBreakdownItem(value: unknown): value is { label: string; score: number } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.label === 'string' && typeof v.score === 'number';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string');
}
