import 'server-only';

import { anthropic } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';
import {
  INTERVIEW_AI_FOLLOWUP_LOG_ROUTE,
  INTERVIEW_AI_MAX_ANSWER_TURNS,
  INTERVIEW_AI_MAX_TOKENS,
  INTERVIEW_AI_MODEL,
  INTERVIEW_AI_SEED_LOG_ROUTE,
} from './constants';
import {
  questionGuidanceFor,
  QUESTION_QUALITY_RULES,
  toneGuidanceFor,
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
    toneGuidanceFor(type),
    QUESTION_QUALITY_RULES,
    '【文体】受験面接として自然な口語の日本語。質問は原則1文、長くても2文まで。' +
      '採点者目線の説明・長い前置き・箇条書き・番号・記号・引用符は付けない。' +
      '1つの発話に質問を2つ以上混ぜない。出力は質問文そのものだけ。',
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

// 5問の観点設計（総合型選抜の目安 / req ③）。観点（論点・切り口）の重複を避け、深さを段階的に上げる。
// 順番は絶対固定ではなく、面接タイプの方針・受験生のデータ・直前回答に合わせて調整してよい。
const QUESTION_ARC: readonly string[] = [
  '志望理由の核心。なぜその分野・学問なのか、関心の源にある具体的な経験まで掘り下げる。',
  '自己分析・強み。強みや価値観を抽象論で終わらせず、具体的な場面・行動で語らせる。',
  '活動実績・経験の深掘り。取り組んだ活動の中での判断・困難・工夫など一段深い部分を問う。',
  '大学・学部との接続。その大学・学部だからこそ学べること / 志望との結びつきを確認する。',
  '将来像と学びの活用。学んだことを将来どう活かすか、面接の総仕上げとして問う。',
];

// PriorTurn[] の answer 件数 = 回答済みの質問数。次に作る質問の番号 = これ + 1。
function countAnswers(turns: PriorTurn[]): number {
  return turns.filter((t) => t.role === 'answer').length;
}

// 今回の質問（questionNumber: 1-based / total: 全問数）の観点ガイドを組む（req ③④）。
function buildArcGuidance(questionNumber: number, total: number): string {
  const idx = Math.min(Math.max(questionNumber, 1), QUESTION_ARC.length) - 1;
  return [
    `【全${total}問の設計】各質問は観点（論点・切り口）を変え、重複させない。問が進むほど深さを上げる。`,
    '総合型選抜の目安: 1=志望理由の核 / 2=自己分析・強み / 3=活動・経験の深掘り / 4=大学・学部との接続 / 5=将来像と学びの活用。',
    `【今回（${questionNumber}問目 / 全${total}問）の主眼】${QUESTION_ARC[idx]}`,
    '面接タイプの方針を最優先し、それに沿って観点を調整してよい。既に十分聞いた観点は繰り返さない。',
  ].join('\n');
}

// 同一セッションで既に出した質問一覧（重複回避用 / req ⑤）。直近のやり取りに加えて明示提示する。
function askedQuestionsSection(turns: PriorTurn[]): string {
  const asked = turns
    .filter((t) => t.role === 'question')
    .map((t) => t.content.trim())
    .filter(Boolean);
  if (asked.length === 0) return '';
  const list = asked.map((q, i) => `${i + 1}. ${q}`).join('\n');
  return `\n\n【既に聞いた質問（論点も聞き方も繰り返さない）】\n${list}`;
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
    `${buildArcGuidance(1, INTERVIEW_AI_MAX_ANSWER_TURNS)}\n\n` +
    `上記を踏まえ、1問目の質問を1つ出してください。`;
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
  const total = INTERVIEW_AI_MAX_ANSWER_TURNS;
  // 次に作る質問の番号 = これまでの回答数 + 1（上限でクランプ）。観点設計（arc）に使う。
  const questionNumber = Math.min(countAnswers(args.turns) + 1, total);
  const userPrompt =
    `${buildTargetContext(args.targetRef)}` +
    `${sourceSection(args.sourceContext)}\n\n` +
    `これまでのやり取り:\n${buildTranscript(args.turns)}` +
    `${askedQuestionsSection(args.turns)}\n\n` +
    `${buildArcGuidance(questionNumber, total)}\n\n` +
    `受験生の直前の回答を自然に踏まえつつ、${questionNumber}問目の質問を1つ出してください` +
    `（毎回深掘りに寄せすぎず、上記の主眼に沿って観点を進める）。`;
  return generateQuestion({
    logRoute: INTERVIEW_AI_FOLLOWUP_LOG_ROUTE,
    system: buildSystem(args.interviewType, 'followup'),
    userPrompt,
  });
}
