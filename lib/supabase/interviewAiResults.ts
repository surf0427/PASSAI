"use client";

/**
 * STEP-INTERVIEW-AI-PR8: interview_ai_results の read-through DB 境界。
 *
 * 役割:
 *   - 自分の **completed** AI 面接セッション + その結果（feedback）を読む。
 *   - user-scoped browser client（getBrowserSupabaseClient）で読むため RLS が効く。
 *     interview_ai_results の SELECT は session 経由の EXISTS（schema.sql §60）で owner に閉じる。
 *   - never throw。env 未設定 / error 時は空配列を返す（履歴 UI を壊さない）。
 *
 * 表示方針（pr8_history_merge.md §4）:
 *   - 履歴に出すのは **completed のみ**（本関数で status='completed' を絞る）。
 *   - in_progress / abandoned は本関数の対象外。
 *
 * 既存 InterviewFeedback 型はそのまま再利用（isInterviewFeedback で検証）。型は変更しない。
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";
import { isInterviewFeedback } from "@/lib/interview/isInterviewFeedback";
import type { InterviewFeedback } from "@/types/interview";

const SESSIONS = "interview_ai_sessions";

export type AiInterviewRow = {
  sessionId: string;
  createdAt: string;
  targetRef: Record<string, unknown>;
  interviewType: string;
  feedback: InterviewFeedback;
};

// PostgREST embed の戻り（results は配列で返りうる。UNIQUE(session_id) なので実質 0/1 件）。
type SessionWithResults = {
  id: string;
  created_at: string;
  target_ref: unknown;
  interview_type: string | null;
  interview_ai_results: { feedback: unknown }[] | { feedback: unknown } | null;
};

function firstResult(
  r: SessionWithResults["interview_ai_results"],
): { feedback: unknown } | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  return r;
}

/**
 * 自分の completed AI 面接を created_at 降順で返す。feedback が InterviewFeedback として
 * 妥当な行のみ返す（不正 / 欠落はスキップ）。RLS により他人の行は取れない。
 */
export async function listCompletedAiInterviews(
  userId: string,
): Promise<AiInterviewRow[]> {
  if (!userId) return [];
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from(SESSIONS)
      .select("id, created_at, target_ref, interview_type, interview_ai_results(feedback)")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("created_at", { ascending: false });
    if (error) {
      devWarn("[interviewAiResults] list error", error);
      return [];
    }

    const rows = (data ?? []) as SessionWithResults[];
    const out: AiInterviewRow[] = [];
    for (const row of rows) {
      const result = firstResult(row.interview_ai_results);
      if (!result) continue; // 結果未保存（理論上 completed なら必ずあるが防御）
      if (!isInterviewFeedback(result.feedback)) continue; // 不正 feedback はスキップ
      out.push({
        sessionId: row.id,
        createdAt: row.created_at,
        targetRef:
          row.target_ref && typeof row.target_ref === "object"
            ? (row.target_ref as Record<string, unknown>)
            : {},
        interviewType: row.interview_type ?? "free",
        feedback: result.feedback,
      });
    }
    return out;
  } catch (err) {
    devWarn("[interviewAiResults] list threw", err);
    return [];
  }
}
