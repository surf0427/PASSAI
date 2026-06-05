"use client";

/**
 * STEP-SUPABASE-COMPLETE-04B: self_analysis_logs の DB 境界（SQL / snake_case 翻訳 / RLS / never throw）。
 *
 * 位置づけ（tutor で確立した 3 層構造の横展開）:
 *   UI / loadMypageData
 *     ↓
 *   lib/selfAnalysisLogStorage.ts      … LS canonical（同期・facade。本ファイルを import しない）
 *     ↓
 *   lib/repository/selfAnalysisLogRepository.ts … orchestration（いつ / 何件 / 冪等 / flag）
 *     ↓ 委譲
 *   lib/supabase/selfAnalysisLogs.ts   … 本ファイル。DB 境界
 *     ↓
 *   Supabase（self_analysis_logs, supabase/schema.sql §32–§34）
 *
 * 設計方針（lib/supabase/tutorChat.ts と同形）:
 *   - localStorage canonical は維持。本ファイルは "同期先 / mirror 的扱い"。
 *   - 失敗時は never throw。すべて discriminated result で返す。
 *   - 所有者判定 / RLS / 保存キーには常に auth.users.id を使う。
 *   - getBrowserSupabaseClient() が null（env 未設定）なら no-env を返して no-op。
 *   - dev 環境のみ devWarn で観測可能性を残す（production は無音）。
 *
 * 型の方針（STEP-04B 補足制約）:
 *   - 生成済み Database 型には依存しない。table 未適用でも build が通るよう、
 *     row 型は本ファイル内の local type（ThdRow 相当）で定義する。
 *   - domain 型は types/selfAnalysisLog.ts の SelfAnalysisLog をそのまま使う。
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";
import type { SummaryResult, WallHittingResult } from "@/types/analysis";
import type { SelfAnalysisLog } from "@/types/selfAnalysisLog";

const TABLE = "self_analysis_logs";

// DB row（snake_case）の local type。生成 Database 型に依存しない（補足制約）。
// jsonb 列は domain 型へ as 経由で写す（DB 側は shape を強制しない契約）。
type SelfAnalysisLogRow = {
  id: string;
  user_id: string;
  local_log_id: string | null;
  summary_input_hash: string;
  analysis: WallHittingResult;
  displayed_questions: string[];
  answers: string[];
  deep_answers: string[];
  free_memo: string;
  summary: SummaryResult;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

// select で取り出す列（snake_case）。順序は schema.sql §32 に合わせる。
const ROW_COLUMNS =
  "id, user_id, local_log_id, summary_input_hash, analysis, displayed_questions, answers, deep_answers, free_memo, summary, created_at, updated_at, metadata";

// DB row → domain（SelfAnalysisLog）。
//   - DB の id は採番済み主キー。UI が使う log id は local_log_id（= 元の SelfAnalysisLog.id）。
//     local_log_id が NULL の古い行は DB id にフォールバックする。
//   - jsonb 配列列は NULL 安全に空配列へ倒す。
function rowToLog(row: SelfAnalysisLogRow): SelfAnalysisLog {
  return {
    id: row.local_log_id ?? row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summaryInputHash: row.summary_input_hash,
    analysis: row.analysis,
    displayedQuestions: row.displayed_questions ?? [],
    answers: row.answers ?? [],
    deepAnswers: row.deep_answers ?? [],
    freeMemo: row.free_memo ?? "",
    summary: row.summary,
  };
}

export type UpsertSelfAnalysisLogResult =
  | { kind: "ok"; logId: string }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * self_analysis_logs を idempotent に upsert する。
 *
 * - natural key: (user_id, summary_input_hash)。localStorage 側 persistSelfAnalysisLog の
 *   「同一 summaryInputHash は同一 entry を in-place 上書き」を onConflict で再現する。
 * - local_log_id / created_at も payload に含める。LS は update 時に id / createdAt を
 *   保持するため、毎回送っても値はぶれない（schema preview §4）。
 * - updated_at は DB trigger（§33）が前進させるので payload には含めない。
 */
export async function upsertSelfAnalysisLogToSupabase(input: {
  userId: string;
  log: SelfAnalysisLog;
  metadata?: Record<string, unknown>;
}): Promise<UpsertSelfAnalysisLogResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  const { log } = input;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(
        {
          user_id: input.userId,
          local_log_id: log.id,
          summary_input_hash: log.summaryInputHash,
          analysis: log.analysis,
          displayed_questions: log.displayedQuestions,
          answers: log.answers,
          deep_answers: log.deepAnswers,
          free_memo: log.freeMemo,
          summary: log.summary,
          created_at: log.createdAt,
          metadata: input.metadata ?? {},
        },
        { onConflict: "user_id,summary_input_hash" },
      )
      .select("local_log_id, id")
      .maybeSingle<{ local_log_id: string | null; id: string }>();
    if (error) {
      devWarn("[selfAnalysisLogs] upsert error", error);
      return { kind: "error", message: error.message };
    }
    if (!data) {
      return { kind: "error", message: "self_analysis_logs upsert returned no row" };
    }
    return { kind: "ok", logId: data.local_log_id ?? data.id };
  } catch (err) {
    devWarn("[selfAnalysisLogs] upsert threw", err);
    const message = err instanceof Error ? err.message : "upsert threw";
    return { kind: "error", message };
  }
}

export type ListSelfAnalysisLogsResult =
  | { kind: "ok"; logs: SelfAnalysisLog[] }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * 自分の自己分析ログを created_at 昇順（old → new）で返す。RLS により他人の行は取れない。
 * localStorage の追加順（loadMypageData.ts:207 コメント）と並びを揃える。
 * 本 STEP の UI からは未参照（hydrate の委譲先として用意）。
 */
export async function listSelfAnalysisLogsFromSupabase(
  userId: string,
): Promise<ListSelfAnalysisLogsResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(ROW_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) {
      devWarn("[selfAnalysisLogs] list error", error);
      return { kind: "error", message: error.message };
    }
    const rows = (data ?? []) as SelfAnalysisLogRow[];
    return { kind: "ok", logs: rows.map(rowToLog) };
  } catch (err) {
    devWarn("[selfAnalysisLogs] list threw", err);
    const message = err instanceof Error ? err.message : "list threw";
    return { kind: "error", message };
  }
}
