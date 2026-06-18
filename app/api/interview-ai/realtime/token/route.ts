/**
 * STEP-INTERVIEW-AI-REALTIME-PR1: リアルタイム音声面接の ephemeral token 発行 route。
 *
 * 受信:
 *   POST { interviewType?, targetRef?, sourceType?, sourceId?, sourceContext? }
 *
 * レスポンス:
 *   201 { sessionId, clientSecret, expiresAt, model, maxDurationMs, callUrl }
 *   403 { error: 'realtime-disabled' }      … server flag OFF（本番 passai.jp の既定）
 *   401                                       … 未認証（ensurePlanQuota）
 *   403 { error: 'not-allowlisted' }         … REALTIME_DEV_USER_IDS 設定時、対象外
 *   402 { error: 'quota-exceeded', ... }     … 非Premium / 当月上限超過（ensurePlanQuota）
 *   200 { error: 'in-progress-exists', session } … one_in_progress 衝突（続きから誘導）
 *   400 { error: 'invalid-body' }
 *   502 { error: 'token-mint-failed' }       … OpenAI 発行失敗（作成済み session は abandoned へ）
 *
 * 設計（realtime pr1_token.md）— fail-closed / 順序厳守:
 *   1. REALTIME_INTERVIEW_ENABLED === 'true' でなければ 403。コストが出る最終ゲートは server 側のみ。
 *   2. ensurePlanQuota('interview-ai-realtime')（auth + plan + 当月 quota）。
 *   3. REALTIME_DEV_USER_IDS（非空なら allowlist）。
 *   4. body validate（既存 /session と同契約）。
 *   5. session 作成（source='realtime', usage_recorded=false）。23505 → in-progress-exists。
 *   6. OpenAI client_secret を mint（OpenAI-Safety-Identifier=sha256(userId+salt), TTL=120s）。
 *      失敗時は作成済み session を abandoned に戻す（one_in_progress を解放）。
 *   7. recordUsage は呼ばない（課金は最初の有効発話で CAS 計上＝STEP7）。logAiUsage のみ。
 *
 * 既存ターン制（/interview/ai, session/turn/complete/abandon）は無改変。
 */

import 'server-only';

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { logAiUsage } from '@/lib/aiUsageLog';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import { updateSessionStatus } from '@/lib/interviewAi/completion';
import { isInterviewType, type InterviewType } from '@/lib/interviewAi/interviewTypes';
import {
  DEFAULT_REALTIME_MODEL,
  DEFAULT_REALTIME_VOICE,
  INTERVIEW_AI_REALTIME_TOKEN_LOG_ROUTE,
  OPENAI_CLIENT_SECRETS_URL,
  OPENAI_REALTIME_CALLS_URL,
  REALTIME_MAX_DURATION_MS,
  REALTIME_TOKEN_TTL_SECONDS,
} from '@/lib/interviewAi/realtime/constants';
import {
  buildRealtimeInstructions,
  REALTIME_TOOLS,
} from '@/lib/interviewAi/realtime/instructions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLE = 'interview_ai_sessions';
const UNIQUE_VIOLATION = '23505';
const TARGET_REF_BASE_MAX_CHARS = 4000;
const SOURCE_CONTEXT_MAX_CHARS = 6500;
const SELECT_COLS =
  'id, source, status, target_ref, interview_type, source_type, source_id, created_at';

const ENABLED_VALUES: ReadonlySet<string> = new Set(['true', '1', 'yes']);

// STEP-INTERVIEW-AI-REALTIME-DIAG（一時診断）: 最新 route が live かを判定する build marker。
// 診断版を出すたびに数字を上げる。原因特定後に GET ハンドラごと削除する。
const ROUTE_BUILD_MARKER = 'realtime-token-diag-4';

function isServerFlagEnabled(): boolean {
  const raw = process.env.REALTIME_INTERVIEW_ENABLED;
  return typeof raw === 'string' && ENABLED_VALUES.has(raw.trim().toLowerCase());
}

