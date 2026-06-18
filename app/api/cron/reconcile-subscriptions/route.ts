/**
 * Daily subscription reconciliation cron.
 *
 * 目的:
 *   Stripe webhook の取りこぼし・順序ズレ・処理失敗で
 *   Supabase 側（subscriptions.status/plan/period, profiles.plan）が
 *   Stripe の実状態とズレた場合に、それを毎日 1 回検知して修復する。
 *   Stripe を常に「正」とし、Supabase を Stripe に合わせて寄せる。
 *
 * 設計方針（既存資産の再利用）:
 *   - 修復の本体は webhook と同じ `syncSubscriptionFromStripe(sub)` を呼ぶ。
 *     これにより subscriptions の upsert ロジックと profiles.plan 導出
 *     （`deriveEffectivePlan`）が webhook と完全に一致し、二重実装による
 *     乖離を避ける。
 *   - past_due / canceled / grace period の扱いは `deriveEffectivePlan` の
 *     既存ポリシーをそのまま採用する（past_due は plan 維持 + status=past_due、
 *     canceled でも current_period_end が未来なら grace で維持、
 *     unpaid / incomplete / incomplete_expired は権利なし → free）。
 *
 * 認証:
 *   - `Authorization: Bearer ${CRON_SECRET}` のみ許可。それ以外は 401。
 *   - Vercel Cron は CRON_SECRET 設定時に自動でこの header を付与する。
 *   - CRON_SECRET 未設定なら fail-closed で 401（誰も叩けない）。
 *
 * dry-run:
 *   - `?dryRun=true`（または `?dry=1`）で書き込みを一切行わず、検知のみ。
 *   - クエリ無し（= 通常の cron 実行）は実際に修復を適用する。
 *
 * 非破壊原則:
 *   - subscriptions / profiles の行を DELETE しない。
 *   - Stripe 側に存在しない（retrieve 失敗）行は error として報告するだけで触らない。
 *
 * Runtime:
 *   - Stripe SDK は Node.js runtime 必須。
 *   - dynamic = 'force-dynamic' でキャッシュ対象化を防止。
 *
 * 必要 env:
 *   - CRON_SECRET
 *   - STRIPE_SECRET_KEY / STRIPE_PRICE_ID_{BASIC,PREMIUM}
 *   - SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL
 *
 * 手動実行 (curl):
 *   # 401 になること（secret 無し）
 *   curl -i https://<host>/api/cron/reconcile-subscriptions
 *
 *   # dry-run（書き込みなし・検知のみ）
 *   curl -s -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://<host>/api/cron/reconcile-subscriptions?dryRun=true" | jq
 *
 *   # 本実行（修復を適用）
 *   curl -s -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://<host>/api/cron/reconcile-subscriptions" | jq
 */

import 'server-only';

import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import {
  deriveEffectivePlan,
  syncSubscriptionFromStripe,
  type EffectivePlan,
} from '@/lib/billing/syncSubscription';
import { type PlanId } from '@/lib/billing/plans';
import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { getPlanFromPriceId, getStripeClient } from '@/lib/stripe/server';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Stripe への往復が件数分あるため、デフォルト 60s より余裕を持たせる。
// Vercel のプラン上限を超える指定はプラットフォーム側で clamp される。
export const maxDuration = 300;

const PAGE_SIZE = 1000;

// ───────────────────────────── auth ─────────────────────────────

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // fail-closed: secret 未設定なら誰も通さない。
  if (!secret) return false;
  const header = req.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

// ───────────────────────── stored / stripe types ─────────────────────────

