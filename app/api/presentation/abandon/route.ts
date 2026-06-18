/**
 * STEP-PRESENTATION-PR7: プレゼン session 離脱 route。
 *
 * 受信: POST JSON { session_id }
 *   presentation_sessions.status を in_progress → abandoned に更新する（状態遷移のみ）。
 *
 * レスポンス: 200 { session: { id, status: 'abandoned' } }
 *   400 invalid-body | invalid-session-id / 401 / 403 forbidden-session /
 *   404 session-not-found / 409 invalid-session-status / 500 session-abandon-failed
 *
 * 課金: 消費しない。既に評価済み（usage_recorded=true）でも返金・取消はしない（状態遷移のみ）。
 * 共通ロジックは lib/presentation/sessionTransition.ts に集約。
 */

import 'server-only';

import { transitionPresentationSession } from '@/lib/presentation/sessionTransition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return transitionPresentationSession(req, 'abandoned', 'session-abandon-failed');
}