// STEP-INTERVIEW-AI-REALTIME-DIAG（一時診断）: POST/GET 共通の marker + runtime env presence。
// 値（sk-... 等）は出さず boolean のみ。原因特定後に削除する。
function diagPayload(extra: Record<string, unknown> = {}) {
  return {
    marker: ROUTE_BUILD_MARKER,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    env: {
      realtimeEnabled: isServerFlagEnabled(),
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
      hasSalt: Boolean(process.env.REALTIME_SAFETY_ID_SALT),
    },
    ...extra,
  };
}

// REALTIME_DEV_USER_IDS が非空のとき allowlist として機能する。未設定/空 → 制限なし（skip）。
function parseAllowlist(): Set<string> | null {
  const raw = process.env.REALTIME_DEV_USER_IDS;
  if (typeof raw !== 'string') return null;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

// OpenAI-Safety-Identifier に渡す安定ハッシュ。userId を逆引きできない形にして送る。
function safetyIdentifier(userId: string): string {
  const salt = process.env.REALTIME_SAFETY_ID_SALT ?? '';
  return createHash('sha256').update(`${userId}${salt}`).digest('hex');
}

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

type SessionRow = {
  id: string;
  source: string;
  status: string;
  target_ref: unknown;
  interview_type?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  created_at: string;
};

function toSession(row: SessionRow) {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    targetRef:
      row.target_ref && typeof row.target_ref === 'object'
        ? (row.target_ref as Record<string, unknown>)
        : {},
    interviewType: row.interview_type ?? 'free',
    createdAt: row.created_at,
  };
}

// 依存注入の seam。テストは実 OpenAI / 実 Supabase / 実 gate を介さずに分岐を検証する。
// mintClientSecret は global.fetch を使う module 関数なので、テストは global.fetch を mock する。
export type RealtimeTokenDeps = {
  ensurePlanQuota: typeof ensurePlanQuota;
  getAdmin: typeof getServiceRoleSupabaseClient;
  updateSessionStatus: typeof updateSessionStatus;
  logAiUsage: typeof logAiUsage;
};

const defaultDeps: RealtimeTokenDeps = {
  ensurePlanQuota,
  getAdmin: getServiceRoleSupabaseClient,
  updateSessionStatus,
  logAiUsage,
};

export async function POST(req: Request): Promise<Response> {
  return handleRealtimeToken(req, defaultDeps);
}

// STEP-INTERVIEW-AI-REALTIME-DIAG（一時診断）: GET ?debug=1 で最新 route が live か / env が runtime に
// 見えているかを判定する。値（sk-... 等）は返さず presence(boolean) のみ。flag OFF（本番）では 404。
// 原因特定後に削除する。
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.searchParams.get('debug') !== '1') {
    return NextResponse.json({ error: 'method-not-allowed' }, { status: 405 });
  }
  if (!isServerFlagEnabled()) {
    return NextResponse.json({ error: 'realtime-disabled' }, { status: 403 });
  }
  return NextResponse.json(
    {
      marker: ROUTE_BUILD_MARKER,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      env: {
        realtimeEnabled: isServerFlagEnabled(),
        hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
        hasSalt: Boolean(process.env.REALTIME_SAFETY_ID_SALT),
        allowlistConfigured: Boolean(
          (process.env.REALTIME_DEV_USER_IDS ?? '').trim(),
        ),
        model: process.env.INTERVIEW_AI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL,
      },
    },
    { status: 200 },
  );
}

