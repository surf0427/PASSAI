// 重要 API 用の captureException ラッパ。
//
// 目的:
//   route handler の catch から呼び、Sentry へ例外を送る際の tags / extra を
//   一元化する。これにより「extra にユーザー本文や AI 出力全文を絶対に入れない」
//   （要件 12）を呼び出し側のミスに依らず構造的に担保する。
//
//   - tags  : route / feature / plan / status のみ（要件 10）。
//   - extra : status / code / durationMs / retryCount のみ（要件 11）。
//   本関数のシグネチャ上、これ以外のフィールドは受け付けない。
//
//   Sentry 未初期化（= 非本番 / DSN 未設定）時 captureException は no-op のため、
//   呼び出しても既存レスポンスや挙動には一切影響しない（無条件に呼んで安全）。
//   また beforeSend のスクラバ（lib/sentry/scrub.ts）が最終防衛線として
//   万一の機密混入を除去する。

import * as Sentry from '@sentry/nextjs';

type RouteTags = {
  /** route 識別子（例: 'api/tutor', 'billing/checkout'）。 */
  route: string;
  /** 機能ドメイン（例: 'tutor', 'billing', 'auth'）。 */
  feature: string;
  /** 課金プラン（判明している場合のみ）。 */
  plan?: string | null;
  /** 返却した HTTP status / 結果区分。 */
  status?: number | string | null;
};

type RouteExtra = {
  /** HTTP status code。 */
  status?: number | string | null;
  /** アプリ内 error code（例: 'AI_REQUEST_FAILED', 'stripe-error'）。 */
  code?: string | null;
  /** route 開始からの所要時間 (ms)。 */
  durationMs?: number | null;
  /** リトライ回数（判明している場合のみ）。 */
  retryCount?: number | null;
};

export function captureRouteException(
  error: unknown,
  tags: RouteTags,
  extra: RouteExtra = {},
): void {
  // tags は常に string 化（Sentry の tag value は string 推奨）。null/undefined は省く。
  const tagRecord: Record<string, string> = {
    route: tags.route,
    feature: tags.feature,
  };
  if (tags.plan != null) tagRecord.plan = String(tags.plan);
  if (tags.status != null) tagRecord.status = String(tags.status);

  // extra は許可フィールドのみ。本文・出力全文は型レベルで入らない。
  const extraRecord: Record<string, number | string> = {};
  if (extra.status != null) extraRecord.status = extra.status;
  if (extra.code != null) extraRecord.code = extra.code;
  if (extra.durationMs != null) extraRecord.durationMs = extra.durationMs;
  if (extra.retryCount != null) extraRecord.retryCount = extra.retryCount;

  Sentry.captureException(error, { tags: tagRecord, extra: extraRecord });
}
