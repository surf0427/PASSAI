// 自己分析添削 → AI志望校マッチング へのデータ引き継ぎユーティリティ。
// 将来 Supabase に移行するときはこのファイルだけ書き換える。
//
// 【保存先】localStorage（ブラウザを閉じても残る）
// 【用途】/ （自己分析添削）→ /matching（マッチング）へのページ間の一時的な受け渡し
// 　　　　basicInfo・activityData・selfPRs の3つをまとめて1キーに保存する
// 【ライフサイクル】「AI志望校マッチングへ進む」ボタン押下時に保存 → /matching で読み込む

import type { AdmissionMatchingInput } from '@/types/admissionMatchingInput';
import type { MatchingResult, AiMatchAdvice } from '@/types/matching';
import { loadBasicInfo } from './basicInfoStorage';
import { loadActivityData } from './activityStorage';
import { loadSelfPRs } from './selfPRStorage';
import { loadWallHittingResult } from './wallHittingStorage';
import { safeGetStorage, safeSetStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'admissionMatchingInput';

// localStorage から basicInfo・activityData・selfPRs・wallHittingResult を集めて保存する。
// 「集めて save する」副作用付き。"診断を開始する" タイミングなど、ユーザーの意図ある
// アクション時にのみ呼ぶこと。画面を開いただけの mount restore には使わない
// （home の checkMatchingStatus が in_progress 判定にこの key 存在を見ているため、
//  単純な mount で write すると「ページを開いた瞬間 = in_progress」になってしまう）。
// 画面表示のための read-only restore には loadFreshMatchingInputSnapshot を使う。
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

// STEP6.6: collectAndSaveMatchingInput の read 部分のみを切り出した read-only 版。
//   個別 storage 4 つから直読みするだけで、admissionMatchingInput key への write は行わない。
//   matching page の mount restore で「画面を開いただけで進捗状態を変えてしまわない」ために使う。
//   collectAndSaveMatchingInput とは戻り値の中身が同じ shape だが、savedAt は常に「今」を入れる
//   （消費側がタイムスタンプを使う場合の互換性のため。型契約上は必須フィールド）。
export function loadFreshMatchingInputSnapshot(): AdmissionMatchingInput {
  return {
    basicInfo: loadBasicInfo(),
    activityData: loadActivityData(),
    selfPRs: loadSelfPRs(),
    wallHittingResult: loadWallHittingResult(),
    savedAt: new Date().toISOString(),
  };
}

// 保存済みの入力データを読み込む（集約 key 経由。個別 storage の最新を取りたい場合は
// loadFreshMatchingInputSnapshot を使うこと）
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

// ── AI マッチング結果キャッシュ ──────────────────────────────────
// 【保存先】localStorage
// 【用途】/admission-matching の「以前の診断結果を見る」ボタン
// 【ライフサイクル】API 成功時に保存 → 再訪問時 / handleShowCached で読み込み
//
// 注: timestamp（CACHE_TS_KEY）は既存ユーザーの保存データ互換のため raw ISO 文字列のまま扱う。
//     selfPR_draft と同様の legacy raw string 例外。新規 storage で raw string は使わない。

const CACHE_KEY = 'matchingResult';
const CACHE_TS_KEY = 'matchingTimestamp';

export type AiMatchAdviceCache = {
  results: MatchingResult[];
  aiAdvices: AiMatchAdvice[];
  matchingLevel: 'basic' | 'full';
};

export function loadAiMatchAdviceCache(): AiMatchAdviceCache | null {
  return safeGetStorage<AiMatchAdviceCache | null>(CACHE_KEY, null);
}

export function loadAiMatchAdviceTimestamp(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(CACHE_TS_KEY);
  } catch {
    return null;
  }
}

export function saveAiMatchAdviceCache(cache: AiMatchAdviceCache, timestamp: string): void {
  safeSetStorage(CACHE_KEY, cache);
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CACHE_TS_KEY, timestamp);
  } catch {
    // 保存失敗時もアプリは落とさない
  }
}

// 不足しているデータ項目名を返す（マッチングページでの警告表示に使う）
export function getMissingItems(input: AdmissionMatchingInput): string[] {
  const missing: string[] = [];
  if (!input.basicInfo) missing.push('基本情報');
  if (!input.activityData) missing.push('活動整理');
  if (input.selfPRs.length === 0) missing.push('自己分析添削');
  return missing;
}
