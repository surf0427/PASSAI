import 'server-only';

/**
 * STEP-INTERVIEW-AI-REALTIME-PR1: リアルタイム音声面接（WebRTC）の共有定数。
 *
 * 設計は docs/interview_ai/realtime/pr1_token.md を参照。
 */

// recordUsage 専用の route key（課金計上）。FEATURE_ROUTE_KEYS['interview-ai-realtime'] と一致させる。
// ターン制の 'interview-ai' とは別 route key にして枠・原価を分離する（計上は STEP7）。
export const INTERVIEW_AI_REALTIME_USAGE_ROUTE = 'interview-ai-realtime';

// logAiUsage（観測）用 route 識別子。recordUsage の key とは別軸（quota に影響しない）。
export const INTERVIEW_AI_REALTIME_TOKEN_LOG_ROUTE = 'api/interview-ai/realtime/token';

// realtime モデル / 音声の既定値（env で上書き可）。既定は mini（コスト優先）。
export const DEFAULT_REALTIME_MODEL = 'gpt-realtime-mini';
export const DEFAULT_REALTIME_VOICE = 'alloy';

// 1 セッションの最大長（12 分）。OpenAI の TTL/最大長（60 分）では止められないため自前強制する。
// クライアントのタイマ / turn 保存締切（STEP5）/ OpenAI 60 分 backstop の多層で守る。
export const REALTIME_MAX_DURATION_MS = 12 * 60 * 1000;

// client_secret の TTL（秒）。接続開始の猶予のみ（接続中セッションは止めない）。範囲 10–7200。
export const REALTIME_TOKEN_TTL_SECONDS = 120;

// OpenAI Realtime のエンドポイント（2026-06 公式仕様で確認）。
export const OPENAI_CLIENT_SECRETS_URL =
  'https://api.openai.com/v1/realtime/client_secrets';
// ブラウザが SDP offer を POST する先（client へ返して使わせる）。
export const OPENAI_REALTIME_CALLS_URL =
  'https://api.openai.com/v1/realtime/calls';
