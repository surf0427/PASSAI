// /api/essay-improve-summary の input hash + ImprovementSummary 同居キャッシュ
// （essay STEP F 新規）。
//
// 役割:
//   hashEssayImproveSummaryInput() の結果と、AI が生成した ImprovementSummary を
//   1 つの localStorage key にまとめて保存する。同入力なら AI call を skip して
//   summary をそのまま復元する。
//
// 既存 cache pattern との整合:
//   essayReviewInputHash / statementReviewInputHash と同形（hash + value 同居）。
//   shape guard は最小限の型チェックに留め、値域に踏み込まない
//   （ai_score_contract §7 と同じ思想：prompt 改修で出力分布が動いても guard を壊さない）。
//
// 1 key 1 record:
//   workspace / improvementInProgress に関わらず、最新の 1 件だけを保持する。
//   別 issueId / 別 workspace の summary 生成があれば古い cache を捨てる。
//   多 workspace 横断の cache は STEP F 範囲外（将来必要なら拡張）。

import type { ImprovementSummary } from '@/types/essay';
import {
  safeGetStorage,
  safeRemoveStorage,
  safeSetStorage,
} from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'essayImproveSummaryInputHash';

export type EssayImproveSummaryCacheRecord = {
  inputHash: string;
  model: string;
  promptVersion: number;
  savedAt: string;
  summary: ImprovementSummary;
};

export function saveEssayImproveSummaryCache(
  record: EssayImproveSummaryCacheRecord,
): void {
  safeSetStorage(STORAGE_KEY, record);
}

export function loadEssayImproveSummaryCache(): EssayImproveSummaryCacheRecord | null {
  const raw = safeGetStorage<unknown>(STORAGE_KEY, null);
  if (!isRecord(raw)) return null;
  return raw;
}

export function clearEssayImproveSummaryCache(): void {
  safeRemoveStorage(STORAGE_KEY);
}

// 壊れた cache を hit に流さないための最小限の type guard。
// 値域チェックは入れない（ai_score_contract §7 準拠）。
function isRecord(value: unknown): value is EssayImproveSummaryCacheRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.inputHash !== 'string') return false;
  if (typeof v.model !== 'string') return false;
  if (typeof v.promptVersion !== 'number') return false;
  if (typeof v.savedAt !== 'string') return false;
  if (!isImprovementSummary(v.summary)) return false;
  return true;
}

function isImprovementSummary(value: unknown): value is ImprovementSummary {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.summary !== 'string') return false;
  if (!isStringArray(v.focusPoints)) return false;
  if (!isStringArray(v.suggestedDirections)) return false;
  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string');
}
