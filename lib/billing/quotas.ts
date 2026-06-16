/**
 * STEP-BILLING-06: プラン別利用上限の定義。
 *
 * 設計方針:
 *   - 機能単位の月次上限。トークン総量ではなく「ユーザーが触る機能」単位で
 *     上限を切ることで、料金ページとの理解が一致するようにする
 *     (例: "志望理由書添削 30 回/月" は usage_records.route='statement-review'
 *     の月次 ok 件数で判定する)。
 *   - 月の境界は **UTC 暦月の 1 日 00:00** を採用 (lib/billing/planGate.ts で実装)。
 *     ユーザーの想定する「今月」とは数時間のズレが出るが、一貫性を優先。
 *   - Free プランは全機能 0 回 = サブスク必須。PASSAI は無料プラン無し方針。
 *   - 受験タイプ診断はランタイム AI を呼ばない (deterministic)。本テーブルには
 *     登場しない = "実質無制限"。
 *
 *   将来の拡張余地:
 *     - 'unlimited' を上限値として受け付ける形に拡張済み (現状未使用)
 *     - 1 feature が複数 route に分かれた場合は FEATURE_ROUTE_KEYS を拡張
 */

import type { PlanId } from './plans';

/**
 * 課金対象になる "ユーザーが認識する機能" の識別子。
 * 料金ページに並ぶ 5 機能と 1:1 対応する。
 */
export const QUOTA_FEATURES = [
  'statement', // 志望理由書添削
  'essay', // 小論文添削
  'self-pr', // 自己PR添削 (route 未実装。quota だけ予約)
  'interview', // 面接フィードバック (既存: interview-feedback / interview-questions)
  'interview-ai', // 面接AI (リアルタイム面接セッション。STEP-INTERVIEW-AI-PR4)
  'tutor', // Tutor
] as const;

export type QuotaFeature = (typeof QUOTA_FEATURES)[number];

/**
 * `profiles.plan` に入る正規化済み値。
 * Stripe を通っていないユーザーは 'free' (= デフォルト値)。
 * webhook が basic/premium に書き換える ([lib/billing/syncSubscription.ts])。
 */
export type EffectivePlan = 'free' | PlanId;

/**
 * 上限値。number = 月次回数。'unlimited' = 無制限 (現状未使用、将来予約)。
 */
export type QuotaValue = number | 'unlimited';

/**
 * プラン x 機能 の上限テーブル。月次。
 * 値変更は本ファイルで完結する。料金ページ ([app/components/landing/PricingSection.tsx])
 * の表記とは別レイヤなので、上限改定時は両方を同時に更新する。
 */
export const QUOTAS: Record<EffectivePlan, Record<QuotaFeature, QuotaValue>> = {
  free: {
    statement: 0,
    essay: 0,
    'self-pr': 0,
    interview: 0,
    'interview-ai': 0,
    tutor: 0,
  },
  basic: {
    statement: 30,
    essay: 30,
    // self-pr は STEP-GATE-COMPLETE で 6 route (analysis / analysis/additional /
    // summarize / reason / matching / self-pr-review[未実装]) を集約しており、
    // 1 壁打ちフローで 3-4 件消費する。30 だと月 5-7 回で枯渇 → 100 に増額
    // (STEP-QUOTA-TUNING-01)。matching を独立 feature に分離する案は残課題。
    'self-pr': 100,
    interview: 30,
    // 面接AI: 1 セッション 1 消費。STT + 逐次ターン生成で原価が面接フィードバックより
    // 高いため、basic は 10 回/月（pr0_design.md §5.1）。
    'interview-ai': 10,
    tutor: 500,
  },
  premium: {
    statement: 100,
    essay: 100,
    // basic 100 に対して premium は 3 倍枠で 300 を確保 (STEP-QUOTA-TUNING-01)。
    // self-pr 集約 route は 6 つあるため他 feature より大きめの枠でも実コスト
    // 影響は限定的 (1 件あたり Sonnet 4-6 small input ~$0.005)。
    'self-pr': 300,
    interview: 100,
    // 面接AI: premium は basic 10 の 3 倍枠で 30 回/月（pr0_design.md §5.1）。
    'interview-ai': 30,
    tutor: 2000,
  },
};

/**
 * 各 feature を計上する usage_records.route の値のリスト。
 *   - STEP-BILLING-06 時点では 1 feature = 1 route の 1:1 対応。
 *   - 1 feature が複数 route に分かれる場合 (例: statement-review +
 *     statement-prepare を両方カウントしたい等) は配列を拡張するだけで済む。
 *   - 値の形式は schema コメント (supabase/schema.sql §30 usage_records.route)
 *     に合わせて `app/api/<name>/route.ts` の `<name>` を入れる規約。
 */
export const FEATURE_ROUTE_KEYS: Record<QuotaFeature, readonly string[]> = {
  // 志望理由書: 添削 (-review) + 整理メモ (-prepare)
  statement: ['statement-review', 'statement-prepare'],
  // 小論文: 添削 (-review) + チャット (-chat) + 改善方針 (-improve-summary)
  //         + 改善の深掘り質問生成 (-deep-questions) + テーマ追加生成 (-themes)
  essay: [
    'essay-review',
    'essay-chat',
    'essay-improve-summary',
    'essay-deep-questions',
    'essay-themes',
  ],
  // 自己PR / 自己分析クラスタ:
  //   - self-pr-review: 未実装、quota 予約
  //   - analysis: 自己分析 (壁打ち) profile + 質問生成
  //   - analysis/additional: 追加深掘り質問
  //   - summarize: 自己分析の要約
  //   - reason: 自己PR ページから呼ばれる plain text 応答
  //   - matching: 志望校マッチング narrative (既存 5 feature の中で最も親和性が高い
  //     ものとして self-pr に集約。matching 専用 quota を分ける拡張余地は残課題)
  'self-pr': [
    'self-pr-review',
    'analysis',
    'analysis/additional',
    'summarize',
    'reason',
    'matching',
  ],
  // 面接: フィードバック (-feedback) + 質問生成 (-questions)
  interview: ['interview-feedback', 'interview-questions'],
  // 面接AI: リアルタイム面接セッション。1 セッション = usage_records.route='interview-ai' の
  // status='ok' 1 件（usage_recorded compare-and-set による冪等計上）。月次 ok 件数 = 当月
  // セッション数（pr0_design.md §5.2）。
  'interview-ai': ['interview-ai'],
  // Tutor は 1 route のみ
  tutor: ['tutor'],
};

export function isQuotaFeature(value: unknown): value is QuotaFeature {
  return (
    typeof value === 'string' &&
    (QUOTA_FEATURES as readonly string[]).includes(value)
  );
}

export function getQuotaForPlan(
  plan: EffectivePlan,
  feature: QuotaFeature,
): QuotaValue {
  return QUOTAS[plan][feature];
}
