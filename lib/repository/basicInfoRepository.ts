'use client';

// STEP-TUTOR-CONTEXT-PHASE2-REPOSITORY-01: basicInfo repository layer（orchestration 層）。
//
// 位置づけ（selfAnalysisLogRepository.ts と同じ 3 層構造の横展開）:
//   UI / 保存箇所（app/input/basic/page.tsx）
//     ↓
//   lib/basicInfoStorage.ts            … LS canonical（同期・facade）
//     ↓
//   lib/repository/basicInfoRepository.ts … 本ファイル。orchestration（いつ / 冪等 / flag）
//     ↓ 委譲
//   lib/supabase/basicInfoLogs.ts      … DB 境界（snake_case / RLS / never throw）
//     ↓
//   Supabase（basic_info_logs）
//
// snapshot 型の方針:
//   - basic_info は 1 ユーザー 1 最新 snapshot（UNIQUE(user_id) / onConflict='user_id'）。
//   - dualWrite / backfill（上り）は upsert で last-write-wins（最新が上書き）。
//   - restore（下り）は **localStorage が空のときだけ** 取り込む。既存の local 編集を
//     古い可能性のある remote snapshot で握り潰さないための保守的方針（selfAnalysisLogs の
//     hash merge と異なり、snapshot には信頼できる per-entry の updatedAt 比較が無いため）。
//   - PII（氏名）は DB 境界 basicInfoLogs.ts:stripName が除去するため、restore で復元される
//     basicInfo には name が含まれない（空のまま）。Tutor 用途では name 不要のため許容する。
//
// boundary 安全: 委譲先 basicInfoLogs.ts は "use client"。本ファイルも "use client" を宣言し
// server bundle に browser client を引き込まない。AuthProvider からは dynamic import で呼ぶ。

import {
  upsertBasicInfoLogToSupabase,
  getBasicInfoLogFromSupabase,
} from '@/lib/supabase/basicInfoLogs';
import { loadBasicInfo, saveBasicInfo } from '@/lib/basicInfoStorage';
import type { BasicInfo } from '@/types/basicInfo';
import { backfillDone, markBackfillDone } from './backfillFlag';

// 値が無い basicInfo（全フィールド空）を「書く価値なし」と判定する最小ガード。
// 志望校が 1 件も無く grade も track も空なら未入力とみなす。
function isEmptyBasicInfo(info: BasicInfo | null): boolean {
  if (!info) return true;
  const hasPreference = (info.preferences ?? []).some(
    (p) => (p.university ?? '').trim() !== '' || (p.faculty ?? '').trim() !== '',
  );
  return (
    (info.grade ?? '').trim() === '' &&
    (info.track ?? '').trim() === '' &&
    !hasPreference
  );
}

// ── dualWrite（LS 保存後の 1 snapshot 同期） ───────────────────────────
//
// save site（page.tsx handleSubmit）から persist 後に呼ぶ。fire-and-forget 前提。
// 空 payload は書かない。境界が name strip + source_hash derive を行う。
export function dualWriteBasicInfoLog(input: {
  userId: string;
  basicInfo: BasicInfo;
}): Promise<unknown> {
  if (!input.userId) return Promise.resolve();
  if (isEmptyBasicInfo(input.basicInfo)) return Promise.resolve();
  return upsertBasicInfoLogToSupabase({
    userId: input.userId,
    payload: input.basicInfo as unknown as Record<string, unknown>,
  });
}

// ── backfill（初回一括 LS → SB・上り） ────────────────────────────────

export type BackfillBasicInfoLogResult =
  | { kind: 'ok' }
  | { kind: 'skipped'; reason: 'no-user' | 'already-done' | 'empty' }
  | { kind: 'no-env' }
  | { kind: 'error' };

/**
 * 現在の localStorage basicInfo を Supabase へ初回 1 回同期する。
 * - flag（'basicInfoLog'）完了済みなら skip。
 * - 空なら flag を立てて skip。
 * - 成功時のみ flag を立てる。失敗時は立てず次回再試行。never throw。
 */
export async function backfillBasicInfoLogOnce(
  userId: string,
): Promise<BackfillBasicInfoLogResult> {
  if (!userId) return { kind: 'skipped', reason: 'no-user' };
  if (backfillDone(userId, 'basicInfoLog')) {
    return { kind: 'skipped', reason: 'already-done' };
  }

  const info = loadBasicInfo();
  if (isEmptyBasicInfo(info)) {
    markBackfillDone(userId, 'basicInfoLog');
    return { kind: 'skipped', reason: 'empty' };
  }

  const result = await upsertBasicInfoLogToSupabase({
    userId,
    payload: info as unknown as Record<string, unknown>,
  });
  if (result.kind === 'no-env') return { kind: 'no-env' };
  if (result.kind !== 'ok') return { kind: 'error' };

  markBackfillDone(userId, 'basicInfoLog');
  return { kind: 'ok' };
}

// ── restore（SB → LS の one-way・初回 1 回・LS 空のときだけ） ───────────

export type RestoreBasicInfoLogResult =
  | { kind: 'ok'; restored: boolean }
  | { kind: 'skipped'; reason: 'no-user' | 'already-done' | 'local-present' }
  | { kind: 'no-env' }
  | { kind: 'error' };

/**
 * Supabase の basicInfo snapshot を localStorage に復元する（初回 1 回）。
 * - flag（'basicInfoLogRestore'）完了済みなら skip。
 * - localStorage に既存 basicInfo があれば **書き戻さない**（local-present で skip）。
 *   古い remote で新しい local を握り潰さない保守的方針。
 * - remote が無ければ flag を立てて終了（取り込むものが無いのは正常完了）。
 * - 復元時は saveBasicInfo（canonical facade）で書く。name は strip 済みのため空のまま。
 * - never throw。
 */
export async function restoreBasicInfoLogOnce(
  userId: string,
): Promise<RestoreBasicInfoLogResult> {
  if (!userId) return { kind: 'skipped', reason: 'no-user' };
  if (backfillDone(userId, 'basicInfoLogRestore')) {
    return { kind: 'skipped', reason: 'already-done' };
  }

  // local が既にあるなら復元しない（上書き事故防止）。
  if (!isEmptyBasicInfo(loadBasicInfo())) {
    markBackfillDone(userId, 'basicInfoLogRestore');
    return { kind: 'skipped', reason: 'local-present' };
  }

  const result = await getBasicInfoLogFromSupabase(userId);
  if (result.kind === 'no-env') return { kind: 'no-env' };
  if (result.kind !== 'ok') return { kind: 'error' };

  if (result.payload !== null) {
    saveBasicInfo(result.payload as unknown as BasicInfo);
  }
  markBackfillDone(userId, 'basicInfoLogRestore');
  return { kind: 'ok', restored: result.payload !== null };
}
