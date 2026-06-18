/**
 * STEP-PRESENTATION-MATERIAL: 発表資料の登録 route。
 *
 * クライアントが Storage（presentation-materials）に資料をアップロード **した後**、
 * presentation_sessions に material_* を記録する。storage_path はサーバが正準生成する
 * （クライアント送信値は信用しない）。
 *
 * 受信: POST JSON
 *   { session_id, material_mime_type, material_file_name, material_size_bytes }
 *
 * レスポンス:
 *   200 { material: { fileName, mimeType, sizeBytes } }
 *   400 invalid-body | invalid-session-id | invalid-material-type | invalid-material-size
 *   401 unauthorized
 *   403 forbidden-session
 *   404 session-not-found
 *   409 invalid-session-status
 *   500 material-save-failed
 *
 * 課金なし（資料添付は非課金。消費は evaluate の初回成功時のみ）。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import {
  isAllowedMaterialMime,
  materialExt,
  PRESENTATION_MATERIAL_MAX_BYTES,
} from '@/lib/presentation/material';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLE = 'presentation_sessions';
const FILE_NAME_MAX = 255;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  // 1. 認証のみ。
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;
  const userId = auth.userId;

  // 2. body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid-body' }, 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const sessionId = typeof b.session_id === 'string' ? b.session_id : '';
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return json({ error: 'invalid-session-id' }, 400);
  }

  const mime = typeof b.material_mime_type === 'string' ? b.material_mime_type : '';
  const ext = materialExt(mime);
  if (!isAllowedMaterialMime(mime) || !ext) {
    return json({ error: 'invalid-material-type' }, 400);
  }

  const sizeBytes = b.material_size_bytes;
  if (
    typeof sizeBytes !== 'number' ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > PRESENTATION_MATERIAL_MAX_BYTES
  ) {
    return json({ error: 'invalid-material-size' }, 400);
  }

  let fileName =
    typeof b.material_file_name === 'string' ? b.material_file_name.trim() : '';
  if (fileName.length > FILE_NAME_MAX) fileName = fileName.slice(0, FILE_NAME_MAX);

  const admin = getServiceRoleSupabaseClient();

  // 3. session 所有 + status 確認
  const { data: session, error: sessionErr } = await admin
    .from(TABLE)
    .select('id, user_id, status')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionErr) {
    devWarn('[presentation/material] session fetch error', {
      message: sessionErr.message,
    });
    return fail(sessionErr);
  }
  if (!session) return json({ error: 'session-not-found' }, 404);
  if (session.user_id !== userId) return json({ error: 'forbidden-session' }, 403);
  if (session.status !== 'in_progress') {
    return json({ error: 'invalid-session-status' }, 409);
  }

  // 4. storage_path をサーバが正準生成（クライアント値は使わない）。
  const materialPath = `${userId}/${sessionId}/material.${ext}`;

  const { error: updateErr } = await admin
    .from(TABLE)
    .update({
      material_path: materialPath,
      material_mime_type: mime,
      material_file_name: fileName,
      material_size_bytes: sizeBytes,
    })
    .eq('id', sessionId);
  if (updateErr) {
    devWarn('[presentation/material] update error', { message: updateErr.message });
    return fail(updateErr);
  }

  return json(
    { material: { fileName, mimeType: mime, sizeBytes } },
    200,
  );
}

function fail(err: unknown): Response {
  captureRouteException(
    err,
    { route: 'presentation/material', feature: 'presentation', status: 500 },
    { status: 500, code: 'material-save-failed' },
  );
  return json({ error: 'material-save-failed' }, 500);
}
