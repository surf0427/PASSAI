/**
 * Next.js instrumentation hook — STEP-AUTH-CONNECTIVITY-01 / Phase 1.
 *
 * 目的:
 *   Supabase (*.supabase.co) / Stripe / Anthropic への global fetch が
 *   IPv6 / dual-stack の接続ストールに当たると、undici デフォルトの
 *   connectTimeout(10s) まで張り付き ConnectTimeoutError になる。これを緩和する。
 *
 * しくみ:
 *   Node の global fetch は globalThis 上の共有シンボル経由で npm undici の
 *   global dispatcher を参照する。よって setGlobalDispatcher が組み込み fetch に
 *   も効く。Supabase / Stripe / Anthropic の client コードは一切変更しない。
 *
 * 設定:
 *   - connect.timeout  = 4000  : cold connect を 4s で早期失敗させる (10s→4s)
 *   - autoSelectFamily = true  : Happy Eyeballs。IPv6 ストールを IPv4 で即救済
 *   - keepAliveTimeout = 30000 : 接続を再利用し cold 接続そのものを減らす
 *
 * 制約:
 *   - undici の dispatcher 設定は server (nodejs) runtime のみで実行。
 *     Edge Runtime では undici を import せず何もしない。
 *
 * Sentry (STEP-OBSERVABILITY-SENTRY-01):
 *   - 同じ register() フックで runtime 別の Sentry config を読み込む。
 *     nodejs → sentry.server.config / edge → sentry.edge.config。
 *   - undici 設定（既存挙動）は一切変更しない。Sentry 初期化を後段に追加するだけ。
 *   - onRequestError は Next.js 16 の server instrumentation hook。Sentry が
 *     server 側（RSC / route handler 等）の error を捕捉するために必要。
 */
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 既存挙動: undici global dispatcher の調整（nodejs runtime のみ）。
    const { setGlobalDispatcher, Agent } = await import('undici');
    setGlobalDispatcher(
      new Agent({
        connect: { timeout: 4000 },
        autoSelectFamily: true,
        keepAliveTimeout: 30_000,
      }),
    );

    // Sentry server 初期化。
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Edge Runtime では undici を使えない / 不要。Sentry edge 初期化のみ。
    await import('./sentry.edge.config');
  }
}

// Next.js 16 server instrumentation: request 処理中の error を Sentry へ転送する。
export const onRequestError = Sentry.captureRequestError;
