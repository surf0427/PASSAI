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
// 次質問の先読み（speculative 生成）専用の観測 route 識別子。recordUsage には一切影響しない
// （logAiUsage のみ。先読みは保存も課金もしないため、本物の followup と観測軸を分けて計測する）。
export const INTERVIEW_AI_PREFETCH_LOG_ROUTE = 'api/interview-ai/prefetch';

// 内部 AI 生成（seed / followup / speculative）の既定 model。
// ※ INTERVIEW_AI_FEEDBACK_MODEL のエイリアス元でもある（評価モデルと結合）。ここは触らない方針。
export const INTERVIEW_AI_MODEL = 'claude-sonnet-4-6';

// followup（reaction + 次質問）専用の生成 model。
//   - **未設定なら INTERVIEW_AI_MODEL（= Sonnet）にフォールバック** ＝ 既定挙動は本番と完全同一。
//   - `INTERVIEW_AI_FOLLOWUP_MODEL=claude-haiku-4-5-20251001` を入れた時だけ followup が高速モデルになる
//     （回答後〜次質問までの待機短縮。Preview で品質確認してから本番投入する運用）。
//   - 影響範囲は generateFollowupQuestion のみ。seed / speculative / finalFeedback は INTERVIEW_AI_MODEL のまま。
//   - 課金には無関係（recordUsage の model は billing.ts が INTERVIEW_AI_MODEL を記録。route キー計上は不変）。
export const INTERVIEW_AI_FOLLOWUP_MODEL =
  process.env.INTERVIEW_AI_FOLLOWUP_MODEL || INTERVIEW_AI_MODEL;

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
// 値の単一情報源は lib/interviewAi/limits.ts（client UI からも参照するため切り出し）。
export { INTERVIEW_AI_MAX_ANSWER_TURNS } from './limits';

// 入力サイズガード（暴走 payload 防止）。
export const INTERVIEW_AI_MAX_ANSWER_CHARS = 8000;
export const INTERVIEW_AI_MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB

// TTS（AI 質問読み上げ）入力ガード。面接質問 1 つ分なので短く抑える。
// 質問生成の出力上限（INTERVIEW_AI_MAX_TOKENS=400）から見て十分余裕のある上限。
export const INTERVIEW_AI_MAX_TTS_CHARS = 2000;
