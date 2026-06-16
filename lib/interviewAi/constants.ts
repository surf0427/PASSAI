import 'server-only';

/**
 * STEP-INTERVIEW-AI-PR6: Interview AI turn route の共有定数。
 *
 * route key の単一情報源（PR6 必須条件 §1）:
 *   recordUsage の route key は **必ず INTERVIEW_AI_USAGE_ROUTE='interview-ai'** に統一する。
 *   FEATURE_ROUTE_KEYS['interview-ai'] = ['interview-ai']（lib/billing/quotas.ts）と完全一致。
 *   interview_ai / interview-ai-turn / api/interview-ai / interview-ai/session 等に分散させない。
 */

// recordUsage 専用の route key。課金計上はこの 1 値のみを使う（PR6 必須条件 §1）。
export const INTERVIEW_AI_USAGE_ROUTE = 'interview-ai';

// logAiUsage（観測）専用の route 識別子。recordUsage の key とは別軸であり、
// 既存慣習どおり 'api/<name>' プレフィクスで descriptive に分ける（quota には一切影響しない）。
export const INTERVIEW_AI_SEED_LOG_ROUTE = 'api/interview-ai/turn:seed';
export const INTERVIEW_AI_FOLLOWUP_LOG_ROUTE = 'api/interview-ai/turn:followup';

// 内部 AI 生成（seed / followup）に使う model。
export const INTERVIEW_AI_MODEL = 'claude-sonnet-4-6';

// 1 質問あたりの出力上限。短い面接質問 1 つなので小さく抑える。
export const INTERVIEW_AI_MAX_TOKENS = 400;

// PR7: final feedback 生成（InterviewFeedback JSON）。perQuestionFeedback 配列を含むため
// 出力が大きい。model は MVP では seed/followup と同じ sonnet に揃える（コスト優先）。
export const INTERVIEW_AI_FEEDBACK_MODEL = INTERVIEW_AI_MODEL;
export const INTERVIEW_AI_FEEDBACK_MAX_TOKENS = 4000;
// logAiUsage（観測）用 route 識別子。recordUsage の key とは別軸（§1 とは無関係）。
export const INTERVIEW_AI_COMPLETE_LOG_ROUTE = 'api/interview-ai/complete';

// MVP のターン上限（PR6 必須条件 §7。3〜5）。role='answer' の件数でカウントする。
// 無限 followup を禁止するため、answer がこの件数に達したら followup を生成しない。
export const INTERVIEW_AI_MAX_ANSWER_TURNS = 5;

// 入力サイズガード（暴走 payload 防止）。
export const INTERVIEW_AI_MAX_ANSWER_CHARS = 8000;
export const INTERVIEW_AI_MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB
