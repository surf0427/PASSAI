"use client";

/**
 * STEP-TUTOR-CONTEXT-PHASE2-REPOSITORY-01: basic_info_logs の DB 境界
 * （SQL / snake_case 翻訳 / RLS / never throw）。
 *
 * 位置づけ（selfAnalysisLogs.ts で確立した 3 層構造の横展開）:
 *   UI 保存箇所（app/input/basic/page.tsx）
 *     ↓
 *   lib/basicInfoStorage.ts            … LS canonical（同期・facade）
 *     ↓
 *   lib/repository/basicInfoRepository.ts … orchestration（dualWrite / backfill / restore）
 *     ↓ 委譲
 *   lib/supabase/basicInfoLogs.ts      … 本ファイル。DB 境界
 *     ↓
 *   Supabase（basic_info_logs, supabase/schema.sql §41–§43）
 *
 * 設計方針（selfAnalysisLogs.ts と同形）:
 *   - localStorage canonical は維持。本ファイルは "同期先 / durable mirror"。
 *   - 失敗時は never throw。すべて discriminated result で返す。
 *   - 所有者判定 / RLS / 保存キーには常に auth.users.id を使う。
 *   - getBrowserSupabaseClient() が null（env 未設定）なら no-env を返して no-op。
 *   - snapshot 型: UNIQUE(user_id) に対し onConflict='user_id' で upsert（1 行/ユーザー）。
 *   - .maybeSingle() で読む。
 *
 * PII 契約（anonymous basic_info_mirrors の stripName precedent を踏襲）:
 *   - payload から `name`（BasicInfo 唯一の直接 PII）を本境界で strip してから書く。
 *     呼び出し側で消し忘れても型システムを弱められないよう、境界の責務として除去する。
 *   - source_hash は strip 後 payload + SCHEMA_VERSION から derive する。
 *     conflict key ではなく変更検知ヒント（schema.sql §41 コメント参照）。
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";
import { sha256Hex } from "./mirrorSourceHash";

const TABLE = "basic_info_logs";
// ★ device 側の Source-Sync view が同じ値を使う必要があるため export する（E-S33）。
//   server row の `schema_version` は書き込み時のこの値であり、device 側が別値を
//   使うと fingerprint が永久に一致しない。値の正本はここ 1 箇所。
export const BASIC_INFO_SCHEMA_VERSION = "1";
const SCHEMA_VERSION = BASIC_INFO_SCHEMA_VERSION;

// select で取り出す列（snake_case）。schema.sql §41 の列順に合わせる。
const ROW_COLUMNS =
  "id, user_id, payload, schema_version, source_hash, created_at, updated_at, metadata";

type BasicInfoLogRow = {
  id: string;
  user_id: string;
  payload: Record<string, unknown>;
  schema_version: string;
  source_hash: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

// `name` を落とした新オブジェクトを返す（canonical を mutate しない）。
// mirrorBasicInfo.ts:stripName と同じ責務（PII を browser から出さない）。
function stripName(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...payload };
  delete rest.name;
  return rest;
}

export type UpsertBasicInfoLogResult =
  | { kind: "ok" }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * basic_info_logs を idempotent に upsert する（snapshot 型・1 ユーザー 1 行）。
 * payload から name を strip し、source_hash を derive してから書く。
 */
export async function upsertBasicInfoLogToSupabase(input: {
  userId: string;
  payload: Record<string, unknown>;
}): Promise<UpsertBasicInfoLogResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  try {
    const payloadWithoutName = stripName(input.payload);
    const sourceHash = await sha256Hex(
      JSON.stringify(payloadWithoutName) + SCHEMA_VERSION,
    );

    const { error } = await supabase.from(TABLE).upsert(
      {
        user_id: input.userId,
        payload: payloadWithoutName,
        schema_version: SCHEMA_VERSION,
        source_hash: sourceHash,
      },
      { onConflict: "user_id" },
    );
    if (error) {
      devWarn("[basicInfoLogs] upsert error", error);
      return { kind: "error", message: error.message };
    }
    return { kind: "ok" };
  } catch (err) {
    devWarn("[basicInfoLogs] upsert threw", err);
    const message = err instanceof Error ? err.message : "upsert threw";
    return { kind: "error", message };
  }
}

export type GetBasicInfoLogResult =
  | { kind: "ok"; payload: Record<string, unknown> | null }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * 自分の basic_info snapshot を 1 件返す（RLS により他人の行は取れない）。
 * 行が無ければ payload: null。payload は name strip 済み（保存時に除去済）。
 */
export async function getBasicInfoLogFromSupabase(
  userId: string,
): Promise<GetBasicInfoLogResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(ROW_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle<BasicInfoLogRow>();
    if (error) {
      devWarn("[basicInfoLogs] get error", error);
      return { kind: "error", message: error.message };
    }
    return { kind: "ok", payload: data?.payload ?? null };
  } catch (err) {
    devWarn("[basicInfoLogs] get threw", err);
    const message = err instanceof Error ? err.message : "get threw";
    return { kind: "error", message };
  }
}
