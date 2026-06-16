/**
 * STEP-INTERVIEW-AI-PR5: 面接 AI セッション作成 route。
 *
 * 受信:
 *   POST { source: 'voice' | 'text', targetRef?: object }
 *
 * レスポンス:
 *   201 { session: { id, source, status, targetRef, createdAt } }
 *   200 { error: 'in-progress-exists', session } … 既存 in_progress があれば「続きから」誘導
 *        （pr0_design.md §7.3 確定: 続きからへ誘導 / 新規作成は拒否）
 *   400 { error: 'invalid-source' | 'invalid-body' }
 *   401 / 402 … ensurePlanQuota が返す未認証 / quota 超過 Response
 *   500 { error: 'session-create-failed' }
 *
 * 設計（pr0_design.md §5.3 / §7.3）:
 *   - gate: ensurePlanQuota('interview-ai') を **作成前** に判定する。
 *     quota の COUNT は当月 status='ok' の usage_records（route='interview-ai'）。
 *     recordUsage は本 route では呼ばない（voice の最初の STT 成功 / text の最初の回答保存で
 *     計上する。本 route はセッションを in_progress で作るだけ。PR6+）。
 *   - in_progress は user ごと 1 件まで（§57 部分 unique index）。重複作成は 23505 で弾かれ、
 *     既存の in_progress セッションを返す（続きから）。これが deferred recordUsage の
 *     quota 回避を封じる要（§3.3）。
 *   - insert は service_role（server-only）で行う。userId は gate で認証済み。
 *   - usage_recorded は false 初期値（compare-and-set は PR6+）。
 *   - target_ref はアプリ契約で version を含める（§6.3）。欠落時は version=1 を補う。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import { isInterviewType, type InterviewType } from '@/lib/interviewAi/interviewTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLE = 'interview_ai_sessions';
// in_progress 部分 unique index 違反の Postgres SQLSTATE。
const UNIQUE_VIOLATION = '23505';
// target_ref（sourceContext を除く識別子部分）の暴走 payload ガード。
const TARGET_REF_BASE_MAX_CHARS = 4000;
// source データ要約（target_ref.sourceContext）の上限。client 側と同じ 6000 想定 + 余裕。
const SOURCE_CONTEXT_MAX_CHARS = 6500;
const SELECT_COLS =
  'id, source, status, target_ref, interview_type, source_type, source_id, created_at';

type SessionSource = 'voice' | 'text';

type CreatedSession = {
  id: string;
  source: SessionSource;
  status: string;
  targetRef: Record<string, unknown>;
  interviewType: string;
  createdAt: string;
};

function isSessionSource(value: unknown): value is SessionSource {
  return value === 'voice' || value === 'text';
}

// 入力 targetRef を canonical 化する。object でなければ {} に倒し、version が無ければ 1 を補う
// （DB は shape を強制しないが、本 route はアプリ契約として version を必ず入れる）。
function normalizeTargetRef(raw: unknown): Record<string, unknown> {
  const base =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const version =
    typeof base.version === 'number' && Number.isFinite(base.version)
      ? base.version
      : 1;
  return { ...base, version };
}

export async function POST(req: Request) {
  // 1. gate（auth + quota）。reject なら 401 / 402 をそのまま返す。
  const gate = await ensurePlanQuota('interview-ai');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  // 2. body parse / validate
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const source = b.source;
  if (!isSessionSource(source)) {
    return NextResponse.json({ error: 'invalid-source' }, { status: 400 });
  }

  // 面接タイプ（どの機能データをもとに練習するか）。不正/未指定は 'free' に倒す。
  const interviewType: InterviewType = isInterviewType(b.interviewType)
    ? b.interviewType
    : 'free';
  const sourceType: InterviewType | null = isInterviewType(b.sourceType)
    ? b.sourceType
    : null;
  const sourceId = typeof b.sourceId === 'string' && b.sourceId ? b.sourceId : null;

  // target_ref の識別子部分（小さい）+ source データ要約（sourceContext, 大きめ別管理）。
  const targetRefBase = normalizeTargetRef(b.targetRef);
  if (JSON.stringify(targetRefBase).length > TARGET_REF_BASE_MAX_CHARS) {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }
  let sourceContext =
    typeof b.sourceContext === 'string' ? b.sourceContext.trim() : '';
  if (sourceContext.length > SOURCE_CONTEXT_MAX_CHARS) {
    sourceContext = sourceContext.slice(0, SOURCE_CONTEXT_MAX_CHARS);
  }
  const targetRef: Record<string, unknown> = sourceContext
    ? { ...targetRefBase, sourceContext }
    : targetRefBase;

  const admin = getServiceRoleSupabaseClient();

  // 3. in_progress セッションを insert（usage_recorded=false 初期値）。
  //    課金は本 route では行わない（PR5 / 課金トリガは turn route）。interview_type を問わず
  //    1 セッション 1 カウントのまま（ensurePlanQuota は §1 gate 済み）。
  try {
    const { data, error } = await admin
      .from(TABLE)
      .insert({
        user_id: userId,
        source,
        status: 'in_progress',
        usage_recorded: false,
        target_ref: targetRef,
        interview_type: interviewType,
        source_type: sourceType,
        source_id: sourceId,
      })
      .select(SELECT_COLS)
      .single();

    if (error) {
      // 3a. in_progress 重複（§57 部分 unique index）→ 既存セッションを返す（続きから）。
      if (error.code === UNIQUE_VIOLATION) {
        return await respondWithExistingInProgress(admin, userId);
      }
      devWarn('[interview-ai/session] insert error', {
        code: error.code,
        message: error.message,
      });
      captureRouteException(
        error,
        { route: 'interview-ai/session', feature: 'interview-ai', status: 500 },
        { status: 500, code: 'session-create-failed' },
      );
      return NextResponse.json(
        { error: 'session-create-failed' },
        { status: 500 },
      );
    }

    return NextResponse.json({ session: toCreatedSession(data) }, { status: 201 });
  } catch (err) {
    devWarn('[interview-ai/session] insert threw', err);
    captureRouteException(
      err,
      { route: 'interview-ai/session', feature: 'interview-ai', status: 500 },
      { status: 500, code: 'session-create-failed' },
    );
    return NextResponse.json(
      { error: 'session-create-failed' },
      { status: 500 },
    );
  }
}

// 既存の in_progress セッションを取得して「続きから」用に返す。
// 取得できなければ（competing delete 等の境界ケース）500 に倒す。
async function respondWithExistingInProgress(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  userId: string,
): Promise<Response> {
  const { data, error } = await admin
    .from(TABLE)
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .eq('status', 'in_progress')
    .maybeSingle();

  if (error || !data) {
    devWarn('[interview-ai/session] existing in_progress fetch failed', {
      message: error?.message,
    });
    return NextResponse.json(
      { error: 'session-create-failed' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { error: 'in-progress-exists', session: toCreatedSession(data) },
    { status: 200 },
  );
}

function toCreatedSession(row: {
  id: string;
  source: string;
  status: string;
  target_ref: unknown;
  interview_type?: string | null;
  created_at: string;
}): CreatedSession {
  return {
    id: row.id,
    source: row.source as SessionSource,
    status: row.status,
    targetRef:
      row.target_ref && typeof row.target_ref === 'object'
        ? (row.target_ref as Record<string, unknown>)
        : {},
    interviewType: row.interview_type ?? 'free',
    createdAt: row.created_at,
  };
}
