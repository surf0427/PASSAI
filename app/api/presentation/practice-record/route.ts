/**
 * STEP-PRESENTATION-PR9: 対人プレゼン記録の保存 route（AI 不使用 / 課金なし）。
 *
 * 友達・先生・親との対人プレゼン練習を手動記録する。面接 interview_practice_records と同じく
 * localStorage canonical の durable mirror（upsert）。録画なし・AI なし・課金なし。
 *
 * 受信: POST JSON
 *   local_record_id (必須)
 *   practice_date / university_name / faculty_name / theme / time_limit_sec / partner /
 *   composition / persuasion / concreteness / delivery / qa_note /
 *   good_points / improvements / next_task / metadata  （いずれも任意）
 *
 * レスポンス:
 *   200 { record: { id, localRecordId, updatedAt } }
 *   400 invalid-body | local-record-id-required | field-too-long | invalid-time-limit | invalid-metadata
 *   401 unauthorized
 *   500 practice-record-save-failed
 *
 * 課金: usage_records に書かない / recordUsage を呼ばない / ensurePlanQuota もしない。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLE = 'presentation_practice_records';

// 入力サイズガード（DB 列は text だが入口で上限を切る）。
const LOCAL_ID_MAX = 200;
const SHORT_MAX = 200; // practice_date / university / faculty / partner
const THEME_MAX = 500;
const TEXT_MAX = 2000; // 評価メモ各項目（自由記述）
const TIME_LIMIT_MAX_SEC = 24 * 60 * 60; // 対人記録は手入力。緩めの上限。

// 任意の text フィールド（trim して保存。上限超過は field-too-long）。
const SHORT_FIELDS = [
  'practice_date',
  'university_name',
  'faculty_name',
  'partner',
] as const;
const TEXT_FIELDS = [
  'composition',
  'persuasion',
  'concreteness',
  'delivery',
  'qa_note',
  'good_points',
  'improvements',
  'next_task',
] as const;

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
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

  // 3. local_record_id 必須
  const localRecordId = asString(b.local_record_id).trim();
  if (!localRecordId) {
    return json({ error: 'local-record-id-required' }, 400);
  }
  if (localRecordId.length > LOCAL_ID_MAX) {
    return json({ error: 'field-too-long' }, 400);
  }

  // 4. theme / 各 text フィールドの組み立て + 長さ検証
  const theme = asString(b.theme).trim();
  if (theme.length > THEME_MAX) {
    return json({ error: 'field-too-long' }, 400);
  }

  const row: Record<string, unknown> = {
    user_id: userId, // 5. 所有者固定（クライアント user_id は使わない）
    local_record_id: localRecordId,
    theme,
  };

  for (const key of SHORT_FIELDS) {
    const val = asString(b[key]).trim();
    if (val.length > SHORT_MAX) return json({ error: 'field-too-long' }, 400);
    row[key] = val;
  }
  for (const key of TEXT_FIELDS) {
    const val = asString(b[key]).trim();
    if (val.length > TEXT_MAX) return json({ error: 'field-too-long' }, 400);
    row[key] = val;
  }

  // 6. time_limit_sec は 0 以上の整数
  if (b.time_limit_sec !== undefined) {
    const t = b.time_limit_sec;
    if (
      typeof t !== 'number' ||
      !Number.isInteger(t) ||
      t < 0 ||
      t > TIME_LIMIT_MAX_SEC
    ) {
      return json({ error: 'invalid-time-limit' }, 400);
    }
    row.time_limit_sec = t;
  }

  // 7. metadata は plain object のみ
  if (b.metadata !== undefined) {
    if (
      !b.metadata ||
      typeof b.metadata !== 'object' ||
      Array.isArray(b.metadata)
    ) {
      return json({ error: 'invalid-metadata' }, 400);
    }
    row.metadata = b.metadata;
  }

  const admin = getServiceRoleSupabaseClient();

  // 8. upsert（natural key = (user_id, local_record_id)）
  try {
    const { data, error } = await admin
      .from(TABLE)
      .upsert(row, { onConflict: 'user_id,local_record_id' })
      .select('id, local_record_id, updated_at')
      .single();

    if (error || !data) {
      devWarn('[presentation/practice-record] upsert error', {
        code: error?.code,
        message: error?.message,
      });
      return fail(error);
    }

    return json(
      {
        record: {
          id: data.id,
          localRecordId: data.local_record_id,
          updatedAt: data.updated_at,
        },
      },
      200,
    );
  } catch (err) {
    devWarn('[presentation/practice-record] upsert threw', err);
    return fail(err);
  }
}

function fail(err: unknown): Response {
  captureRouteException(
    err,
    { route: 'presentation/practice-record', feature: 'presentation', status: 500 },
    { status: 500, code: 'practice-record-save-failed' },
  );
  return json({ error: 'practice-record-save-failed' }, 500);
}
