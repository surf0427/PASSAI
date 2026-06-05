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
 *   - server (nodejs) runtime のみで実行。Edge Runtime では undici を import せず何もしない。
 */
export async function register(): Promise<void> {
  // Edge Runtime では undici を使えない / 不要。nodejs runtime のみ。
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { setGlobalDispatcher, Agent } = await import('undici');
  setGlobalDispatcher(
    new Agent({
      connect: { timeout: 4000 },
      autoSelectFamily: true,
      keepAliveTimeout: 30_000,
    }),
  );
}