export async function handleRealtimeToken(
  req: Request,
  deps: RealtimeTokenDeps,
): Promise<Response> {
  // STEP-INTERVIEW-AI-REALTIME-DIAG（一時診断）: POST が最新 route/commit/env を見ているか確認。
  console.log('TOKEN ROUTE HIT', { method: req.method, ...diagPayload() });

  // 1. server 最終ゲート。これが true でなければトークンは絶対に発行しない。
  if (!isServerFlagEnabled()) {
    return NextResponse.json(
      { error: 'realtime-disabled', diagnostic: diagPayload() },
      { status: 403 },
    );
  }

  // 2. gate（auth + plan + 当月 quota）。非Premium / 上限超過は 402、未認証は 401。
  const gate = await deps.ensurePlanQuota('interview-ai-realtime');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  // 3. allowlist（設定時のみ）。
  const allowlist = parseAllowlist();
  if (allowlist && !allowlist.has(userId)) {
    return NextResponse.json({ error: 'not-allowlisted' }, { status: 403 });
  }

  // 4. body parse / validate（既存 /session と同契約）。
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // body 無し（空 POST）も許容する: realtime は targetRef 任意。
    body = {};
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const interviewType: InterviewType = isInterviewType(b.interviewType)
    ? b.interviewType
    : 'free';
  const sourceType: InterviewType | null = isInterviewType(b.sourceType)
    ? b.sourceType
    : null;
  const sourceId =
    typeof b.sourceId === 'string' && b.sourceId ? b.sourceId : null;

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

  const model = process.env.INTERVIEW_AI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
  const voice = process.env.INTERVIEW_AI_REALTIME_VOICE || DEFAULT_REALTIME_VOICE;

  // OPENAI_API_KEY 欠落は config エラー。session を作る前に弾く（orphan を作らない）。
  // STEP-INTERVIEW-AI-REALTIME-DIAG（一時診断）: ここも diagnostic を返す。
  //   この分岐に来る = Preview runtime に OPENAI_API_KEY が見えていない（scope/redeploy 漏れ）。
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const diagnostic = diagPayload({
      reason: 'missing-openai-key',
      openaiStatus: null,
      openaiBody: null,
      model,
    });
    console.error('TOKEN ROUTE MISSING OPENAI KEY', diagnostic);
    return NextResponse.json(
      { error: 'token-mint-failed', diagnostic },
      { status: 502 },
    );
  }

  const admin = deps.getAdmin();

  // 5. realtime セッションを in_progress で作成（usage_recorded=false）。課金は本 route では行わない。
  let sessionId: string;
  try {
    const { data, error } = await admin
      .from(TABLE)
      .insert({
        user_id: userId,
        source: 'realtime',
        status: 'in_progress',
        usage_recorded: false,
        target_ref: targetRef,
        interview_type: interviewType,
        source_type: sourceType,
        source_id: sourceId,
        metadata: {
          realtime: true,
          model,
          maxDurationMs: REALTIME_MAX_DURATION_MS,
        },
      })
      .select(SELECT_COLS)
      .single();

    if (error) {
      // 5a. in_progress 重複（§57 部分 unique index）→ 既存セッションを返す（続きから）。
      if (error.code === UNIQUE_VIOLATION) {
        return await respondWithExistingInProgress(admin, userId);
      }
      devWarn('[interview-ai/realtime/token] insert error', {
        code: error.code,
        message: error.message,
      });
      captureRouteException(
        error,
        {
          route: 'interview-ai/realtime/token',
          feature: 'interview-ai-realtime',
          status: 500,
        },
        { status: 500, code: 'session-create-failed' },
      );
      return NextResponse.json(
        { error: 'session-create-failed' },
        { status: 500 },
      );
    }
    sessionId = data.id;
  } catch (err) {
    devWarn('[interview-ai/realtime/token] insert threw', err);
    captureRouteException(
      err,
      {
        route: 'interview-ai/realtime/token',
        feature: 'interview-ai-realtime',
        status: 500,
      },
      { status: 500, code: 'session-create-failed' },
    );
    return NextResponse.json(
      { error: 'session-create-failed' },
      { status: 500 },
    );
  }

  // 6. OpenAI client_secret を mint。session 設定（instructions / tools）は server で固定する
  //    （client は改竄不可）。失敗時は作成済み session を abandoned に戻す。
  const instructions = buildRealtimeInstructions({
    interviewType,
    targetRef,
    sourceContext,
  });
  const minted = await mintClientSecret({
    apiKey,
    model,
    voice,
    safetyId: safetyIdentifier(userId),
    instructions,
    tools: REALTIME_TOOLS,
  });

  if (!minted.ok) {
    // STEP-INTERVIEW-AI-REALTIME-DIAG（一時診断）: OpenAI の実 status/body をログ＋応答に出す。
    //   - devWarn は production(=Vercel Preview) で DCE 除去されるため console.error を使う。
    //   - 原因切り分け後に削除する（diagnostic フィールド / console.error / model 出力）。
    const diagnostic = diagPayload({
      reason: minted.reason,
      openaiStatus: minted.openaiStatus,
      openaiBody: minted.openaiBody,
      model,
    });
    console.error('TOKEN ROUTE MINT FAILED', diagnostic);
    // one_in_progress を解放するため abandoned に倒す（best-effort）。
    const { error: abErr } = await deps.updateSessionStatus(admin, {
      sessionId,
      status: 'abandoned',
    });
    if (abErr) {
      devWarn('[interview-ai/realtime/token] abandon after mint fail errored', {
        sessionId,
      });
    }
    deps.logAiUsage({
      route: INTERVIEW_AI_REALTIME_TOKEN_LOG_ROUTE,
      model,
      status: 'failed',
    });
    return NextResponse.json(
      { error: 'token-mint-failed', diagnostic },
      { status: 502 },
    );
  }

  // 7. 観測ログのみ。recordUsage は呼ばない（課金は最初の有効発話で CAS 計上＝STEP7）。
  deps.logAiUsage({
    route: INTERVIEW_AI_REALTIME_TOKEN_LOG_ROUTE,
    model,
    status: 'success',
  });

  return NextResponse.json(
    {
      sessionId,
      clientSecret: minted.value,
      expiresAt: minted.expiresAt,
      model,
      maxDurationMs: REALTIME_MAX_DURATION_MS,
      callUrl: OPENAI_REALTIME_CALLS_URL,
      // STEP-INTERVIEW-AI-REALTIME-DIAG（一時診断）: 成功時も marker/env を載せる。原因特定後に削除。
      diagnostic: diagPayload({ reason: 'ok' }),
    },
    { status: 201 },
  );
}

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
    devWarn('[interview-ai/realtime/token] existing in_progress fetch failed', {
      message: error?.message,
    });
    return NextResponse.json(
      { error: 'session-create-failed' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { error: 'in-progress-exists', session: toSession(data) },
    { status: 200 },
  );
}

