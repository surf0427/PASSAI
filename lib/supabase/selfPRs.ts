"use client";

/**
 * STEP-SUPABASE-COMPLETE-05B: self_prs の DB 境界（SQL / snake_case 翻訳 / RLS / best-effort）。
 *
 * 位置づけ（tutor / selfAnalysisLogs で確立した 3 層構造の横展開）:
 *   UI / self-pr ページ
 *     ↓
 *   lib/selfPRStorage.ts            … LS canonical（key='selfPRs'。本ファイルを import しない）
 *     ↓
 *   lib/repository/selfPRRepository.ts … orchestration（いつ / 何件 / 冪等 / flag / delta）
 *     ↓ 委譲
 *   lib/supabase/selfPRs.ts         … 本ファイル。DB 境界
 *     ↓
 *   Supabase（self_prs, supabase/schema.sql §35–§37）
 *
 * 設計方針（lib/supabase/selfAnalysisLogs.ts と同形）:
 *   - localStorage canonical は維持。本ファイルは durable mirror（best-effort 同期先）。
 *   - 失敗時は never throw。upsert / delete は void を返し、dev のみ devWarn で観測する。
 *   - 所有者判定 / RLS / 保存キーには常に auth.users.id を使う。
 *   - getBrowserSupabaseClient() が null（env 未設定）なら no-op。
 *   - natural key = (user_id, local_pr_id)。local_pr_id = SelfPR.id。
 *
 * delete feature 注意:
 *   self_prs は削除を伴う feature。本ファイルは owner-scoped delete を提供するが、
 *   restore / down-sync は実装しない（delete resurrection 回避。tombstone 別 STEP）。
 *
 * 型の方針:
 *   - 生成済み Database 型には依存しない。table 未適用でも build が通るよう、
 *     row 型は本ファイル内の local type で定義する。
 *   - domain 型は types/selfPR.ts の SelfPR をそのまま使う。
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";
import type { SelfPR } from "@/types/selfPR";

const TABLE = "self_prs";

// DB row（snake_case）の local type。生成 Database 型に依存しない。
type SelfPRRow = {
  id: string;
  user_id: string;
  local_pr_id: string;
  pr_index: number;
  title: string;
  body: string;
  latest_result: string;
  seed_input_hash: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

// select で取り出す列（snake_case）。順序は schema.sql §35 に合わせる。
const ROW_COLUMNS =
  "id, user_id, local_pr_id, pr_index, title, body, latest_result, seed_input_hash, created_at, updated_at, metadata";

// SelfPR（domain）→ self_prs row（upsert payload）。
//   - local_pr_id = pr.id（natural key の一部）。
//   - title は optional なので '' に倒す（DB 側 NOT NULL DEFAULT '' と整合）。
//   - seed_input_hash は補助情報。未設定なら NULL（dedup key ではない）。
//   - created_at は pr.createdAt がある場合のみ送る。既存 LS データは undefined のことが
//     あり、その場合は DB DEFAULT now() に委ねる（onConflict update では既存値を保持）。
//   - updated_at は pr.updatedAt を送る。なお UPDATE 経路は §36 trigger が now() で
//     上書きするため、初期 INSERT 時の値として効く。
function prToRow(userId: string, pr: SelfPR): Record<string, unknown> {
  const row: Record<string, unknown> = {
    user_id: userId,
    local_pr_id: pr.id,
    pr_index: pr.index,
    title: pr.title ?? "",
    body: pr.text,
    latest_result: pr.latestResult,
    seed_input_hash: pr.seedInputHash ?? null,
    updated_at: pr.updatedAt,
  };
  if (pr.createdAt) row.created_at = pr.createdAt;
  return row;
}

// self_prs row → SelfPR（domain）。
//   - UI が使う id は local_pr_id（= 元の SelfPR.id）。
//   - seed_input_hash は NULL を undefined に倒す（domain は optional）。
function rowToSelfPR(row: SelfPRRow): SelfPR {
  return {
    id: row.local_pr_id,
    index: row.pr_index,
    title: row.title,
    text: row.body,
    latestResult: row.latest_result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seedInputHash: row.seed_input_hash ?? undefined,
  };
}

/**
 * self_prs を idempotent に upsert する（durable mirror への 1 件書き込み）。
 *
 * - natural key: (user_id, local_pr_id)。onConflict で同一カードを in-place update する。
 * - localStorage が canonical なので、失敗しても throw しない（best-effort）。
 * - env 未設定 / error は dev のみ warn し、UI を壊さず黙って no-op する。
 */
export async function upsertSelfPRToSupabase(args: {
  userId: string;
  pr: SelfPR;
}): Promise<void> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert(prToRow(args.userId, args.pr), {
        onConflict: "user_id,local_pr_id",
      });
    if (error) {
      devWarn("[selfPRs] upsert error", error);
    }
  } catch (err) {
    devWarn("[selfPRs] upsert threw", err);
  }
}

/**
 * self_prs の 1 行を owner-scoped で削除する。
 *
 * - 条件: user_id = args.userId AND local_pr_id = args.localPrId。
 * - RLS（§37 owner delete）と二重で owner を絞る。
 * - 失敗しても throw しない（best-effort）。
 *
 * 注: 本関数は delete 伝播（dualWrite の propagateDelete）からのみ使う想定。
 *     down-sync / restore は実装しないため、ここでは tombstone を残さず物理削除する。
 */
export async function deleteSelfPRFromSupabase(args: {
  userId: string;
  localPrId: string;
}): Promise<void> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq("user_id", args.userId)
      .eq("local_pr_id", args.localPrId);
    if (error) {
      devWarn("[selfPRs] delete error", error);
    }
  } catch (err) {
    devWarn("[selfPRs] delete threw", err);
  }
}

/**
 * 自分の self_prs を pr_index 昇順 → created_at 昇順で返す。RLS により他人の行は取れない。
 *
 * 将来の restore（下り）用に用意するが、本 STEP ではどこからも呼ばない。
 * env 未設定 / error 時は空配列を返す（never throw）。restore を実装する STEP では
 * 「空配列」と「取得失敗」を区別する必要が出るため、その時点で戻り型を見直すこと。
 */
export async function listSelfPRsFromSupabase(userId: string): Promise<SelfPR[]> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(ROW_COLUMNS)
      .eq("user_id", userId)
      .order("pr_index", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      devWarn("[selfPRs] list error", error);
      return [];
    }
    const rows = (data ?? []) as SelfPRRow[];
    return rows.map(rowToSelfPR);
  } catch (err) {
    devWarn("[selfPRs] list threw", err);
    return [];
  }
}
