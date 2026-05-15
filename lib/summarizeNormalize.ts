// /api/summarize の入力正規化ヘルパ（client / server 共有・純粋関数）。
//
// 役割:
//   client (page.tsx) と server (app/api/summarize/route.ts) で同じ正規化結果を得るためのレイヤー。
//   hashSummarizeInput に渡す配列と /api/summarize の body に渡す配列を「同じ正規化結果」に
//   揃えることで、cache key と prompt 入力のズレで「同入力なのに常に cache miss」状態に
//   なるのを防ぐ。
//
// 設計:
//   - 副作用なし。AI 呼び出しなし。localStorage 読み書きなし
//   - 「正規化された配列」は length == targetLength を必ず満たす
//   - StudentProfile / SummaryResult / WallHittingResult には流さない（working memory 扱い）
//
// 関連: lib/aiInputHash.ts:hashSummarizeInput / lib/prompts.ts:buildSummarizePrompt

import type { SummaryResult } from '@/types/analysis';

// 深掘りメモ配列を /api/summarize 入力用に正規化する。
//   - input が undefined / 配列でない → targetLength 分の空文字配列
//   - 各要素を trim する（string でない要素は '' に倒す）
//   - targetLength より長ければ先頭から slice
//   - 短ければ末尾を空文字で埋める
// 戻り値は必ず length === targetLength の string[]。
export function normalizeDeepAnswers(
  input: string[] | undefined,
  targetLength: number,
): string[] {
  if (targetLength <= 0) return [];
  const safe = Array.isArray(input) ? input : [];
  const out: string[] = new Array(targetLength).fill('');
  for (let i = 0; i < targetLength; i++) {
    const v = safe[i];
    if (typeof v === 'string') out[i] = v.trim();
  }
  return out;
}

// 自由メモを /api/summarize 入力用に正規化する。
//   - input が string でない（undefined / null / 数値 / object など） → ''
//   - trim 適用
//   - FREE_MEMO_MAX_CHARS で truncate（client / server 双方で同じ上限を強制）
// client (page.tsx) と server (route.ts) が同 helper を経由することで、ユーザー入力が
// 上限を超えた場合でも hash key と AI 入力が常に一致する（cache miss 暴発を防ぐ）。
// prompt 肥大化 / token コスト抑止のため 200 字を絶対上限とする。
export const FREE_MEMO_MAX_CHARS = 200;

export function normalizeFreeMemo(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, FREE_MEMO_MAX_CHARS);
}

// AI の生 JSON を SummaryResult に揃える。
// prompt は activitySummary / strengths / appealPoints の 3 フィールドのみを返す。
//
// 元は app/api/summarize/route.ts に同居していたが、本ファイルが summarize 系の
// 純粋正規化 helper を集めているため co-locate した。input 正規化（deepAnswers /
// freeMemo）と output 正規化（本関数）の両方を 1 ファイルで管理する形になる。
// 戻り値 SummaryResult shape は変えない。POST handler / SummarySection / summarizeCache
// 経路がこの 3 フィールド構造に依存している。
export function normalizeSummary(raw: unknown): SummaryResult {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const activitySummary = typeof obj.activitySummary === 'string' ? obj.activitySummary : '';
  const strengths       = typeof obj.strengths === 'string' ? obj.strengths : '';
  const appealPoints    = typeof obj.appealPoints === 'string' ? obj.appealPoints : '';
  return {
    activitySummary,
    strengths,
    appealPoints,
  };
}