// STEP-INTERVIEW-AI-REALTIME-DIAG（一時診断）: mint 失敗時に OpenAI の実 status/body を持ち回る。
// 原因切り分け後に削除予定（reason / openaiStatus / openaiBody）。
type MintFailure = {
  ok: false;
  reason: 'fetch-error' | 'http-error' | 'parse-error' | 'missing-value';
  openaiStatus: number | null;
  openaiBody: string | null;
};
type MintResult =
  | { ok: true; value: string; expiresAt: number | null }
  | MintFailure;

async function mintClientSecret(args: {
  apiKey: string;
  model: string;
  voice: string;
  safetyId: string;
  instructions: string;
  tools: unknown[];
}): Promise<MintResult> {
  // session 設定は mint 時に server で固定する（client は改竄不可）。
  // instructions（5 問アーク面接官）/ tools（mark_main_question_complete）は STEP3 で注入。
  const payload = {
    expires_after: { anchor: 'created_at', seconds: REALTIME_TOKEN_TTL_SECONDS },
    session: {
      type: 'realtime',
      model: args.model,
      instructions: args.instructions,
      tools: args.tools,
      audio: {
        input: {
          transcription: { model: 'whisper-1', language: 'ja' },
          turn_detection: { type: 'server_vad' },
        },
        output: { voice: args.voice, speed: 0.95 },
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(OPENAI_CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': args.safetyId,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'fetch-error',
      openaiStatus: null,
      openaiBody: String((err as Error)?.message ?? err).slice(0, 500),
    };
  } finally {
    clearTimeout(timer);
  }

  // body は 1 度だけ text で読み、診断に使い回す（失敗時も OpenAI の本文を残す）。
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    /* 本文取得失敗時は空文字のまま */
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: 'http-error',
      openaiStatus: res.status,
      openaiBody: bodyText.slice(0, 2000),
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return {
      ok: false,
      reason: 'parse-error',
      openaiStatus: res.status,
      openaiBody: bodyText.slice(0, 2000),
    };
  }

  const obj = (json ?? {}) as Record<string, unknown>;
  const value = typeof obj.value === 'string' ? obj.value : '';
  if (!value) {
    return {
      ok: false,
      reason: 'missing-value',
      openaiStatus: res.status,
      openaiBody: bodyText.slice(0, 2000),
    };
  }
  const expiresAt =
    typeof obj.expires_at === 'number' && Number.isFinite(obj.expires_at)
      ? obj.expires_at
      : null;

  return { ok: true, value, expiresAt };
}
