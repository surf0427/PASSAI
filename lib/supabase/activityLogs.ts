"use client";

/**
 * STEP-TUTOR-CONTEXT-PHASE2-REPOSITORY-01: activity_logs の DB 境界
 * （SQL / snake_case 翻訳 / RLS / never throw）。
 *
 * 位置づけ（selfAnalysisLogs.ts / basicInfoLogs.ts と同形の 3 層構造）:
 *   UI 保存箇所（hooks/useActivityForm.ts:handleSubmit = submit-driven）
 *     ↓ lib/activityStorage.ts（LS canonical / autosave）
 *     ↓ lib/repository/activityRepository.ts（orchestration）
 *     ↓ 本ファイル（DB 境界）
 *     ↓ Supabase（activity_logs, supabase/schema.sql §47–§49）
 *
 * 設計方針:
 *   - localStorage canonical は維持。never throw。discriminated result。
 *   - snapshot 型: onConflict='user_id' で upsert（1 ユーザー 1 行に ActivityData 全体を snapshot）。
 *     .maybeSingle() で読む。
 *   - payload は ActivityData 全体（10 カテゴリ配列）。UI 状態・一時フィールドは元々
 *     ActivityData に含まれないため strip 不要（anonymous activity_mirrors と同方針で verbatim）。
 *   - source_hash は payload + SCHEMA_VERSION から derive する変更検知ヒント（conflict key
 *     ではない）。
 *   - 書き込みは submit-driven のみ（autosave 直結は per-keystroke flood を招くため禁止。
 *     dispatch は repository 経由で handleSubmit から行う。activity_mirrors と同じ contract）。
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";
import { sha256Hex } from "./mirrorSourceHash";

const TABLE = "activity_logs";
const SCHEMA_VERSION = "1";

const ROW_COLUMNS =
  "id, user_id, payload, schema_version, source_hash, created_at, updated_at, metadata";

type ActivityLogRow = {
  id: string;
  user_id: string;
  payload: Record<string, unknown>;
  schema_version: string;
  source_hash: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

export type UpsertActivityLogResult =
  | { kind: "ok" }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * activity_logs を idempotent に upsert する（snapshot 型・1 ユーザー 1 行）。
 */
export async function upsertActivityLogToSupabase(input: {
  userId: string;
  payload: Record<string, unknown>;
}): Promise<UpsertActivityLogResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  try {
    const sourceHash = await sha256Hex(
      JSON.stringify(input.payload) + SCHEMA_VERSION,
    );

    const { error } = await supabase.from(TABLE).upsert(
      {
        user_id: input.userId,
        payload: input.payload,
        schema_version: SCHEMA_VERSION,
        source_hash: sourceHash,
      },
      { onConflict: "user_id" },
    );
    if (error) {
      devWarn("[activityLogs] upsert error", error);
      return { kind: "error", message: error.message };
    }
    return { kind: "ok" };
  } catch (err) {
    devWarn("[activityLogs] upsert threw", err);
    const message = err instanceof Error ? err.message : "upsert threw";
    return { kind: "error", message };
  }
}

export type GetActivityLogResult =
  | { kind: "ok"; payload: Record<string, unknown> | null }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * 自分の activity snapshot を 1 件返す（RLS により他人の行は取れない）。
 * 行が無ければ payload: null。
 */
export async function getActivityLogFromSupabase(
  userId: string,
): Promise<GetActivityLogResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(ROW_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle<ActivityLogRow>();
    if (error) {
      devWarn("[activityLogs] get error", error);
      return { kind: "error", message: error.message };
    }
    return { kind: "ok", payload: data?.payload ?? null };
  } catch (err) {
    devWarn("[activityLogs] get threw", err);
    const message = err instanceof Error ? err.message : "get threw";
    return { kind: "error", message };
  }
}
