"use client";

/**
 * STEP-SUPABASE-COMPLETE-06B: statement_review_history の DB 境界
 * （SQL / snake_case 翻訳 / RLS / best-effort）。
 *
 * 位置づけ（tutor / selfAnalysisLogs / selfPRs で確立した 3 層構造の横展開）:
 *   UI / statement ページ
 *     ↓
 *   lib/statement/review/statementStorage.ts … LS canonical（key='statementReviewHistory'。本ファイルを import しない）
 *     ↓
 *   lib/repository/statementReviewHistoryRepository.ts … orchestration（いつ / 何件 / 冪等 / flag）
 *     ↓ 委譲
 *   lib/supabase/statementReviewHistory.ts … 本ファイル。DB 境界
 *     ↓
 *   Supabase（statement_review_history, supabase/schema.sql §38–§40）
 *
 * 設計方針（lib/supabase/selfPRs.ts と同形）:
 *   - localStorage canonical は維持。本ファイルは durable mirror（best-effort 同期先）。
 *   - 失敗時は never throw。upsert は void、list は空配列を返し、dev のみ devWarn で観測する。
 *     Supabase 障害で statement feature（添削 / 履歴表示）を壊さないことを最優先とする。
 *   - 所有者判定 / RLS / 保存キーには常に auth.users.id を使う。
 *   - getBrowserSupabaseClient() が null（env 未設定）なら no-op。
 *   - natural key = (user_id, local_review_id)。local_review_id = ReviewHistoryItem.id。
 *     inputHash / contentHash では dedup しない（preview §5）。
 *
 * 不変 feature 注意:
 *   ReviewHistoryItem は作成後 不変（本文編集なし）。upsert は冪等で、UPDATE 経路は
 *   同一内容の再書込のみ。delete / restore / tombstone は本 STEP では実装しない
 *   （delete 伝播・down-sync は 06E。release 前は LS → Supabase の上り mirror のみ）。
 *
 * 型の方針:
 *   - 生成済み Database 型には依存しない。table 未適用でも build が通るよう、
 *     row 型は本ファイル内の local type で定義する。
 *   - domain 型は lib/statement/review/statementStorage.ts の ReviewHistoryItem を使う。
 *   - statement_review_history には metadata 列は無い（06A 設計）。
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";
import type { ReviewHistoryItem } from "@/lib/statement/review/statementStorage";
import type { StatementResult } from "@/types/statement";

const TABLE = "statement_review_history";

// DB row（snake_case）の local type。生成 Database 型に依存しない。
type StatementReviewRow = {
  id: string;
  user_id: string;
  local_review_id: string;
  university: string;
  faculty: string;
  department: string;
  essay: string;
  result: StatementResult;
  created_at: string;
  updated_at: string;
};

// select で取り出す列（snake_case）。順序は schema.sql §38 に合わせる。
const ROW_COLUMNS =
  "id, user_id, local_review_id, university, faculty, department, essay, result, created_at, updated_at";

// ReviewHistoryItem（domain）→ statement_review_history row（upsert payload）。
//   - local_review_id = item.id（natural key の一部）。
//   - result は StatementResult 全体を jsonb 丸ごと送る。
//   - created_at は item.createdAt がある場合のみ送る。legacy LS データで欠けることが
//     あり、その場合は DB DEFAULT now() / onConflict 既存値保持に委ねる。
//   - updated_at は送らない（§39 trigger 任せ。item は不変なので client clock 不要）。
function itemToRow(userId: string, item: ReviewHistoryItem): Record<string, unknown> {
  const row: Record<string, unknown> = {
    user_id: userId,
    local_review_id: item.id,
    university: item.university,
    faculty: item.faculty,
    department: item.department,
    essay: item.essay,
    result: item.result,
  };
  if (item.createdAt) row.created_at = item.createdAt;
  return row;
}

// statement_review_history row → ReviewHistoryItem（domain）。
//   - UI が使う id は local_review_id（= 元の ReviewHistoryItem.id）。
function rowToItem(row: StatementReviewRow): ReviewHistoryItem {
  return {
    id: row.local_review_id,
    createdAt: row.created_at,
    university: row.university,
    faculty: row.faculty,
    department: row.department,
    essay: row.essay,
    result: row.result,
  };
}

/**
 * statement_review_history を idempotent に upsert する（durable mirror への 1 件書き込み）。
 *
 * - natural key: (user_id, local_review_id)。onConflict で同一履歴を冪等に書く。
 *   item は不変なので、再 upsert は同一内容を書くだけ（DO UPDATE）。
 * - localStorage が canonical なので、失敗しても throw しない（best-effort）。
 * - env 未設定 / error は dev のみ warn し、UI を壊さず黙って no-op する。
 */
export async function upsertStatementReviewToSupabase(args: {
  userId: string;
  item: ReviewHistoryItem;
}): Promise<void> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert(itemToRow(args.userId, args.item), {
        onConflict: "user_id,local_review_id",
      });
    if (error) {
      devWarn("[statementReviewHistory] upsert error", error);
    }
  } catch (err) {
    devWarn("[statementReviewHistory] upsert threw", err);
  }
}

/**
 * 自分の statement_review_history を created_at 降順で返す。RLS により他人の行は取れない。
 *
 * 将来の restore（下り）用に用意するが、本 STEP ではどこからも呼ばない。
 * env 未設定 / error 時は空配列を返す（never throw）。restore を実装する STEP では
 * 「空配列」と「取得失敗」を区別する必要が出るため、その時点で戻り型を見直すこと。
 */
export async function listStatementReviewsFromSupabase(
  userId: string,
): Promise<ReviewHistoryItem[]> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(ROW_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      devWarn("[statementReviewHistory] list error", error);
      return [];
    }
    const rows = (data ?? []) as StatementReviewRow[];
    return rows.map(rowToItem);
  } catch (err) {
    devWarn("[statementReviewHistory] list threw", err);
    return [];
  }
}
