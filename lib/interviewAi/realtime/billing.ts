import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { recordUsage } from '@/lib/billing/usageLog';
import { claimUsageRecording } from '@/lib/interviewAi/billing';
import { INTERVIEW_AI_REALTIME_USAGE_ROUTE } from './constants';

/**
 * STEP-INTERVIEW-AI-REALTIME-PR7: リアルタイム面接の課金トリガ。
 *
 * 方針（realtime pr0_design.md §5 / pr1_token.md §6）:
 *   - 1 リアルタイムセッション = 1 カウント。
 *   - 計上タイミング = **最初の有効なユーザー発話**（= 最初の role='answer' turn 保存）。
 *   - 既存ターン制と同じ compare-and-set（interview_ai_sessions.usage_recorded）を流用し、
 *     勝者だけが recordUsage を呼ぶ（二重課金防止 / fail-closed）。
 *   - route key は **'interview-ai-realtime'**（ターン制の 'interview-ai' とは別枠）。
 *     これにより既存 ensurePlanQuota('interview-ai-realtime') の当月 COUNT が正しく増える
 *     = quota 制御が閉じる。
 *
 * 接続のみ / マイク拒否 / 一言も話さず切断 → role='answer' turn が無い → 計上されない（未課金）。
 */
export async function triggerRealtimeBilling(args: {
  admin: SupabaseClient;
  sessionId: string;
  userId: string;
  model: string;
}): Promise<{ billed: boolean }> {
  const won = await claimUsageRecording(args.admin, args.sessionId);
  if (!won) return { billed: false };

  await recordUsage({
    userId: args.userId,
    route: INTERVIEW_AI_REALTIME_USAGE_ROUTE, // 必ず 'interview-ai-realtime'
    model: args.model,
    status: 'ok',
  });
  return { billed: true };
}
