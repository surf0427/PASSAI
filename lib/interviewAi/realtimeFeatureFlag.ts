// STEP-INTERVIEW-AI-REALTIME-PR1: リアルタイム音声面接の feature flag。
//
// 2 軸に分離する（混同しないこと）:
//   - client 表示 flag（本ファイル）: 新モードの導線/画面を「見せるか」。
//   - server 最終ゲート（token route の REALTIME_INTERVIEW_ENABLED）: client_secret を
//     「発行してよいか」。コストが発生する最終判断は必ず server 側。client flag だけでは
//     何も発行されない。
//
// client 表示の有効化条件（どちらか）:
//   (a) env: NEXT_PUBLIC_ENABLE_REALTIME_INTERVIEW が "true"/"1"/"yes"（trim+小文字化）。
//   (b) Preview query override（client のみ）: vercel.app の Preview URL で ?realtime=1。
//
// 本番安全性（最優先）:
//   - 本番 passai.jp / www.passai.jp では **query override を絶対に効かせない**。
//   - env は本番で未設定運用。query override は vercel.app Preview 限定。
//
// 既存 featureFlag.ts（sourceTypes 用）と同じ作法を踏襲した別ファイル。既存は改変しない。
// 'server-only' は付けない（client / server 双方から参照）。

const ENABLED_VALUES: ReadonlySet<string> = new Set(['true', '1', 'yes']);

// 本番ホスト（ここでは query override を絶対に有効化しない）。
const PRODUCTION_HOSTS: ReadonlySet<string> = new Set(['passai.jp', 'www.passai.jp']);

/** env flag による判定（server/client 共通 / build 時 inline）。 */
export function isRealtimeInterviewEnabledByEnv(): boolean {
  const raw = process.env.NEXT_PUBLIC_ENABLE_REALTIME_INTERVIEW;
  if (typeof raw !== 'string') return false;
  return ENABLED_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Preview 用 query override 判定（client のみ）。
 *   - server（window なし）→ false。
 *   - passai.jp / www.passai.jp → query 有無に関わらず false（本番は絶対有効化しない）。
 *   - hostname に 'vercel.app' を含み、かつ ?realtime=1 → true。
 */
export function isRealtimeInterviewEnabledByQuery(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (PRODUCTION_HOSTS.has(host)) return false; // 本番は query があっても無効
  if (!host.includes('vercel.app')) return false; // Preview(vercel.app) 限定
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('realtime') === '1';
  } catch {
    return false;
  }
}

/** 総合判定（client）。env true または Preview query override。表示のみ。発行は server flag が最終。 */
export function isRealtimeInterviewEnabledClient(): boolean {
  return isRealtimeInterviewEnabledByEnv() || isRealtimeInterviewEnabledByQuery();
}

/**
 * env ベースの判定（SSR / 非 client コンポーネント用）。
 * query override は client 実行時のみのため、env のみで判定する。
 */
export function isRealtimeInterviewEnabled(): boolean {
  return isRealtimeInterviewEnabledByEnv();
}
