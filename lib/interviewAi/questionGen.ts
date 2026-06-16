import 'server-only';

import { anthropic } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';
import {
  INTERVIEW_AI_FOLLOWUP_LOG_ROUTE,
  INTERVIEW_AI_MAX_TOKENS,
  INTERVIEW_AI_MODEL,
  INTERVIEW_AI_SEED_LOG_ROUTE,
} from './constants';
import {
  questionGuidanceFor,
  QUESTION_QUALITY_RULES,
  type InterviewType,
} from './interviewTypes';

/**
 * STEP-INTERVIEW-AI-PR6: 面接 AI の質問生成（seed / followup）。
 *
 * 重要（PR6 必須条件 §2）:
 *   seed question generation / followup question generation は **logAiUsage のみ**。
 *   recordUsage は **絶対に呼ばない**（内部 AI 処理は課金トリガではない）。
 *   本ファイルは lib/billing/usageLog（recordUsage）を import しない。
 *
 * 生成物は短い面接質問 1 文（plain text）。JSON ではない。
 */

export type PriorTurn = {
  role: 'question' | 'answer';
  content: string;
};

// 面接タイプごとの方針 + 共通品質ルールを織り込んだ system プロンプトを組む。
//   - 出力は常に「質問文 1 文のみ」。
//   - kind=seed は最初の質問、kind=followup は直前回答の深掘り。
function buildSystem(type: InterviewType, kind: 'seed' | 'followup'): string {
  const intro =
    kind === 'seed'
      ? 'あなたは大学入試（総合型選抜）の面接官です。受験生に最初の面接質問を1つだけ出してください。'
      : 'あなたは大学入試（総合型選抜）の面接官です。これまでのやり取りと受験生の直前の回答を踏まえ、深掘りする面接質問を1つだけ出してください。';
  return [
    intro,
    `【方針】${questionGuidanceFor(type)}`,
    QUESTION_QUALITY_RULES,
    '出力は質問文そのものだけ。前置き・解説・番号・記号・引用符は付けない。1文・日本語。',
  ].join('\n');
}

// source データ要約（target_ref.sourceContext）をプロンプトに載せる section。空なら何も足さない。
function sourceSection(sourceContext: string | undefined): string {
  const s = (sourceContext ?? '').trim();
  if (!s) return '';
  return `\n\n【受験生の関連データ】\n${s}\n（上記を踏まえて質問を作る。データに無い事実を捏造しない）`;
}

// target_ref（大学 / 学部 / 受験方式等）を短い文脈行に落とす。PII 本文は載せない（識別子相当のみ）。
function buildTargetContext(targetRef: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (label: string, key: string) => {
    const v = targetRef[key];
    if (typeof v === 'string' && v.trim()) parts.push(`${label}: ${v.trim()}`);
  };
  push('大学', 'universityName');
  push('大学', 'university');
  push('学部', 'faculty');
  push('学科', 'department');
  push('受験方式', 'examType');
  return parts.length > 0 ? `面接対象 — ${parts.join(' / ')}` : '面接対象 — 一般的な大学面接';
}

// 直近のやり取りを transcript 文脈に整形する。
function buildTranscript(turns: PriorTurn[]): string {
  return turns
    .map((t) => (t.role === 'question' ? `面接官: ${t.content}` : `受験生: ${t.content}`))
    .join('\n');
}

// anthropic response から text を取り出す。
function extractText(
  content: Array<{ type: string; text?: string }>,
): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim();
}

async function generateQuestion(args: {
  logRoute: string;
  system: string;
  userPrompt: string;
}): Promise<string> {
  let response;
  try {
    response = await anthropic.messages.create({
      model: INTERVIEW_AI_MODEL,
      max_tokens: INTERVIEW_AI_MAX_TOKENS,
      system: args.system,
      messages: [{ role: 'user', content: args.userPrompt }],
    });
  } catch {
    // messages.create が throw（network / API error）。usage 無し。
    logAiUsage({ route: args.logRoute, model: INTERVIEW_AI_MODEL, status: 'failed' });
    throw new Error('question-generation-failed');
  }

  if (response.stop_reason === 'max_tokens') {
    logAiUsage({
      route: args.logRoute,
      model: INTERVIEW_AI_MODEL,
      status: 'truncated',
      usage: response.usage,
    });
  } else {
    logAiUsage({
      route: args.logRoute,
      model: INTERVIEW_AI_MODEL,
      status: 'success',
      usage: response.usage,
    });
  }

  const text = extractText(response.content as Array<{ type: string; text?: string }>);
  if (!text) throw new Error('question-generation-empty');
  return text;
}

/**
 * 最初の質問（seed）を生成する。interview_type + sourceContext でタイプ別に方針を変える。
 * logAiUsage のみ。recordUsage は呼ばない。
 */
export async function generateSeedQuestion(args: {
  interviewType: InterviewType;
  targetRef: Record<string, unknown>;
  sourceContext?: string;
}): Promise<string> {
  const userPrompt =
    `${buildTargetContext(args.targetRef)}` +
    `${sourceSection(args.sourceContext)}\n\n` +
    `上記を踏まえ、最初の質問を1つ出してください。`;
  return generateQuestion({
    logRoute: INTERVIEW_AI_SEED_LOG_ROUTE,
    system: buildSystem(args.interviewType, 'seed'),
    userPrompt,
  });
}

/**
 * 直前の回答を深掘りする followup を生成する。interview_type + sourceContext でタイプ別に方針を変える。
 * logAiUsage のみ。recordUsage は呼ばない。
 */
export async function generateFollowupQuestion(args: {
  interviewType: InterviewType;
  targetRef: Record<string, unknown>;
  turns: PriorTurn[];
  sourceContext?: string;
}): Promise<string> {
  const userPrompt =
    `${buildTargetContext(args.targetRef)}` +
    `${sourceSection(args.sourceContext)}\n\n` +
    `これまでのやり取り:\n${buildTranscript(args.turns)}\n\n` +
    `受験生の直前の回答を踏まえ、深掘りする質問を1つ出してください。`;
  return generateQuestion({
    logRoute: INTERVIEW_AI_FOLLOWUP_LOG_ROUTE,
    system: buildSystem(args.interviewType, 'followup'),
    userPrompt,
  });
}
