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

import type { InterviewType } from '@/lib/interviewAi/interviewTypes';

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

// ── 開発者用テキスト回答フォールバック ───────────────────────────────────
// 2026-06 方針: 一般ユーザーの AI 面接は「音声回答のみ」。テキスト回答 UI（音声/テキスト切替・
// テキスト入力欄・送信ボタンの自発表示）は一般ユーザーには出さない。
//   - 例外（マイク権限拒否 / Safari 不具合 / STT 障害）が「実際に起きたとき」だけ、client が
//     自動でテキスト入力へフォールバックする（この flag とは無関係に常時有効）。
//   - この flag は「開発・QA 用に、エラーが起きていなくても常時テキスト回答（切替含む）を
//     使えるようにする」ためのもの。sourceTypes と同じ三段構え（env / Preview query / 本番無効）。
//
// 有効化条件（どちらか）:
//   (a) env: NEXT_PUBLIC_INTERVIEW_TEXT_FALLBACK が "true"/"1"/"yes"。
//   (b) Preview query override（client のみ）: vercel.app の Preview URL で ?textMode=1。
// 本番 passai.jp / www.passai.jp では query override を**絶対に効かせない**（本番ユーザーに出さない）。

/** env flag による判定（server/client 共通 / build 時 inline）。 */
export function isInterviewTextFallbackEnabledByEnv(): boolean {
  const raw = process.env.NEXT_PUBLIC_INTERVIEW_TEXT_FALLBACK;
  if (typeof raw !== 'string') return false;
  return ENABLED_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Preview 用 query override 判定（client のみ）。
 *   - server（window なし）→ false。
 *   - passai.jp / www.passai.jp → query 有無に関わらず false（本番は絶対有効化しない）。
 *   - hostname に 'vercel.app' を含み、かつ ?textMode=1 → true。
 */
export function isInterviewTextFallbackEnabledByQuery(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (PRODUCTION_HOSTS.has(host)) return false; // 本番は query があっても無効
  if (!host.includes('vercel.app')) return false; // Preview(vercel.app) 限定
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('textMode') === '1';
  } catch {
    return false;
  }
}

/** 総合判定（client）。env true または Preview query override。 */
export function isInterviewTextFallbackEnabledClient(): boolean {
  return isInterviewTextFallbackEnabledByEnv() || isInterviewTextFallbackEnabledByQuery();
}

/**
 * 次質問の先読み（prefetch / 候補採用）の有効化判定（env のみ・default OFF）。
 *   - `NEXT_PUBLIC_INTERVIEW_AI_PREFETCH` が "true"/"1"/"yes" のときだけ true。
 *   - **未設定なら必ず false** ＝ 先読みを一切行わず、従来の /turn 生成フローと完全に同一挙動。
 *   - server/client 共通（build 時 inline）。client は prefetch 呼び出し前にこれで gate する。
 *   - 課金・保存・評価には無関係（速度最適化のみ）。本番投入前は Preview で ON にして検証する運用。
 */
export function isInterviewPrefetchEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_INTERVIEW_AI_PREFETCH;
  if (typeof raw !== 'string') return false;
  return ENABLED_VALUES.has(raw.trim().toLowerCase());
}

// モード別の prefetch 既定許可。
//   - free（本番）/ pressure（圧迫）: テンポ・緊張感が体験の核 → 先読み ON 推奨（true）。
//   - self_analysis / statement / essay: 回答に応じた深掘りの質が重要 → 先読み OFF（false）。
// 全体 flag（isInterviewPrefetchEnabled）が ON でも、ここで false のモードは先読みしない。
const PREFETCH_ALLOWED_BY_TYPE: Record<InterviewType, boolean> = {
  free: true,
  pressure: true,
  self_analysis: false,
  statement: false,
  essay: false,
};

/**
 * 指定モードで次質問の先読み（prefetch / 候補採用）を許可するか。
 *   - 大前提として全体 flag（NEXT_PUBLIC_INTERVIEW_AI_PREFETCH）が ON であること。
 *   - その上で PREFETCH_ALLOWED_BY_TYPE が true のモードのみ許可する。
 *   - 未知 / 未指定 type、flag OFF は false（＝先読みせず従来生成）。
 * client（呼び出し前ガード）と server（/prefetch 二重ガード）の双方から使う単一の判定。
 */
export function isPrefetchAllowedForInterviewType(
  interviewType: string | null | undefined,
): boolean {
  if (!isInterviewPrefetchEnabled()) return false;
  if (typeof interviewType !== 'string') return false;
  return PREFETCH_ALLOWED_BY_TYPE[interviewType as InterviewType] === true;
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
