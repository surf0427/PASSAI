import 'server-only';

/**
 * STEP-AUTH-CONNECTIVITY-01 / Phase 0: auth.getUser() 失敗の原因切り分けログ。
 *
 * 目的:
 *   ConnectTimeoutError 等の「Supabase (*.supabase.co) への接続障害」と、
 *   本物の「未認証 (セッション無し)」を区別できるようにする。現状は両者とも
 *   一律 401 unauthenticated に化けて判別不能だった。
 *
 * 制約 (Phase 0):
 *   - 戻り値 / HTTP ステータス / 既存挙動は一切変えない。console.error を足すだけ。
 *
 * supabase-js は getUser() の fetch 失敗を throw せず error として返す
 * (AuthRetryableFetchError 等)。元の ConnectTimeoutError は err.cause に
 * 残らないこともあるため、err.name / message / cause を総当たりで分類する。
 */
export function logAuthFail(params: {
  route: string;
  feature?: string | null;
  phase: string;
  /** supabase.auth.getUser() の error (= AuthError | null)。null なら純粋な未認証。 */
  err: unknown;
  /** userData.user が取得できたか (false かつ err=null なら session 無し)。 */
  hasUser: boolean;
  elapsedMs: number;
}): void {
  const { route, feature = null, phase, err, hasUser, elapsedMs } = params;

  const e =
    err && typeof err === 'object'
      ? (err as { name?: unknown; message?: unknown; cause?: unknown })
      : null;
  const cause =
    e?.cause && typeof e.cause === 'object'
      ? (e.cause as { name?: unknown; code?: unknown; message?: unknown })
      : null;

  const errName = typeof e?.name === 'string' ? e.name : null;
  const errMessage = typeof e?.message === 'string' ? e.message : null;
  const causeName = typeof cause?.name === 'string' ? cause.name : null;
  const causeCode =
    typeof cause?.code === 'string' || typeof cause?.code === 'number'
      ? cause.code
      : null;
  const causeMessage =
    typeof cause?.message === 'string' ? cause.message : null;

  const haystack = `${errName ?? ''} ${errMessage ?? ''} ${causeName ?? ''} ${String(causeCode ?? '')} ${causeMessage ?? ''}`;
  const likelyNetwork =
    /ConnectTimeoutError|AuthRetryableFetchError|FetchError|fetch failed|UND_ERR|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|timeout/i.test(
      haystack,
    );

  // 分類: err 無し = 純粋な未認証 / network = 接続障害 / auth-error = それ以外の認証エラー
  const classification = !e
    ? 'unauthenticated'
    : likelyNetwork
      ? 'network'
      : 'auth-error';

  console.error('[AuthFail]', {
    route,
    feature,
    phase,
    classification,
    has_user: hasUser,
    err_name: errName,
    err_message: errMessage,
    cause_name: causeName,
    cause_code: causeCode,
    cause_message: causeMessage,
    elapsed_ms: elapsedMs,
  });
}
