import 'server-only';

/**
 * STEP-INTERVIEW-AI-REALTIME-PR3: リアルタイム音声面接の instructions / tool 定義。
 *
 * 役割:
 *   - token mint 時に OpenAI Realtime セッションへ渡す system instructions を組む。
 *   - 5 問アーク（主要質問 5 つ）を「面接として崩れない」形で守らせる。
 *   - 主要質問の進行はアプリが管理するため、AI には tool `mark_main_question_complete` を
 *     呼ばせる（1 つの主要質問の深掘りが一区切りした時点で questionNumber 付きで呼ぶ）。
 *
 * 設計方針:
 *   - 既存ターン制（questionGen / interviewTypes）の方針文言を再利用し、体験を揃える。
 *   - 音声会話特有の指示（遮らない / 雑談しない / 簡潔に / 1 問ずつ）を追加。
 *   - データに無い固有名詞は捏造させない（既存 QUESTION_QUALITY_RULES と同方針）。
 *   - 値の妥当性チェックは route 側で済んでいる前提（interviewType は 'free' 既定で正規化済み）。
 */

import {
  questionGuidanceFor,
  toneGuidanceFor,
  QUESTION_QUALITY_RULES,
  type InterviewType,
} from '@/lib/interviewAi/interviewTypes';
import { INTERVIEW_AI_MAX_ANSWER_TURNS } from '@/lib/interviewAi/limits';

// OpenAI Realtime の function tool。主要質問 1 つの深掘りが完了したら AI に呼ばせる。
// アプリ（client）はこの呼び出しを数えて 5 問の進行を管理する（STEP4+ で処理）。
export const MARK_QUESTION_COMPLETE_TOOL = {
  type: 'function' as const,
  name: 'mark_main_question_complete',
  description:
    '1つの主要質問について十分に深掘りできたら呼ぶ。アプリが主要質問の進行（全' +
    `${INTERVIEW_AI_MAX_ANSWER_TURNS}問）を管理する。雑談や軽い相槌では呼ばない。`,
  parameters: {
    type: 'object',
    properties: {
      questionNumber: {
        type: 'integer',
        description: `完了した主要質問の番号（1〜${INTERVIEW_AI_MAX_ANSWER_TURNS}）。`,
      },
    },
    required: ['questionNumber'],
  },
};

export const REALTIME_TOOLS = [MARK_QUESTION_COMPLETE_TOOL];

// targetRef（識別子部分）から面接対象の短い説明を組む。version / sourceContext は除く。
function describeTarget(targetRef: Record<string, unknown>): string {
  const entries = Object.entries(targetRef).filter(
    ([k, v]) =>
      k !== 'version' &&
      k !== 'sourceContext' &&
      (typeof v === 'string' || typeof v === 'number') &&
      String(v).trim() !== '',
  );
  if (entries.length === 0) return '';
  const parts = entries.map(([k, v]) => `${k}: ${String(v).trim()}`);
  return `\n\n【面接対象】${parts.join(' / ')}`;
}

export function buildRealtimeInstructions(args: {
  interviewType: InterviewType;
  targetRef: Record<string, unknown>;
  sourceContext: string;
}): string {
  const total = INTERVIEW_AI_MAX_ANSWER_TURNS;
  const target = describeTarget(args.targetRef);
  const source = args.sourceContext
    ? `\n\n【参考データ（受験生の記録の要約）】\n${args.sourceContext}\n（このデータに具体的な記述があれば触れてから問う。データに無い固有名詞・事実は捏造しない。）`
    : '';

  return [
    'あなたは日本の大学入試（総合型選抜）の面接官です。受験生と日本語の音声でリアルタイムに面接します。',
    toneGuidanceFor(args.interviewType),
    '',
    '【音声会話のふるまい（厳守）】',
    '・面接官として進行する。雑談はしない。',
    '・受験生が話している間は遮らない。相槌は「はい」「なるほど」程度の短いものに留める。',
    '・1 ターンに質問は 1 つだけ。簡潔に話す（長い前置きや説明をしない）。',
    '・聞き取れなかった時のみ、丁寧に聞き返してよい。',
    '',
    `【面接の構成（全${total}問の主要質問）】`,
    `・主要質問は全部で${total}問。総合型選抜の目安: 1=志望理由の核 / 2=自己分析・強み / 3=活動・経験の深掘り / 4=大学・学部との接続 / 5=将来像と学びの活用。`,
    '・各主要質問は、必要なら 1〜2 回だけ深掘りしてよい（抽象的な回答には具体例を求める）。',
    `・1 つの主要質問の深掘りが一区切りしたら、必ず tool 「mark_main_question_complete」を questionNumber 付きで呼ぶ（深掘りの追質問や相槌では呼ばない）。`,
    `・${total}問目を終えたら、アプリから締めの指示が来るまで新しい主要質問を始めない。締めの指示が来たら、短くお礼を述べて面接を締める。`,
    '・面接タイプの方針を最優先し、観点を調整してよい。既に十分聞いた観点は繰り返さない。',
    '',
    `【面接タイプの方針】${questionGuidanceFor(args.interviewType)}`,
    '',
    QUESTION_QUALITY_RULES,
    target,
    source,
    '',
    'まず簡単な挨拶のあと、1問目（志望理由の核心）から面接を始めてください。',
  ].join('\n');
}
