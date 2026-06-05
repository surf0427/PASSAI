'use client';

// STEP-TUTOR-CONTEXT-PHASE2-REPOSITORY-01: activity repository layer（orchestration 層）。
//
// 位置づけ（basicInfoRepository.ts と同形）:
//   UI 保存箇所（hooks/useActivityForm.ts:handleSubmit = submit-driven）
//     ↓ lib/activityStorage.ts（LS canonical / autosave）
//     ↓ 本ファイル（orchestration）
//     ↓ lib/supabase/activityLogs.ts（DB 境界）
//     ↓ Supabase（activity_logs）
//
// snapshot 型の方針:
//   - 1 ユーザー 1 行に ActivityData 全体を snapshot（UNIQUE(user_id) / onConflict='user_id'）。
//   - dualWrite は **submit-driven のみ**（autosave 直結は per-keystroke flood を招くため禁止。
//     activity_mirrors と同じ contract）。
//   - backfill（上り）は upsert で last-write-wins。
//   - restore（下り）は localStorage が空のときだけ取り込む（basicInfo と同方針）。
//   - payload は ActivityData verbatim（UI 状態・一時フィールドは ActivityData に含まれない）。

import {
  upsertActivityLogToSupabase,
  getActivityLogFromSupabase,
} from '@/lib/supabase/activityLogs';
import { loadActivityData, saveActivityData } from '@/lib/activityStorage';
import type { ActivityData } from '@/types/activity';
import { backfillDone, markBackfillDone } from './backfillFlag';

// ActivityData の全カテゴリ配列の合計件数。0 件なら未入力とみなす。
function activityCount(data: ActivityData | null): number {
  if (!data) return 0;
  let n = 0;
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) n += value.length;
  }
  return n;
}

// ── dualWrite（submit 後の 1 snapshot 同期） ───────────────────────────
export function dualWriteActivityLog(input: {
  userId: string;
  activityData: ActivityData;
}): Promise<unknown> {
  if (!input.userId) return Promise.resolve();
  if (activityCount(input.activityData) === 0) return Promise.resolve();
  return upsertActivityLogToSupabase({
    userId: input.userId,
    payload: input.activityData as unknown as Record<string, unknown>,
  });
}

// ── backfill（初回一括 LS → SB・上り） ────────────────────────────────

export type BackfillActivityLogResult =
  | { kind: 'ok' }
  | { kind: 'skipped'; reason: 'no-user' | 'already-done' | 'empty' }
  | { kind: 'no-env' }
  | { kind: 'error' };

export async function backfillActivityLogOnce(
  userId: string,
): Promise<BackfillActivityLogResult> {
  if (!userId) return { kind: 'skipped', reason: 'no-user' };
  if (backfillDone(userId, 'activityLog')) {
    return { kind: 'skipped', reason: 'already-done' };
  }

  const data = loadActivityData();
  if (activityCount(data) === 0) {
    markBackfillDone(userId, 'activityLog');
    return { kind: 'skipped', reason: 'empty' };
  }

  const upserted = await upsertActivityLogToSupabase({
    userId,
    payload: data as unknown as Record<string, unknown>,
  });
  if (upserted.kind === 'no-env') return { kind: 'no-env' };
  if (upserted.kind !== 'ok') return { kind: 'error' };

  markBackfillDone(userId, 'activityLog');
  return { kind: 'ok' };
}

// ── restore（SB → LS の one-way・初回 1 回・LS 空のときだけ） ───────────

export type RestoreActivityLogResult =
  | { kind: 'ok'; restored: boolean }
  | { kind: 'skipped'; reason: 'no-user' | 'already-done' | 'local-present' }
  | { kind: 'no-env' }
  | { kind: 'error' };

export async function restoreActivityLogOnce(
  userId: string,
): Promise<RestoreActivityLogResult> {
  if (!userId) return { kind: 'skipped', reason: 'no-user' };
  if (backfillDone(userId, 'activityLogRestore')) {
    return { kind: 'skipped', reason: 'already-done' };
  }

  if (activityCount(loadActivityData()) > 0) {
    markBackfillDone(userId, 'activityLogRestore');
    return { kind: 'skipped', reason: 'local-present' };
  }

  const result = await getActivityLogFromSupabase(userId);
  if (result.kind === 'no-env') return { kind: 'no-env' };
  if (result.kind !== 'ok') return { kind: 'error' };

  if (result.payload !== null) {
    saveActivityData(result.payload as unknown as ActivityData);
  }
  markBackfillDone(userId, 'activityLogRestore');
  return { kind: 'ok', restored: result.payload !== null };
}
