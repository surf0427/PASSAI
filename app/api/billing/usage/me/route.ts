/**
 * STEP-BILLING-07: 自分の当月利用状況サマリー API。
 *
 * 受信:
 *   GET (body 不要)
 *
 * レスポンス:
 *   200 {
 *     plan: 'free' | 'basic' | 'premium',
 *     quotas: {
 *       statement: { used: number, limit: number | 'unlimited' },
 *       essay:     { used: number, limit: number | 'unlimited' },
 *       'self-pr': { used: number, limit: number | 'unlimited' },
 *       interview: { used: number, limit: number | 'unlimited' },
 *       tutor:     { used: number, limit: number | 'unlimited' },
 *     },
 *     resetAt: string  // 次回リセット (UTC 月初の翌月) の ISO
 *   }
 *   401 { error: 'unauthenticated' }
 *   500 { error: 'supabase-unavailable' | 'usage-fetch-failed' }
 *
 * 設計:
 *   - plan は profiles.plan (webhook 同期済み cache) を読む。
 *   - used は usage_records を feature ごとに COUNT。Promise.all で並列化。
 *   - "本STEPでは UI に出さない feature" (self-pr 等) も含めて返す。UI 側で
 *     表示有無を制御する。
 *   - quota = 0 でも quota は返す (Free 表示で 0/0 と出る前提)。
 *
 * 認可:
 *   user-scoped client で auth.uid() = user_id を担保しつつ、COUNT 用に
 *   service_role を補助的に使う ([lib/billing/planGate.ts] と同じ理由)。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import {
  FEATURE_ROUTE_KEYS,
  QUOTAS,
  QUOTA_FEATURES,
  type EffectivePlan,
  type QuotaFeature,
  type QuotaValue,
} from '@/lib/billing/quotas';
import { getServerSupabaseClient } from '@/lib/supabase/serverClient';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FeatureUsage = { used: number; limit: QuotaValue };
type UsageSummary = {
  plan: EffectivePlan;
  quotas: Record<QuotaFeature, FeatureUsage>;
  resetAt: string;
};

export async function GET() {
  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'supabase-unavailable' },
      { status: 500 },
    );
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userData.user.id;

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('plan, is_qa_user')
    .eq('id', userId)
    .maybeSingle();
  const plan = normalizePlan(
    (profileRow?.plan as string | null | undefined) ?? null,
  );
  // QA ユーザーは planGate と同様に全 feature を実質無制限扱い。表示も unlimited に
  // 寄せる ([lib/billing/planGate.ts] の bypass と整合)。used は実カウントをそのまま出す。
  const isQaUser = profileRow?.is_qa_user === true;

  const monthStart = startOfMonthUtc(new Date());
  const monthStartIso = monthStart.toISOString();
  const resetAt = startOfNextMonthUtc(monthStart).toISOString();

  const admin = getServiceRoleSupabaseClient();

  // feature ごとに COUNT を並列実行 (N=5 の小規模、Promise.all で問題なし)
  const countResults = await Promise.all(
    QUOTA_FEATURES.map(async (feature) => {
      const routes = FEATURE_ROUTE_KEYS[feature];
      const { count, error } = await admin
        .from('usage_records')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'ok')
        .gte('occurred_at', monthStartIso)
        .in('route', routes as string[]);
      return { feature, count: count ?? 0, error };
    }),
  );

  const anyError = countResults.find((r) => r.error);
  if (anyError) {
    devWarn('[usage/me] count failed', {
      feature: anyError.feature,
      message: anyError.error?.message,
    });
    return NextResponse.json(
      { error: 'usage-fetch-failed' },
      { status: 500 },
    );
  }

  const quotas = countResults.reduce<Record<QuotaFeature, FeatureUsage>>(
    (acc, r) => {
      acc[r.feature] = {
        used: r.count,
        limit: isQaUser ? 'unlimited' : QUOTAS[plan][r.feature],
      };
      return acc;
    },
    {} as Record<QuotaFeature, FeatureUsage>,
  );

  const body: UsageSummary = { plan, quotas, resetAt };
  return NextResponse.json(body, { status: 200 });
}

function normalizePlan(raw: string | null): EffectivePlan {
  if (raw === 'basic' || raw === 'premium') return raw;
  return 'free';
}

function startOfMonthUtc(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

function startOfNextMonthUtc(monthStart: Date): Date {
  return new Date(
    Date.UTC(
      monthStart.getUTCFullYear(),
      monthStart.getUTCMonth() + 1,
      1,
      0,
      0,
      0,
      0,
    ),
  );
}
