'use client';

// STEP-TUTOR-CONTEXT-PHASE2-REPOSITORY-01: diagnosis repository layer（orchestration 層）。
//
// 位置づけ（basicInfoRepository.ts と同形）:
//   UI 保存箇所（app/diagnosis/page.tsx）
//     ↓ lib/diagnosisStorage.ts（LS canonical）
//     ↓ 本ファイル（orchestration）
//     ↓ lib/supabase/diagnosisLogs.ts（DB 境界）
//     ↓ Supabase（diagnosis_logs）
//
// snapshot 型の方針:
//   - 受験タイプ診断は 1 ユーザー 1 最新 snapshot（UNIQUE(user_id) / onConflict='user_id'）。
//   - dualWrite / backfill（上り）は upsert で last-write-wins。
//   - restore（下り）は localStorage が空のときだけ取り込む（basicInfo と同方針）。
//   - payload は no-PII（数値 index / 固定 enum / app 製固定文）。strip 不要。

import {
  upsertDiagnosisLogToSupabase,
  getDiagnosisLogFromSupabase,
} from '@/lib/supabase/diagnosisLogs';
import {
  loadDiagnosisResult,
  saveDiagnosisResult,
  type DiagnosisResult,
} from '@/lib/diagnosisStorage';
import { backfillDone, markBackfillDone } from './backfillFlag';

// 診断結果が実在するかの最小ガード。answers が空配列なら未診断とみなす。
function isEmptyDiagnosis(result: DiagnosisResult | null): boolean {
  if (!result) return true;
  return !Array.isArray(result.answers) || result.answers.length === 0;
}

// ── dualWrite（LS 保存後の 1 snapshot 同期） ───────────────────────────
export function dualWriteDiagnosisLog(input: {
  userId: string;
  diagnosis: DiagnosisResult;
}): Promise<unknown> {
  if (!input.userId) return Promise.resolve();
  if (isEmptyDiagnosis(input.diagnosis)) return Promise.resolve();
  return upsertDiagnosisLogToSupabase({
    userId: input.userId,
    payload: input.diagnosis as unknown as Record<string, unknown>,
  });
}

// ── backfill（初回一括 LS → SB・上り） ────────────────────────────────

export type BackfillDiagnosisLogResult =
  | { kind: 'ok' }
  | { kind: 'skipped'; reason: 'no-user' | 'already-done' | 'empty' }
  | { kind: 'no-env' }
  | { kind: 'error' };

export async function backfillDiagnosisLogOnce(
  userId: string,
): Promise<BackfillDiagnosisLogResult> {
  if (!userId) return { kind: 'skipped', reason: 'no-user' };
  if (backfillDone(userId, 'diagnosisLog')) {
    return { kind: 'skipped', reason: 'already-done' };
  }

  const result = loadDiagnosisResult();
  if (isEmptyDiagnosis(result)) {
    markBackfillDone(userId, 'diagnosisLog');
    return { kind: 'skipped', reason: 'empty' };
  }

  const upserted = await upsertDiagnosisLogToSupabase({
    userId,
    payload: result as unknown as Record<string, unknown>,
  });
  if (upserted.kind === 'no-env') return { kind: 'no-env' };
  if (upserted.kind !== 'ok') return { kind: 'error' };

  markBackfillDone(userId, 'diagnosisLog');
  return { kind: 'ok' };
}

// ── restore（SB → LS の one-way・初回 1 回・LS 空のときだけ） ───────────

export type RestoreDiagnosisLogResult =
  | { kind: 'ok'; restored: boolean }
  | { kind: 'skipped'; reason: 'no-user' | 'already-done' | 'local-present' }
  | { kind: 'no-env' }
  | { kind: 'error' };

export async function restoreDiagnosisLogOnce(
  userId: string,
): Promise<RestoreDiagnosisLogResult> {
  if (!userId) return { kind: 'skipped', reason: 'no-user' };
  if (backfillDone(userId, 'diagnosisLogRestore')) {
    return { kind: 'skipped', reason: 'already-done' };
  }

  if (!isEmptyDiagnosis(loadDiagnosisResult())) {
    markBackfillDone(userId, 'diagnosisLogRestore');
    return { kind: 'skipped', reason: 'local-present' };
  }

  const result = await getDiagnosisLogFromSupabase(userId);
  if (result.kind === 'no-env') return { kind: 'no-env' };
  if (result.kind !== 'ok') return { kind: 'error' };

  if (result.payload !== null) {
    saveDiagnosisResult(result.payload as unknown as DiagnosisResult);
  }
  markBackfillDone(userId, 'diagnosisLogRestore');
  return { kind: 'ok', restored: result.payload !== null };
}
