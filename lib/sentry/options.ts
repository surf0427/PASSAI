// Sentry 共通設定値。client / server / edge の 3 config から参照する。
//
// 方針（最小安全構成）:
//   - 送信は本番のみ。NODE_ENV !== 'production' では enabled=false（送信無効）かつ
//     tracesSampleRate=0 に倒す（要件 5）。
//   - DSN が無ければ Sentry.init は no-op。誤って dev/preview に送らないよう
//     enabled 側でも DSN の有無を二重チェックする。
//   - sendDefaultPii は常に false（要件 7）。cookie/IP/headers の自動添付を防ぐ。
//
// 環境変数:
//   - SENTRY_DSN            : server/edge 用 DSN（サーバ専用、ブラウザに露出しない）。
//   - NEXT_PUBLIC_SENTRY_DSN: client 用 DSN（ブラウザに埋め込まれるため NEXT_PUBLIC 必須）。
//   - SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN : build 時の source map upload 用
//     （next.config.ts の withSentryConfig が参照。runtime では未使用）。
//   - 環境名は NEXT_PUBLIC_VERCEL_ENV → VERCEL_ENV → NODE_ENV の順で解決する
//     （client では NEXT_PUBLIC_ 接頭辞のものだけが利用可能）。

// 本番のみ送信を有効化する master switch。
export const SENTRY_ENABLED = process.env.NODE_ENV === 'production';

// server/edge 用 DSN。サーバ専用変数を優先し、無ければ public 版にフォールバック。
export const SERVER_DSN =
  process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN ?? undefined;

// client 用 DSN。ブラウザバンドルに含めるため NEXT_PUBLIC_ のものだけ。
export const CLIENT_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? undefined;

// 環境名（Sentry の environment タグ）。
export const SENTRY_ENVIRONMENT =
  process.env.NEXT_PUBLIC_VERCEL_ENV ??
  process.env.VERCEL_ENV ??
  process.env.NODE_ENV ??
  'development';

// trace サンプリング率。本番は低率（10%）、非本番は 0（要件 5: 0 に近づける）。
// Error Tracking 優先のため performance trace は控えめにする。
export const TRACES_SAMPLE_RATE = SENTRY_ENABLED ? 0.1 : 0;

// Session Replay サンプリング率（client 専用）。
//   - 通常セッション: 0（要件 6）。
//   - エラー発生セッション: 本番のみ 1.0、非本番は 0（要件 6）。
export const REPLAYS_SESSION_SAMPLE_RATE = 0;
export const REPLAYS_ON_ERROR_SAMPLE_RATE = SENTRY_ENABLED ? 1.0 : 0;
