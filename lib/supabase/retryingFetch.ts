import 'server-only';

/**
 * STEP-AUTH-CONNECTIVITY-01 / Phase 2: server-side Supabase fetch の
 * timeout + 1回 retry ラッパ。
 *
 * 目的:
 *   Vercel cold start / intermittent network failure で *.supabase.co への
 *   接続が稀に失敗する。Phase 1 (undici dispatcher: connect.timeout=4000) が
 *   早期失敗させた直後に「1回だけ」張り直すことで、ユーザーに見える失敗を吸収する。
 *
 * 設計方針 (安全側):
 *   - timeout: リクエスト全体に AbortSignal.timeout(6000) を被せる。caller が
 *     signal を渡している場合は AbortSignal.any で合成し、どちらの中断も尊重する。
 *   - retry は最大 1 回。POST 等の非冪等メソッドを無制限に叩かない。
 *   - 4xx/5xx の HTTP レスポンスは「成功した往復」なので retry しない（throw されない）。
 *   - retry 対象は network/connect 系の throw のみ。さらに二重実行を避けるため:
 *       * connect-phase エラー（接続が確立されず request がサーバへ届いていない
 *         ことが確実: ConnectTimeoutError / UND_ERR_CONNECT_TIMEOUT / ENOTFOUND /
 *         EAI_AGAIN）→ メソッド問わず retry 可（再送しても二重実行にならない）。
 *       * それ以外の network エラー（ECONNRESET / ETIMEDOUT / fetch failed /
 *         TimeoutError 等、mid-flight の可能性あり）→ 冪等メソッド(GET/HEAD/OPTIONS)
 *         のみ retry。POST/PUT/PATCH/DELETE は retry しない。
 *   - retry した時だけ console.warn('[SupabaseRetry]', {...}) を出す。
 *
 * このラッパは serverClient / serviceRoleClient の global.fetch に注入する。
 * browserClient は対象外（Phase 2 では触らない）。
 */

const TIMEOUT_MS = 6000;
const RETRY_DELAY_MS = 200; // 150〜300ms 目安
const MAX_RETRIES = 1;

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 接続が確立されず request がサーバへ届いていないことが確実なエラー（再送安全）。 */
const CONNECT_PHASE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);
const CONNECT_PHASE_NAMES = new Set(['ConnectTimeoutError']);

/** mid-flight の可能性がある network エラー（冪等メソッドのみ再送）。 */
const MIDFLIGHT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET']);
const MIDFLIGHT_NAMES = new Set([
  'AuthRetryableFetchError',
  'FetchError',
  'TimeoutError', // AbortSignal.timeout 由来（応答待ちのハング）
]);

type ErrInfo = {
  name: string | null;
  message: string | null;
  causeName: string | null;
  causeCode: string | null;
};

function extractErrInfo(err: unknown): ErrInfo {
  const e =
    err && typeof err === 'object'
      ? (err as { name?: unknown; message?: unknown; cause?: unknown })
      : null;
  const cause =
    e?.cause && typeof e.cause === 'object'
      ? (e.cause as { name?: unknown; code?: unknown })
      : null;
  return {
    name: typeof e?.name === 'string' ? e.name : null,
    message: typeof e?.message === 'string' ? e.message : null,
    causeName: typeof cause?.name === 'string' ? cause.name : null,
    causeCode:
      typeof cause?.code === 'string'
        ? cause.code
        : typeof cause?.code === 'number'
          ? String(cause.code)
          : null,
  };
}

type RetryDecision = 'connect-phase' | 'midflight' | 'no';

function classifyError(info: ErrInfo): RetryDecision {
  const { name, message, causeName, causeCode } = info;
  const haystack = `${name ?? ''} ${message ?? ''} ${causeName ?? ''} ${causeCode ?? ''}`;

  const isConnectPhase =
    (name && CONNECT_PHASE_NAMES.has(name)) ||
    (causeName && CONNECT_PHASE_NAMES.has(causeName)) ||
    (causeCode && CONNECT_PHASE_CODES.has(causeCode)) ||
    /ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|ConnectTimeoutError/.test(
      haystack,
    );
  if (isConnectPhase) return 'connect-phase';

  const isMidflight =
    (name && MIDFLIGHT_NAMES.has(name)) ||
    (causeName && MIDFLIGHT_NAMES.has(causeName)) ||
    (causeCode && MIDFLIGHT_CODES.has(causeCode)) ||
    /ECONNRESET|ETIMEDOUT|EPIPE|fetch failed|AuthRetryableFetchError|TimeoutError|socket hang up/i.test(
      haystack,
    );
  if (isMidflight) return 'midflight';

  return 'no';
}

function isAbortedByCaller(err: unknown, callerSignal: AbortSignal | null): boolean {
  // caller が明示的に中断した場合は retry しない（cancel の意図を尊重）。
  if (!callerSignal) return false;
  if (!callerSignal.aborted) return false;
  const name = (err as { name?: unknown })?.name;
  return name === 'AbortError';
}

function resolveMethod(
  input: RequestInfo | URL,
  init?: RequestInit,
): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function resolveUrl(input: RequestInfo | URL): { host: string; pathname: string } {
  let raw: string;
  if (typeof input === 'string') raw = input;
  else if (input instanceof URL) raw = input.href;
  else if (input instanceof Request) raw = input.url;
  else raw = String(input);
  try {
    const u = new URL(raw);
    return { host: u.host, pathname: u.pathname };
  } catch {
    return { host: 'unknown', pathname: 'unknown' };
  }
}

function buildSignal(init: RequestInit | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const caller = init?.signal ?? null;
  if (caller) return AbortSignal.any([caller, timeout]);
  return timeout;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * server-side 用 retrying fetch。Supabase の global.fetch に注入する。
 * 署名は標準 fetch 互換。
 */
export const retryingFetch: typeof fetch = async (input, init) => {
  const method = resolveMethod(input, init);
  const isIdempotent = IDEMPOTENT_METHODS.has(method);
  const callerSignal = init?.signal ?? null;
  // Request を input にした場合、retry で body を再送できるよう毎回 clone する。
  const isRequest = input instanceof Request;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now();
    try {
      const signal = buildSignal(init);
      if (isRequest) {
        return await fetch((input as Request).clone(), { ...init, signal });
      }
      return await fetch(input, { ...init, signal });
    } catch (err) {
      const elapsed = Date.now() - started;

      // caller の明示 cancel は retry しない。
      if (isAbortedByCaller(err, callerSignal)) throw err;

      const info = extractErrInfo(err);
      const decision = classifyError(info);

      const canRetry =
        attempt < MAX_RETRIES &&
        (decision === 'connect-phase' ||
          (decision === 'midflight' && isIdempotent));

      if (!canRetry) throw err;

      const { host, pathname } = resolveUrl(input);
      attempt += 1;
      console.warn('[SupabaseRetry]', {
        attempt, // この値の retry を今から行う（1 = 1回目の retry）
        method,
        host,
        pathname,
        decision,
        elapsed_ms: elapsed,
        err_name: info.name,
        err_message: info.message,
        cause_code: info.causeCode,
      });

      await sleep(RETRY_DELAY_MS);
      // ループ先頭に戻り 1 回だけ再試行。
    }
  }
};
