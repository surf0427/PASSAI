import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * STEP-INTERVIEW-AI-PR6: interview_ai_turns の DB 境界。
 *
 * 失敗を握り潰さない（PR6 必須条件 §8）: insert は error をそのまま返し、route 側で
 * 明示エラー（500）に変換する。best-effort（void）にはしない。
 */

const TABLE = 'interview_ai_turns';

export type TurnRow = {
  id: string;
  session_id: string;
  user_id: string;
  turn_index: number;
  role: 'question' | 'answer';
  source: 'voice' | 'text';
  content: string;
  created_at: string;
};

const COLUMNS =
  'id, session_id, user_id, turn_index, role, source, content, created_at';

/** session の全ターンを turn_index 昇順で返す。error はそのまま返す。 */
export async function listTurns(
  admin: SupabaseClient,
  sessionId: string,
): Promise<{ turns: TurnRow[]; error: unknown }> {
  const { data, error } = await admin
    .from(TABLE)
    .select(COLUMNS)
    .eq('session_id', sessionId)
    .order('turn_index', { ascending: true });
  return { turns: (data ?? []) as TurnRow[], error };
}

/** 1 ターンを insert する。error はそのまま返す（route 側で明示エラー化）。 */
export async function insertTurn(
  admin: SupabaseClient,
  payload: {
    sessionId: string;
    userId: string;
    turnIndex: number;
    role: 'question' | 'answer';
    source: 'voice' | 'text';
    content: string;
  },
): Promise<{ row: TurnRow | null; error: unknown }> {
  const { data, error } = await admin
    .from(TABLE)
    .insert({
      session_id: payload.sessionId,
      user_id: payload.userId,
      turn_index: payload.turnIndex,
      role: payload.role,
      source: payload.source,
      content: payload.content,
    })
    .select(COLUMNS)
    .single();
  return { row: (data as TurnRow | null) ?? null, error };
}

export function countAnswerTurns(turns: TurnRow[]): number {
  return turns.filter((t) => t.role === 'answer').length;
}
