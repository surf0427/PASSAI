"use client";

/**
 * 小論文 essay_workspaces の DB 境界（SQL / snake_case 翻訳 / RLS / never throw）。
 *
 * 位置づけ（tutor / selfAnalysisLogs / selfPRs / statementReviewHistory で確立した
 * 3 層構造の横展開）:
 *   UI / essay ページ
 *     ↓
 *   lib/essayWorkspaceStorage.ts          … LS canonical（key='essayWorkspaces'。本ファイルを import しない）
 *     ↓
 *   lib/repository/essayWorkspaceRepository.ts … orchestration（いつ / 何件 / 冪等 / flag / debounce）
 *     ↓ 委譲
 *   lib/supabase/essayWorkspaces.ts        … 本ファイル。DB 境界
 *     ↓
 *   Supabase（essay_workspaces, supabase/schema.sql §50–§52）
 *
 * 設計方針（lib/supabase/selfAnalysisLogs.ts と同形）:
 *   - localStorage canonical は維持。本ファイルは durable mirror（best-effort 同期先）。
 *   - 失敗時は never throw。すべて discriminated result で返す。
 *     Supabase 障害で essay feature（添削 / 履歴表示）を壊さないことを最優先とする。
 *   - 所有者判定 / RLS / 保存キーには常に auth.users.id を使う。
 *   - getBrowserSupabaseClient() が null（env 未設定）なら no-env を返して no-op。
 *   - natural key = (user_id, local_workspace_id)。local_workspace_id = EssayWorkspace.id。
 *
 * 【志望理由書(statement)とは別機能】statement_review_history（§38）とは混同しない。
 * 本 table は小論文(essay)練習ワークスペース専用。
 *
 * statement との違い: ReviewHistoryItem は不変だが EssayWorkspace は可変
 * （body autosave / reviews 追記 / improvement 更新）。よって upsert は workspace 全体を
 * 都度上書きする mirror として使う（onConflict で冪等）。
 *
 * 型の方針:
 *   - 生成済み Database 型には依存しない。table 未適用でも build が通るよう、
 *     row 型は本ファイル内の local type で定義する。
 *   - domain 型は types/essay.ts の EssayWorkspace をそのまま使う。
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";
import type { EssayWorkspace } from "@/types/essay";

const TABLE = "essay_workspaces";

// DB row（snake_case）の local type。生成 Database 型に依存しない。
type EssayWorkspaceRow = {
  id: string;
  user_id: string;
  local_workspace_id: string;
  workspace: EssayWorkspace;
  created_at: string;
  updated_at: string;
};

// select で取り出す列（snake_case）。順序は schema.sql §50 に合わせる。
const ROW_COLUMNS =
  "id, user_id, local_workspace_id, workspace, created_at, updated_at";

// DB row → domain（EssayWorkspace）。
//   - UI が使う id は workspace.id（= local_workspace_id）。jsonb をそのまま返す。
function rowToWorkspace(row: EssayWorkspaceRow): EssayWorkspace {
  return row.workspace;
}

export type UpsertEssayWorkspaceResult =
  | { kind: "ok" }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * essay_workspaces を idempotent に upsert する（durable mirror への 1 件書き込み）。
 *
 * - natural key: (user_id, local_workspace_id)。onConflict で同一 workspace を冪等に書く。
 *   EssayWorkspace は可変なので、再 upsert は最新の workspace 全体を DO UPDATE で上書きする。
 * - created_at は workspace.createdAt を原値保持。updated_at は DB trigger（§51）任せ。
 * - localStorage が canonical なので、失敗しても throw しない（best-effort）。
 * - env 未設定 / error は no-env / error の discriminated result で返す（呼び出し側が UI 反映可能）。
 */
export async function upsertEssayWorkspaceToSupabase(args: {
  userId: string;
  workspace: EssayWorkspace;
}): Promise<UpsertEssayWorkspaceResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  const { workspace } = args;

  try {
    const { error } = await supabase.from(TABLE).upsert(
      {
        user_id: args.userId,
        local_workspace_id: workspace.id,
        workspace,
        created_at: workspace.createdAt,
      },
      { onConflict: "user_id,local_workspace_id" },
    );
    if (error) {
      devWarn("[essayWorkspaces] upsert error", error);
      return { kind: "error", message: error.message };
    }
    return { kind: "ok" };
  } catch (err) {
    devWarn("[essayWorkspaces] upsert threw", err);
    const message = err instanceof Error ? err.message : "upsert threw";
    return { kind: "error", message };
  }
}

/**
 * 自分の essay_workspaces を updated_at 降順で返す。RLS により他人の行は取れない。
 *
 * 将来の restore（下り）用に用意するが、本 STEP ではどこからも呼ばない。
 * env 未設定 / error 時は空配列を返す（never throw）。
 */
export async function listEssayWorkspacesFromSupabase(
  userId: string,
): Promise<EssayWorkspace[]> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(ROW_COLUMNS)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) {
      devWarn("[essayWorkspaces] list error", error);
      return [];
    }
    const rows = (data ?? []) as EssayWorkspaceRow[];
    return rows.map(rowToWorkspace);
  } catch (err) {
    devWarn("[essayWorkspaces] list threw", err);
    return [];
  }
}
