// STEP5.8: /api/summarize の input hash + SummaryResult 同居キャッシュ。
//
// 役割:
//   hashSummarizeInput() の結果と、対応する AI 生成 SummaryResult を 1 つの
//   localStorage key にまとめて保存する。同入力なら AI call を skip して summary を
//   そのまま復元する。
//
// 1 key で hash と value を同居させる理由:
//   "localStorage key 追加は 1 個まで" 制約を守るため。
//   両者は cache key / cache value という不可分の対なので、別 key に分離すると
//   片方だけ書かれた中途状態に脆くなる（同居なら shape guard 1 回で両方検査できる）。
//   analyzeState.summary とは別経路で独立保存しておく（analyzeState は session bag で、
//   step / answers / displayedQuestions 変更時にも書き直しが入る。cache value の
//   独立性を保つため依存しない）。
//
// 出力 hash との責務分離:
//   StudentProfile.sourceHash（出力素材の hash）とは別レーン。こちらは AI 入力の hash で、
//   cache key 用途のみに使う。
//
// 関連:
//   - lib/aiInputHash.ts:hashSummarizeInput
//   - lib/aiCacheLog.ts
//   - docs/principles/ai_cache_observability.md

import type { SummaryResult } from '@/types/analysis';
import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'summarizeInputHash';

export type SummarizeCacheRecord = {
  inputHash: string;
  model: string;
  promptVersion: number;
  savedAt: string;
  summary: SummaryResult;
};

export function saveSummarizeCache(record: SummarizeCacheRecord): void {
  safeSetStorage(STORAGE_KEY, record);
}

export function loadSummarizeCache(): SummarizeCacheRecord | null {
  // safeGetStorage が SSR ガード / JSON.parse 失敗を吸収するので、ここでは shape のみ検査する。
  const raw = safeGetStorage<unknown>(STORAGE_KEY, null);
  if (!isRecord(raw)) return null;
  return raw;
}

export function clearSummarizeCache(): void {
  safeRemoveStorage(STORAGE_KEY);
}

// 旧形式 / 破損データを「壊れたまま hit 判定に流す」のを防ぐ最小限の runtime guard。
// hash 一致でも summary が壊れていたら null を返して miss に倒す。
function isRecord(value: unknown): value is SummarizeCacheRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.inputHash !== 'string') return false;
  if (typeof v.model !== 'string') return false;
  if (typeof v.promptVersion !== 'number') return false;
  if (typeof v.savedAt !== 'string') return false;
  if (!isSummary(v.summary)) return false;
  return true;
}

// SummaryResult の shape guard。
// activitySummary / strengths / appealPoints は string 必須。
function isSummary(value: unknown): value is SummaryResult {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.activitySummary !== 'string') return false;
  if (typeof s.strengths !== 'string') return false;
  if (typeof s.appealPoints !== 'string') return false;
  return true;
}
