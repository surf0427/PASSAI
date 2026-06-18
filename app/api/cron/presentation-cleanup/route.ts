/**
 * プレゼン録画動画 / 発表資料の TTL 自動削除 cron。
 *
 * 目的:
 *   Storage コストと法務リスクを抑えるため、作成から 90 日を超えた
 *     - 録画動画（bucket: presentation-recordings / presentation_attempts.storage_path）
 *     - 発表資料（bucket: presentation-materials / presentation_sessions.material_path）
 *   を Storage から削除し、削除時刻（video_deleted_at / material_deleted_at）を記録する。
 *
 * 残すもの（重要 / 仕様）:
 *   - 文字起こし transcript・AI 評価 presentation_results は削除しない。
 *   - attempts / sessions / results の行自体も DELETE しない（Storage ファイルのみ）。
 *   - これにより result / history / マイページの成長可視化は引き続き閲覧できる。
 *
 * 認証:
 *   - `Authorization: Bearer ${CRON_SECRET}` のみ許可。それ以外は 401。
 *   - CRON_SECRET 未設定なら fail-closed で 401（通常ユーザーからは叩けない）。
 *   - Vercel Cron は CRON_SECRET 設定時に自動でこの header を付与する
 *     （reconcile-subscriptions と同方式）。
 *
 * dry-run:
 *   - `?dryRun=true`（または `?dry=1`）で Storage 削除も DB 更新も行わず、対象件数のみ返す。
 *
 * 冪等性 / 安全性:
 *   - 既に *_deleted_at がある行はクエリ段階で除外（WHERE ... IS NULL）→ 二重処理しない。
 *   - storage.remove が file-not-found でも deleted_at を更新する（孤児フラグを残さない / 仕様）。
 *   - それ以外の Storage エラーは error として集計し、deleted_at は更新せず次回に持ち越す。
 *   - 課金（usage_records）は一切触らない。AI 評価ロジックも変更しない。
 *
 * Runtime:
 *   - service_role（RLS バイパス）で Storage / DB を操作するため Node.js runtime。
 *   - dynamic = 'force-dynamic' でキャッシュ化を防止。
 *
 * 必要 env:
 *   - CRON_SECRET
 *   - SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL
 *
 * 手動実行 (curl):
 *   # 401 になること（secret 無し）
 *   curl -i https://<host>/api/cron/presentation-cleanup
 *   # dry-run（削除なし・対象件数のみ）
 *   curl -s -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://<host>/api/cron/presentation-cleanup?dryRun=true" | jq
 *   # 本実行
 *   curl -s -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://<host>/api/cron/presentation-cleanup" | jq
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 件数分の storage.remove + UPDATE があるため余裕を持たせる（プラン上限超は clamp される）。
export const maxDuration = 300;

const ATTEMPTS_TABLE = 'presentation_attempts';
const SESSIONS_TABLE = 'presentation_sessions';
const RECORDINGS_BUCKET = 'presentation-recordings';
const MATERIALS_BUCKET = 'presentation-materials';

// TTL（日）。録画動画・発表資料ともに 90 日。
const VIDEO_TTL_DAYS = 90;
const MATERIAL_TTL_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
// 1 回の実行で処理する最大件数（暴走防止。残りは翌回の cron が拾う）。
const MAX_ROWS = 1000;

type ScopeResult = {
  scanned: number;
  deleted: number;
  errors: number;
};

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // fail-closed: secret 未設定なら誰も通さない。
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

// storage.remove の error が「対象なし」系か判定する。
// Supabase は存在しないオブジェクトでも error=null を返すことが多いが、
// プロバイダ差異に備え not-found 系メッセージ / 404 も「削除済み扱い」にする（仕様）。
function isNotFoundError(err: { message?: string; status?: number } | null): boolean {
  if (!err) return true;
  const status = typeof err.status === 'number' ? err.status : undefined;
  if (status === 404) return true;
  const msg = (err.message ?? '').toLowerCase();
  return (
    msg.includes('not found') ||
    msg.includes('does not exist') ||
    msg.includes('no such') ||
    msg.includes('object not found')
  );
}

async function cleanupVideos(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  cutoffIso: string,
  nowIso: string,
  dryRun: boolean,
): Promise<ScopeResult> {
  const result: ScopeResult = { scanned: 0, deleted: 0, errors: 0 };

  // TTL 超過・未削除・storage_path あり の attempt のみ。
  const { data: rows, error } = await admin
    .from(ATTEMPTS_TABLE)
    .select('id, storage_path')
    .lt('created_at', cutoffIso)
    .is('video_deleted_at', null)
    .neq('storage_path', '')
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS);
  if (error) {
    throw new Error(`video-scan-failed: ${error.message}`);
  }

  result.scanned = rows?.length ?? 0;
  if (dryRun) return result;

  for (const row of rows ?? []) {
    const storagePath = typeof row.storage_path === 'string' ? row.storage_path : '';
    if (!storagePath) continue;

    const { error: removeErr } = await admin.storage
      .from(RECORDINGS_BUCKET)
      .remove([storagePath]);

    // file-not-found でも deleted_at を更新する（仕様）。それ以外のエラーは持ち越し。
    if (removeErr && !isNotFoundError(removeErr)) {
      devWarn('[cron/presentation-cleanup] video remove failed', {
        message: removeErr.message,
      });
      result.errors += 1;
      continue;
    }

    const { error: updateErr } = await admin
      .from(ATTEMPTS_TABLE)
      .update({ video_deleted_at: nowIso })
      .eq('id', row.id)
      .is('video_deleted_at', null);
    if (updateErr) {
      devWarn('[cron/presentation-cleanup] video flag update failed', {
        message: updateErr.message,
      });
      result.errors += 1;
      continue;
    }
    result.deleted += 1;
  }

  return result;
}

async function cleanupMaterials(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  cutoffIso: string,
  nowIso: string,
  dryRun: boolean,
): Promise<ScopeResult> {
  const result: ScopeResult = { scanned: 0, deleted: 0, errors: 0 };

  // TTL 超過・未削除・material_path あり の session のみ。
  const { data: rows, error } = await admin
    .from(SESSIONS_TABLE)
    .select('id, material_path')
    .lt('created_at', cutoffIso)
    .is('material_deleted_at', null)
    .not('material_path', 'is', null)
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS);
  if (error) {
    throw new Error(`material-scan-failed: ${error.message}`);
  }

  result.scanned = rows?.length ?? 0;
  if (dryRun) return result;

  for (const row of rows ?? []) {
    const materialPath = typeof row.material_path === 'string' ? row.material_path : '';
    if (!materialPath) continue;

    const { error: removeErr } = await admin.storage
      .from(MATERIALS_BUCKET)
      .remove([materialPath]);

    if (removeErr && !isNotFoundError(removeErr)) {
      devWarn('[cron/presentation-cleanup] material remove failed', {
        message: removeErr.message,
      });
      result.errors += 1;
      continue;
    }

    const { error: updateErr } = await admin
      .from(SESSIONS_TABLE)
      .update({ material_deleted_at: nowIso })
      .eq('id', row.id)
      .is('material_deleted_at', null);
    if (updateErr) {
      devWarn('[cron/presentation-cleanup] material flag update failed', {
        message: updateErr.message,
      });
      result.errors += 1;
      continue;
    }
    result.deleted += 1;
  }

  return result;
}

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryParam = url.searchParams.get('dryRun') ?? url.searchParams.get('dry');
  const dryRun = dryParam === 'true' || dryParam === '1';

  const now = new Date();
  const nowIso = now.toISOString();
  const videoCutoff = new Date(now.getTime() - VIDEO_TTL_DAYS * DAY_MS).toISOString();
  const materialCutoff = new Date(
    now.getTime() - MATERIAL_TTL_DAYS * DAY_MS,
  ).toISOString();

  try {
    const admin = getServiceRoleSupabaseClient();
    const videos = await cleanupVideos(admin, videoCutoff, nowIso, dryRun);
    const materials = await cleanupMaterials(admin, materialCutoff, nowIso, dryRun);

    return NextResponse.json(
      {
        ok: true,
        dryRun,
        startedAt: nowIso,
        finishedAt: new Date().toISOString(),
        ttlDays: { video: VIDEO_TTL_DAYS, material: MATERIAL_TTL_DAYS },
        cutoff: { video: videoCutoff, material: materialCutoff },
        videos,
        materials,
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'cleanup failed';
    devWarn('[cron/presentation-cleanup] fatal', message);
    captureRouteException(
      err,
      { route: 'cron/presentation-cleanup', feature: 'presentation', status: 500 },
      { status: 500, code: 'presentation-cleanup-fatal' },
    );
    return NextResponse.json(
      { ok: false, error: message, startedAt: nowIso },
      { status: 500 },
    );
  }
}

// Vercel Cron は GET で叩く。手動運用のため POST も許可する。
export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
