/**
 * STEP-BILLING-06: Plan Gate (利用上限の server-side 強制) ラッパ。
 *
 * 用法:
 *   const gate = await ensurePlanQuota('statement');
 *   if (gate.kind === 'reject') return gate.response;
 *   const userId = gate.userId;
 *   // ... AI call ...
 *   await recordUsage({ userId, route: 'statement-review', model: MODEL, status: 'ok' });
 *
 * 処理:
 *   1. user-scoped supabase で auth.getUser() → 未認証なら 401 を返す Response
 *   2. profiles.plan を SELECT (webhook 同期済みの denormalized cache を読む高速パス)
 *      → 不明な値は安全側に 'free' に倒す
 *   3. quota が 'unlimited' なら即通過
 *   4. service_role client で当月 (UTC 暦月) の status='ok' usage_records を COUNT
 *   5. used >= limit なら 402 quota-exceeded を返す Response
 *   6. それ以外は { kind: 'ok', userId, plan, feature, used, limit } を返す
 *
 * 注:
 *   - rate_limited / error の record は quota に "数えない" (COUNT は status='ok' のみ)。
 *     ユーザーがアプリ側 / AI 側の失敗で quota を消費してしまわない設計。
 *   - profiles SELECT は user-scoped、usage_records COUNT は service_role を使う。
 *     usage_records は owner SELECT 可だが COUNT 用クエリは admin 経由のほうが
 *     RLS plan を通らず安定する。両方とも本ファイルで集約する。
 *   - profiles を読めない (DB エラー等) のは "fail-closed" で 500 を返す: 課金
 *     回避経路を作らない。
 */

import 'server-only';

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { devWarn } from '@/lib/devLog';
import { logAuthFail } from '@/lib/supabase/authFailLog';
import { getServerSupabaseClient } from '@/lib/supabase/serverClient';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import {
  FEATURE_ROUTE_KEYS,
  getQuotaForPlan,
  type EffectivePlan,
  type QuotaFeature,
  type QuotaValue,
} from './quotas';

export type GateOk = {
  kind: 'ok';
  userId: string;
  plan: EffectivePlan;
  feature: QuotaFeature;
  /** 当月 (UTC) の status='ok' 利用回数。'unlimited' のときは 0 を返す。 */
  used: number;
  limit: QuotaValue;
};

export type GateReject = {
  kind: 'reject';
  response: Response;
};

export type GateResult = GateOk | GateReject;

export type AuthOk = {
  kind: 'ok';
  userId: string;
  /** user-scoped (cookie バインド) supabase client。同一 request 内で再利用してよい。 */
  supabase: SupabaseClient;
};

export type AuthResult = AuthOk | GateReject;

/**
 * 認証のみを行い、userId と user-scoped supabase client を返す。
 *
 * STEP-TUTOR-ROUTING-AUDIT-01 (P0): ensurePlanQuota から auth 部分を分離したもの。
 * これにより呼び出し側は userId 確定後に「quota 判定 (checkPlanQuota)」と
 * 「他の userId-scoped 読み取り (例: tutor の context load)」を Promise.all で
 * 並列実行できる。auth.getUser の RTT は共有し、後続だけを並列化する。
 *
 * 返す supabase client は user-scoped。同一 request 内で使い回してよいが、request を
 * 跨いで共有してはならない (serverClient.ts の契約)。
 */
export async function authenticateRequest(): Promise<AuthResult> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return rejectJson({ error: 'supabase-unavailable' }, 500);
  }
  const t0 = Date.now();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    // Phase 0 instrumentation: ConnectTimeoutError 等の接続障害と本物の未認証を区別。
    // 既存挙動 (401 を返す) は変更しない。
    logAuthFail({
      route: 'planGate',
      phase: 'authenticateRequest',
      err: userErr ?? null,
      hasUser: Boolean(userData?.user),
      elapsedMs: Date.now() - t0,
    });
    return rejectJson({ error: 'unauthenticated' }, 401);
  }
  return { kind: 'ok', userId: userData.user.id, supabase };
}

