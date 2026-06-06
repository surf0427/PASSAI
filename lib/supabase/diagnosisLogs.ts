"use client";

/**
 * STEP-TUTOR-CONTEXT-PHASE2-REPOSITORY-01: diagnosis_logs の DB 境界
 * （SQL / snake_case 翻訳 / RLS / never throw）。
 *
 * 位置づけ（selfAnalysisLogs.ts / basicInfoLogs.ts と同形の 3 層構造）:
 *   UI 保存箇所（app/diagnosis/page.tsx）
 *     ↓ lib/diagnosisStorage.ts（LS canonical）
 *     ↓ lib/repository/diagnosisRepository.ts（orchestration）
 *     ↓ 本ファイル（DB 境界）
 *     ↓ Supabase（diagnosis_logs, supabase/schema.sql §44–§46）
 *
 * 設計方針:
 *   - localStorage canonical は維持。never throw。discriminated result。
 *   - snapshot 型: onConflict='user_id' で upsert（1 行/ユーザー）。.maybeSingle() で読む。
 *   - payload は no-PII（answers は数値 index / resultType は固定 enum / title・description は
 *     app 製固定文）。strip は不要（anonymous diagnosis_mirrors と同方針）。
 *   - source_hash は payload + SCHEMA_VERSION から derive する変更検知ヒント（conflict key
 *     ではない）。anonymous mirror は { answers, resultType } のみを hash 化するが、本 durable
 *     層は conflict key が user_id のため、snapshot 全体を hash 対象にして変更検知を素直にする。
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";
import { sha256Hex } from "./mirrorSourceHash";

const TABLE = "diagnosis_logs";
// v1 → v2: Phase 2 で calcDiagnosisResultType の判定ロジックを raw count から
// normalized scoring + 安定タイブレークへ変更したため bump（同一回答でも resultType が
// 変わり得る）。payload 形状自体は不変。
// v2 → v3: STEP-DIAGNOSIS-MIGRATION で 9タイプ診断（ExamType・文字列 resultType・15問 answers）を
// 追加。payload の resultType が number(1-4) / string(9種) の両方を取り得るようになったため bump。
// ⚠️ DRIFT 注意: 同名定数が lib/supabase/mirrorDiagnosis.ts にも別途存在する。
// 判定ロジック / QUESTIONS / DiagnosisType / ExamType を変える時は両方を同時に bump すること。
const SCHEMA_VERSION = "3";

const ROW_COLUMNS =
  "id, user_id, payload, schema_version, source_hash, created_at, updated_at, metadata";

type DiagnosisLogRow = {
  id: string;
  user_id: string;
  payload: Record<string, unknown>;
  schema_version: string;
  source_hash: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

export type UpsertDiagnosisLogResult =
  | { kind: "ok" }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * diagnosis_logs を idempotent に upsert する（snapshot 型・1 ユーザー 1 行）。
 */
export async function upsertDiagnosisLogToSupabase(input: {
  userId: string;
  payload: Record<string, unknown>;
}): Promise<UpsertDiagnosisLogResult> {
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
      devWarn("[diagnosisLogs] upsert error", error);
      return { kind: "error", message: error.message };
    }
    return { kind: "ok" };
  } catch (err) {
    devWarn("[diagnosisLogs] upsert threw", err);
    const message = err instanceof Error ? err.message : "upsert threw";
    return { kind: "error", message };
  }
}

export type GetDiagnosisLogResult =
  | { kind: "ok"; payload: Record<string, unknown> | null }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * 自分の diagnosis snapshot を 1 件返す（RLS により他人の行は取れない）。
 * 行が無ければ payload: null。
 */
export async function getDiagnosisLogFromSupabase(
  userId: string,
): Promise<GetDiagnosisLogResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(ROW_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle<DiagnosisLogRow>();
    if (error) {
      devWarn("[diagnosisLogs] get error", error);
      return { kind: "error", message: error.message };
    }
    return { kind: "ok", payload: data?.payload ?? null };
  } catch (err) {
    devWarn("[diagnosisLogs] get threw", err);
    const message = err instanceof Error ? err.message : "get threw";
    return { kind: "error", message };
  }
}
