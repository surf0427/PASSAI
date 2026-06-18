/**
 * STEP-PRESENTATION-PR8: プレゼン録画の再生用 signed URL 発行 route。
 *
 * 保存済み録画（private bucket: presentation-recordings）を再生するため、短 TTL の signed URL を返す。
 * 公開 URL は使わない。storage_path はクライアントから受け取らず、DB の値だけを使う（要対応A）。
 *
 * 受信: GET /api/presentation/attempt/[id]/signed-url  （id = attempt_id）
 *
 * レスポンス:
 *   200 { signedUrl, expiresIn }
 *   400 invalid-attempt-id / 401 / 403 forbidden-attempt / 404 attempt-not-found /
 *   409 missing-storage-path / 500 signed-url-failed
 *
 * 課金: なし（再生はメディア読み取りのみ）。削除はこの route では行わない。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ATTEMPTS_TABLE = 'presentation_attempts';
const SESSIONS_TABLE = 'presentation_sessions';
const BUCKET = 'presentation-recordings';
// signed URL の有効期限（秒）。短く保つ（pr0_design.md §5.3）。
const SIGNED_URL_TTL_SEC = 600;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. 認証のみ。
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;
  const userId = auth.userId;

  // 2. path param（attempt_id）検証。
  const { id: attemptId } = await params;
  if (!attemptId || !UUID_RE.test(attemptId)) {
    return json({ error: 'invalid-attempt-id' }, 400);
  }

  const admin = getServiceRoleSupabaseClient();

  // 3. attempt 取得 + 所有 + storage_path 確認。
  const { data: attempt, error: attemptErr } = await admin
    .from(ATTEMPTS_TABLE)
    .select('id, user_id, session_id, storage_path, video_deleted_at')
    .eq('id', attemptId)
    .maybeSingle();
  if (attemptErr) {
    devWarn('[presentation/signed-url] attempt fetch error', {
      message: attemptErr.message,
    });
    return fail(attemptErr);
  }
  if (!attempt) return json({ error: 'attempt-not-found' }, 404);
  if (attempt.user_id !== userId) {
    return json({ error: 'forbidden-attempt' }, 403);
  }

  // 録画動画が TTL（90日）で削除済みなら signed URL を発行しない（410 Gone）。
  // 結果画面は video_deleted_at を見て事前に再生をスキップするが、ここでも防御する。
  if (attempt.video_deleted_at) {
    return json({ error: 'video-deleted' }, 410);
  }

  const storagePath =
    typeof attempt.storage_path === 'string' ? attempt.storage_path : '';
  if (!storagePath) {
    return json({ error: 'missing-storage-path' }, 409);
  }

  // 4. 親 session 所有確認（attempt と二重に owner を担保）。
  const { data: session, error: sessionErr } = await admin
    .from(SESSIONS_TABLE)
    .select('id, user_id')
    .eq('id', attempt.session_id)
    .maybeSingle();
  if (sessionErr) {
    devWarn('[presentation/signed-url] session fetch error', {
      message: sessionErr.message,
    });
    return fail(sessionErr);
  }
  if (!session || session.user_id !== userId) {
    return json({ error: 'forbidden-attempt' }, 403);
  }

  // 5. signed URL 発行（service_role。DB の storage_path のみを使う）。
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) {
    devWarn('[presentation/signed-url] createSignedUrl failed', {
      message: error?.message,
    });
    return fail(error);
  }

  return json({ signedUrl: data.signedUrl, expiresIn: SIGNED_URL_TTL_SEC }, 200);
}

function fail(err: unknown): Response {
  captureRouteException(
    err,
    { route: 'presentation/attempt/signed-url', feature: 'presentation', status: 500 },
    { status: 500, code: 'signed-url-failed' },
  );
  return json({ error: 'signed-url-failed' }, 500);
}
