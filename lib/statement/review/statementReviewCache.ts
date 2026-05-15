// STEP5.10: /api/statement-review の input hash + response 同居キャッシュ。
//
// 役割:
//   hashStatementReviewInput() の結果と、対応する AI 生成 ApiReviewResponse を 1 つの
//   localStorage key にまとめて保存する。同入力なら AI call を skip して response を
//   そのまま復元（呼び出し側で mapApiResponse() に通す）。
//
// 1 key で hash と value を同居させる理由:
//   "localStorage key 追加は 1 個まで" 制約を守るため。
//   両者は cache key / cache value という不可分の対なので、別 key に分離すると
//   片方だけ書かれた中途状態に脆くなる（同居なら shape guard 1 回で両方検査できる）。
//
// 出力 hash との責務分離:
//   StudentProfile.sourceHash（出力素材の hash）とは別レーン。こちらは AI 入力の hash で、
//   cache key 用途のみに使う。
//
// 型の置き方:
//   ApiReviewResponse は呼び出し元 app/statement/edit/page.tsx で local type として
//   定義されている（route.ts は型を export しない）。それと shape を揃えるため、
//   本ファイル内に同形 type を定義する（型は 5 score + 5 string list で安定。drift 時は
//   shape guard が null を返して fail-open し、新規 fetch で自己回復する）。
//   ※ route.ts から runtime import しない（型のためだけの依存は持たない方針）。
//
// 関連:
//   - lib/aiInputHash.ts:hashStatementReviewInput
//   - lib/aiCacheLog.ts
//   - docs/principles/ai_cache_observability.md

import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'statementReviewInputHash';

// app/statement/edit/page.tsx の local type `ApiReviewResponse` と shape を揃えること。
// drift した場合は isApiReviewResponse の shape guard が null を返して fail-open する。
export type StatementReviewApiResponse = {
  totalScore: number;
  scores: {
    logic: number;
    specificity: number;
    universityFit: number;
    futureGoal: number;
    originality: number;
  };
  strengths: string[];
  weaknesses: string[];
  actions: string[];
  partialExamples: string[];
  checklist: string[];
};

export type StatementReviewCacheRecord = {
  inputHash: string;
  model: string;
  promptVersion: number;
  savedAt: string;
  response: StatementReviewApiResponse;
};

export function saveStatementReviewCache(record: StatementReviewCacheRecord): void {
  safeSetStorage(STORAGE_KEY, record);
}

export function loadStatementReviewCache(): StatementReviewCacheRecord | null {
  // safeGetStorage が SSR ガード / JSON.parse 失敗を吸収するので、ここでは shape のみ検査する。
  const raw = safeGetStorage<unknown>(STORAGE_KEY, null);
  if (!isRecord(raw)) return null;
  return raw;
}

export function clearStatementReviewCache(): void {
  safeRemoveStorage(STORAGE_KEY);
}

// 旧形式 / 破損データを「壊れたまま hit 判定に流す」のを防ぐ最小限の runtime guard。
// hash 一致でも response が壊れていたら null を返して miss に倒す。
function isRecord(value: unknown): value is StatementReviewCacheRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.inputHash !== 'string') return false;
  if (typeof v.model !== 'string') return false;
  if (typeof v.promptVersion !== 'number') return false;
  if (typeof v.savedAt !== 'string') return false;
  if (!isApiReviewResponse(v.response)) return false;
  return true;
}

function isApiReviewResponse(value: unknown): value is StatementReviewApiResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.totalScore !== 'number') return false;
  if (!isScores(v.scores)) return false;
  if (!isStringArray(v.strengths)) return false;
  if (!isStringArray(v.weaknesses)) return false;
  if (!isStringArray(v.actions)) return false;
  if (!isStringArray(v.partialExamples)) return false;
  if (!isStringArray(v.checklist)) return false;
  return true;
}

function isScores(value: unknown): value is StatementReviewApiResponse['scores'] {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.logic === 'number' &&
    typeof v.specificity === 'number' &&
    typeof v.universityFit === 'number' &&
    typeof v.futureGoal === 'number' &&
    typeof v.originality === 'number'
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string');
}