/**
 * 認証済みの userId / user-scoped supabase client を前提に plan quota を判定する。
 *
 * 旧 ensurePlanQuota の step 2-5 (plan 解決 / QA bypass / quota lookup / 当月 COUNT /
 * 上限判定) を**挙動を変えずに**実行する。auth は呼び出し側で済ませる前提。
 * - profiles SELECT は渡された user-scoped supabase を使う (新規 client を作らない)。
 * - usage_records COUNT は従来どおり service_role client を使う。
 */
export async function checkPlanQuota(
  supabase: SupabaseClient,
  userId: string,
  feature: QuotaFeature,
): Promise<GateResult> {
  // 2. plan resolution (profiles.plan は webhook 同期済みの cache)
  const { data: profileRow, error: profileErr } = await supabase
    .from('profiles')
    .select('plan, is_qa_user')
    .eq('id', userId)
    .maybeSingle();
  if (profileErr) {
    devWarn('[planGate] profile select error', profileErr);
    return rejectJson({ error: 'plan-resolve-failed' }, 500);
  }
  const plan = normalizePlan(
    (profileRow?.plan as string | null | undefined) ?? null,
  );

  // 2.5. QA bypass: profiles.is_qa_user=true のユーザーのみ quota 判定前に通過。
  //   - 厳密に === true のときだけ通す (null / false / 列欠落は通常フローへ = fail-closed)。
  //   - 戻り値は 'unlimited' 経路と同形 (used:0, limit:'unlimited')。型変更は不要。
  //   - usage_records の記録は各 route 側でそのまま走る (観測用にログは残す)。
  if (profileRow?.is_qa_user === true) {
    console.info('[planGate] QA bypass', { userId, feature });
    return { kind: 'ok', userId, plan, feature, used: 0, limit: 'unlimited' };
  }

  // 3. quota lookup
  const limit = getQuotaForPlan(plan, feature);
  if (limit === 'unlimited') {
    return { kind: 'ok', userId, plan, feature, used: 0, limit };
  }

  // 4. 当月 (UTC) の status='ok' 件数を COUNT
  const admin = getServiceRoleSupabaseClient();
  const monthStartIso = startOfMonthUtc(new Date()).toISOString();
  const routes = FEATURE_ROUTE_KEYS[feature];
  const { count, error: countErr } = await admin
    .from('usage_records')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'ok')
    .gte('occurred_at', monthStartIso)
    .in('route', routes as string[]);
  if (countErr) {
    devWarn('[planGate] usage count error', {
      feature,
      message: countErr.message,
    });
    // fail-closed: 課金回避経路を作らない
    return rejectJson({ error: 'quota-check-failed' }, 500);
  }
  const used = count ?? 0;

  // 5. 上限判定
  if (used >= limit) {
    return rejectJson(
      {
        error: 'quota-exceeded',
        plan,
        feature,
        used,
        limit,
      },
      402,
    );
  }

  return { kind: 'ok', userId, plan, feature, used, limit };
}

/**
 * Plan Gate 本体 (auth + quota)。既存呼び出し側 (13 route) との後方互換のため
 * signature / 戻り値 / 挙動は不変。内部で authenticateRequest → checkPlanQuota を
 * 順に実行する (従来と同じ auth → profiles → count の順序・同じ Response 群)。
 */
export async function ensurePlanQuota(
  feature: QuotaFeature,
): Promise<GateResult> {
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth;
  return checkPlanQuota(auth.supabase, auth.userId, feature);
}

function rejectJson(
  body: Record<string, unknown>,
  status: number,
): GateReject {
  return {
    kind: 'reject',
    response: NextResponse.json(body, { status }),
  };
}

function normalizePlan(raw: string | null): EffectivePlan {
  if (raw === 'basic' || raw === 'premium') return raw;
  // 'free' / null / 不明値はすべて 'free' に寄せる (fail-closed)
  return 'free';
}

/** UTC 暦月の 1 日 00:00:00.000 を返す。 */
function startOfMonthUtc(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}