type SubscriptionRow = {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

type ProfileRow = {
  id: string;
  plan: string;
  is_qa_user: boolean;
};

/** Stripe Subscription から見た「あるべき値」。 */
type StripeView = {
  plan: PlanId | null;
  priceId: string | null;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type ChangeKind =
  | 'subscription-row'
  | 'profile-plan'
  | 'orphan-profile';

type Change = {
  kind: ChangeKind;
  userId: string;
  subscriptionId?: string;
  fields?: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

type ReconcileError = {
  scope: 'subscription' | 'profile';
  userId?: string;
  subscriptionId?: string;
  code: string;
  message: string;
};

// ───────────────────────── helpers ─────────────────────────

function unixSecondsToIso(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * timestamptz 同士の比較。Supabase は `+00:00`、こちらは `Z` 形式など表記が
 * 揺れるため、epoch ms に正規化して比較する。両方 null は等しい。
 */
function timestampsEqual(a: string | null, b: string | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

function extractStripeView(sub: Stripe.Subscription): StripeView {
  const item = sub.items.data[0];
  if (!item) {
    return {
      plan: null,
      priceId: null,
      status: sub.status,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
  }
  const priceId = typeof item.price === 'string' ? item.price : item.price.id;
  return {
    plan: getPlanFromPriceId(priceId),
    priceId,
    status: sub.status,
    // API 2026-05-27.dahlia: period は item 側。
    currentPeriodStart: unixSecondsToIso(item.current_period_start),
    currentPeriodEnd: unixSecondsToIso(item.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

/** stored row が Stripe view とズレているフィールド名一覧。 */
function diffSubscriptionFields(row: SubscriptionRow, view: StripeView): string[] {
  const fields: string[] = [];
  if (view.plan && row.plan !== view.plan) fields.push('plan');
  if (row.status !== view.status) fields.push('status');
  if (row.cancel_at_period_end !== view.cancelAtPeriodEnd) {
    fields.push('cancel_at_period_end');
  }
  if (!timestampsEqual(row.current_period_start, view.currentPeriodStart)) {
    fields.push('current_period_start');
  }
  if (!timestampsEqual(row.current_period_end, view.currentPeriodEnd)) {
    fields.push('current_period_end');
  }
  return fields;
}

/** subscriptions を全件ページングで取得。 */
async function fetchAllSubscriptions(
  supabase: ReturnType<typeof getServiceRoleSupabaseClient>,
): Promise<SubscriptionRow[]> {
  const rows: SubscriptionRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('subscriptions')
      .select(
        'user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end, cancel_at_period_end',
      )
      .order('stripe_subscription_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`subscriptions fetch failed: ${error.message}`);
    }
    const batch = (data ?? []) as SubscriptionRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchProfilesByIds(
  supabase: ReturnType<typeof getServiceRoleSupabaseClient>,
  ids: string[],
): Promise<Map<string, ProfileRow>> {
  const map = new Map<string, ProfileRow>();
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const chunk = ids.slice(i, i + PAGE_SIZE);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, plan, is_qa_user')
      .in('id', chunk);
    if (error) {
      throw new Error(`profiles fetch failed: ${error.message}`);
    }
    for (const p of (data ?? []) as ProfileRow[]) map.set(p.id, p);
  }
  return map;
}

/** plan != 'free' の profiles を全件取得（orphan 検出用）。 */
async function fetchNonFreeProfiles(
  supabase: ReturnType<typeof getServiceRoleSupabaseClient>,
): Promise<ProfileRow[]> {
  const rows: ProfileRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, plan, is_qa_user')
      .neq('plan', 'free')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`non-free profiles fetch failed: ${error.message}`);
    }
    const batch = (data ?? []) as ProfileRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

// ───────────────────────── core ─────────────────────────

async function reconcile(dryRun: boolean) {
  const supabase = getServiceRoleSupabaseClient();
  const stripe = getStripeClient();

  const subscriptionRows = await fetchAllSubscriptions(supabase);

  // user_id ごとに subscription 行をまとめる。
  const byUser = new Map<string, SubscriptionRow[]>();
  for (const row of subscriptionRows) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  const userIds = [...byUser.keys()];
  const profilesMap = await fetchProfilesByIds(supabase, userIds);

  const changes: Change[] = [];
  const errors: ReconcileError[] = [];
  let repairedSubscriptions = 0;
  let repairedProfiles = 0;

  // ── Phase A: subscriptions ↔ Stripe を user 単位で突き合わせ ──
  for (const [userId, rows] of byUser) {
    // 各 subscription 行について Stripe の最新状態を取得。
    const retrieved: Array<{
      row: SubscriptionRow;
      sub: Stripe.Subscription | null;
      view: StripeView | null;
      driftFields: string[];
    }> = [];

    for (const row of rows) {
      try {
        const sub = await stripe.subscriptions.retrieve(
          row.stripe_subscription_id,
        );
        const view = extractStripeView(sub);
        if (!view.plan) {
          // price_id が env と対応しない（別商品混入 / env 破損）。
          // 権利を誤って剥奪しないよう、この行は触らず error 報告のみ。
          errors.push({
            scope: 'subscription',
            userId,
            subscriptionId: row.stripe_subscription_id,
            code: 'unknown-plan',
            message: `unknown price_id=${view.priceId ?? 'null'}`,
          });
          retrieved.push({ row, sub, view: null, driftFields: [] });
          continue;
        }
        const driftFields = diffSubscriptionFields(row, view);
        retrieved.push({ row, sub, view, driftFields });
      } catch (err) {
        // Stripe 側に存在しない / 一時的失敗。非破壊原則で行は触らない。
        const message =
          err instanceof Error ? err.message : 'stripe retrieve failed';
        const code =
          (err as { code?: string } | null)?.code ?? 'stripe-retrieve-failed';
        errors.push({
          scope: 'subscription',
          userId,
          subscriptionId: row.stripe_subscription_id,
          code,
          message,
        });
        retrieved.push({ row, sub: null, view: null, driftFields: [] });
      }
    }

    // 修復後の「あるべき行」から effective plan を導出。
    // retrieve 失敗 / unknown-plan の行は stored 値を温存して導出に使う
    //（情報が無いのに権利を落とさないため）。
    const correctedRows = retrieved.map(({ row, view }) =>
      view
        ? {
            plan: view.plan as string,
            status: view.status,
            current_period_end: view.currentPeriodEnd,
            cancel_at_period_end: view.cancelAtPeriodEnd,
          }
        : {
            plan: row.plan,
            status: row.status,
            current_period_end: row.current_period_end,
            cancel_at_period_end: row.cancel_at_period_end,
          },
    );
    const effectivePlan: EffectivePlan = deriveEffectivePlan(correctedRows);

    // subscription 行の drift を記録。
    const driftedSubs = retrieved.filter((r) => r.driftFields.length > 0);
    for (const r of driftedSubs) {
      changes.push({
        kind: 'subscription-row',
        userId,
        subscriptionId: r.row.stripe_subscription_id,
        fields: r.driftFields,
        before: {
          plan: r.row.plan,
          status: r.row.status,
          cancel_at_period_end: r.row.cancel_at_period_end,
          current_period_start: r.row.current_period_start,
          current_period_end: r.row.current_period_end,
        },
        after: {
          plan: r.view!.plan,
          status: r.view!.status,
          cancel_at_period_end: r.view!.cancelAtPeriodEnd,
          current_period_start: r.view!.currentPeriodStart,
          current_period_end: r.view!.currentPeriodEnd,
        },
      });
    }

    // profiles.plan の drift を記録。
    const profile = profilesMap.get(userId);
    const profileDrift = profile != null && profile.plan !== effectivePlan;
    if (profileDrift) {
      changes.push({
        kind: 'profile-plan',
        userId,
        before: { plan: profile!.plan },
        after: { plan: effectivePlan },
      });
    }

    const anyDrift = driftedSubs.length > 0 || profileDrift;
    if (!anyDrift || dryRun) continue;

    // ── 実修復: webhook と同じ sync を呼ぶ ──
    // drift した行を sync すれば subscriptions も profiles.plan も寄る。
    // sub-row drift は無いが profile だけズレている場合でも、
    // 取得できた sub を 1 件 sync すれば profile が再導出される。
    let subsToSync = driftedSubs
      .map((r) => r.sub)
      .filter((s): s is Stripe.Subscription => s != null);
    if (subsToSync.length === 0 && profileDrift) {
      const anyValid = retrieved.find((r) => r.sub != null && r.view != null);
      if (anyValid?.sub) subsToSync = [anyValid.sub];
    }

    let repairedAnySubThisUser = false;
    for (const sub of subsToSync) {
      try {
        const result = await syncSubscriptionFromStripe(sub);
        if (result.kind === 'ok') {
          repairedAnySubThisUser = true;
        } else {
          errors.push({
            scope: 'subscription',
            userId,
            subscriptionId: sub.id,
            code: `sync-${result.kind}`,
            message: JSON.stringify(result),
          });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'sync threw unknown error';
        errors.push({
          scope: 'subscription',
          userId,
          subscriptionId: sub.id,
          code: 'sync-threw',
          message,
        });
      }
    }

    repairedSubscriptions += driftedSubs.filter((r) => r.sub != null).length;
    if (profileDrift && repairedAnySubThisUser) repairedProfiles += 1;
  }

  // ── Phase B: orphan profiles ──
  // subscription 行を 1 つも持たないのに plan != 'free' の profile を「検知」する。
  // 自動 free 降格はデフォルトで行わず report-only（changes / orphanProfilesFlagged に
  // 記録するのみ）。実際に降格するのは RECONCILE_ORPHAN_DOWNGRADE='true' のときだけ。
  // is_qa_user は意図的な特権付与のため検知対象から除外する。
  //
  // 経緯: 本コードベースには profiles.plan を非free にする経路が syncSubscriptionFromStripe
  // （subscriptions upsert 成功後にのみ profiles.plan を更新）しか無く、§24 trigger で
  // client からの plan 書き換えも塞がれている。したがって orphan（非free かつ行ゼロ）は
  // 通常の課金フロー・webhook 失敗では発生せず、アプリ外の手動 plan 付与（is_qa_user 未設定）
  // でのみ起こり得る。そのケースを自動 free 化すると正規の手動付与ユーザーを誤降格するため、
  // 既定では検知のみとし、降格は env で明示的に opt-in したときに限る（本番は未設定前提）。
  const orphanDowngradeEnabled =
    process.env.RECONCILE_ORPHAN_DOWNGRADE === 'true';
  let orphanProfilesRepaired = 0;
  let orphanProfilesChecked = 0;
  try {
    const nonFreeProfiles = await fetchNonFreeProfiles(supabase);
    for (const profile of nonFreeProfiles) {
      if (byUser.has(profile.id)) continue; // Phase A で処理済み
      if (profile.is_qa_user) continue; // QA 特権は触らない
      orphanProfilesChecked += 1;
      changes.push({
        kind: 'orphan-profile',
        userId: profile.id,
        before: { plan: profile.plan },
        after: { plan: 'free' },
      });
      if (dryRun) continue;
      // report-only: env で opt-in しない限り profiles.plan は変更しない。
      // （検知・changes 記録・orphanProfilesFlagged カウントは上で済んでいる）
      if (!orphanDowngradeEnabled) continue;
      const { error } = await supabase
        .from('profiles')
        .update({ plan: 'free' })
        .eq('id', profile.id);
      if (error) {
        errors.push({
          scope: 'profile',
          userId: profile.id,
          code: 'orphan-update-failed',
          message: error.message,
        });
      } else {
        orphanProfilesRepaired += 1;
      }
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'orphan scan failed';
    errors.push({ scope: 'profile', code: 'orphan-scan-failed', message });
  }

  return {
    dryRun,
    scanned: {
      subscriptions: subscriptionRows.length,
      users: byUser.size,
      orphanProfilesFlagged: orphanProfilesChecked,
    },
    repaired: {
      subscriptionRows: repairedSubscriptions,
      profilePlans: repairedProfiles,
      orphanProfiles: dryRun ? orphanProfilesChecked : orphanProfilesRepaired,
    },
    driftDetected: changes.length,
    errorCount: errors.length,
    // ペイロード肥大化を防ぐため詳細は上限付きで返す。
    changes: changes.slice(0, 200),
    errors: errors.slice(0, 200),
  };
}

// ───────────────────────── handler ─────────────────────────

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryParam = url.searchParams.get('dryRun') ?? url.searchParams.get('dry');
  const dryRun = dryParam === 'true' || dryParam === '1';

  const startedAt = new Date().toISOString();
  try {
    const summary = await reconcile(dryRun);
    return NextResponse.json(
      { ok: true, startedAt, finishedAt: new Date().toISOString(), ...summary },
      { status: 200 },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'reconciliation failed';
    devWarn('[cron/reconcile-subscriptions] fatal', message);
    captureRouteException(
      err,
      { route: 'cron/reconcile-subscriptions', feature: 'billing', status: 500 },
      { status: 500, code: 'reconcile-fatal' },
    );
    return NextResponse.json(
      { ok: false, error: message, startedAt },
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
