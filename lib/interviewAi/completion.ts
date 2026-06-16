import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { InterviewFeedback } from '@/types/interview';

/**
 * STEP-INTERVIEW-AI-PR7: complete / abandon の DB 境界。
 *
 * 失敗を握り潰さない（PR7 必須条件）: error をそのまま返し、route 側で明示エラー（500）に
 * 変換する。best-effort（void）にはしない。
 *
 * recordUsage は **一切呼ばない**（complete / abandon は課金トリガではない）。本ファイルは
 * lib/billing を import しない。
 */

const SESSIONS = 'interview_ai_sessions';
const RESULTS = 'interview_ai_results';

/**
 * interview_ai_results を upsert する（1 セッション 1 結果 / onConflict session_id）。
 * 再 complete（同一 session 再生成）でも冪等に上書きする。
 */
export async function saveInterviewAiResults(
  admin: SupabaseClient,
  args: {
    sessionId: string;
    userId: string;
    feedback: InterviewFeedback;
    strengths: string[];
    improvements: string[];
    nextPractice: string[];
  },
): Promise<{ error: unknown }> {
  const { error } = await admin.from(RESULTS).upsert(
    {
      session_id: args.sessionId,
      user_id: args.userId,
      feedback: args.feedback,
      strengths: args.strengths,
      improvements: args.improvements,
      next_practice: args.nextPractice,
    },
    { onConflict: 'session_id' },
  );
  return { error };
}

/**
 * session.status を更新する（completed / abandoned）。in_progress の行だけを対象にし、
 * 二重遷移（既に completed/abandoned）を弾く。更新行 0 件は competing transition として
 * conflict 扱いにできるよう updatedCount を返す。
 */
export async function updateSessionStatus(
  admin: SupabaseClient,
  args: {
    sessionId: string;
    status: 'completed' | 'abandoned';
  },
): Promise<{ error: unknown; updatedCount: number }> {
  const { data, error } = await admin
    .from(SESSIONS)
    .update({ status: args.status })
    .eq('id', args.sessionId)
    .eq('status', 'in_progress')
    .select('id');
  return { error, updatedCount: data?.length ?? 0 };
}
