// STEP-INTERVIEW-AI-TYPE: 機能別データ連動面接の feature flag。
//
// 有効化条件（どちらか）:
//   (a) env: NEXT_PUBLIC_ENABLE_INTERVIEW_SOURCE_TYPES が "true"/"1"/"yes"（trim+小文字化）。
//   (b) Preview query override（client のみ）: vercel.app の Preview URL で ?sourceTypes=1。
//
// 本番安全性（最優先）:
//   - 本番 passai.jp / www.passai.jp では **query override を絶対に効かせない**（query があっても無効）。
//   - env は本番で未設定のままにする運用。query override は vercel.app Preview 限定。
//
// 'server-only' は付けない（client / server 双方から参照）。env 判定は build 時 inline、
// query 判定は client 実行時（window）依存のため SSR では false を返す。

const ENABLED_VALUES: ReadonlySet<string> = new Set(['true', '1', 'yes']);

// 本番ホスト（ここでは query override を絶対に有効化しない）。
const PRODUCTION_HOSTS: ReadonlySet<string> = new Set(['passai.jp', 'www.passai.jp']);

/** env flag による判定（server/client 共通 / build 時 inline）。 */
export function isInterviewSourceTypesEnabledByEnv(): boolean {
  const raw = process.env.NEXT_PUBLIC_ENABLE_INTERVIEW_SOURCE_TYPES;
  if (typeof raw !== 'string') return false;
  return ENABLED_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Preview 用 query override 判定（client のみ）。
 *   - server（window なし）→ false。
 *   - passai.jp / www.passai.jp → query 有無に関わらず false（本番は絶対有効化しない）。
 *   - hostname に 'vercel.app' を含み、かつ ?sourceTypes=1 → true。
 */
export function isInterviewSourceTypesEnabledByQuery(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (PRODUCTION_HOSTS.has(host)) return false; // 本番は query があっても無効
  if (!host.includes('vercel.app')) return false; // Preview(vercel.app) 限定
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('sourceTypes') === '1';
  } catch {
    return false;
  }
}

/** 総合判定（client）。env true または Preview query override。 */
export function isInterviewSourceTypesEnabledClient(): boolean {
  return isInterviewSourceTypesEnabledByEnv() || isInterviewSourceTypesEnabledByQuery();
}

/**
 * env ベースの判定（後方互換）。SSR / 非 client コンポーネント（履歴 Card 等）はこれを使う。
 * query override は client 実行時のみのため、env のみで判定する。
 */
export function isInterviewSourceTypesEnabled(): boolean {
  return isInterviewSourceTypesEnabledByEnv();
}

/**
 * デバッグ表示（緑のデバッグボックス等）の可否（client 専用）。
 *   - 本番ホスト（passai.jp / www.passai.jp）では **常に false**（本番ユーザーにデバッグ情報を出さない）。
 *   - それ以外（localhost / vercel.app Preview）で sourceTypes 有効なときだけ true。
 * env で本番に sourceTypes を ON にしても、本番ホストではこの gate により非表示になる。
 */
export function isInterviewSourceTypesDebugVisible(): boolean {
  if (typeof window === 'undefined') return false; // SSR は出さない
  if (PRODUCTION_HOSTS.has(window.location.hostname)) return false; // 本番は絶対非表示
  return isInterviewSourceTypesEnabledClient();
}
