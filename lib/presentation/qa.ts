import 'server-only';

import { anthropic, extractJson } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';
import {
  PRESENTATION_EVAL_MODEL,
  PRESENTATION_QA_FINISH_LIST_MAX,
  PRESENTATION_QA_FINISH_LIST_MIN,
  PRESENTATION_QA_FINISH_LOG_ROUTE,
  PRESENTATION_QA_FINISH_MAX_TOKENS,
  PRESENTATION_QA_FOLLOWUP_LOG_ROUTE,
  PRESENTATION_QA_GENERATE_LOG_ROUTE,
  PRESENTATION_QA_KICKOFF_LOG_ROUTE,
  PRESENTATION_QA_QUESTION_MAX_TOKENS,
  PRESENTATION_QA_REVIEW_LOG_ROUTE,
} from './constants';
import {
  PRESENTATION_CATEGORY_KEYS,
  type PresentationCategoryKey,
} from './feedbackTypes';

/**
 * STEP-PRESENTATION-PR6: 発表後 Q&A（ターン制）の AI 生成。
 *
 * 面接AI lib/interviewAi/questionGen.ts の思想を流用:
 *   - kickoff = 最初の質問 / followup = 直前回答の深掘り（短い質問 1 文 plain text）。
 *   - **logAiUsage のみ**。recordUsage は **絶対に呼ばない**（lib/billing/usageLog を import しない）。
 *
 * 本体（プレゼン評価）ではなく「発表後の質疑応答練習」。質問は発表内容に即した具体的なものにする。
 */

export type QaTurn = {
  role: 'question' | 'answer';
  content: string;
};

export class QaGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QaGenerationError';
  }
}

export type QaContext = {
  transcript: string;
  theme: string;
  universityName: string;
  facultyName: string;
  categories: Record<string, unknown> | null;
  overallComment?: string;
};

const CATEGORY_LABELS: Record<PresentationCategoryKey, string> = {
  composition: '構成力',
  persuasion: '説得力',
  concreteness: '具体性',
  clarity: 'わかりやすさ',
  timeManagement: '時間配分',
  completeness: '完成度',
};

const QA_QUALITY_RULES = [
  '質問は発表の文字起こし内容に即した具体的な深掘りにする（一般的すぎる質問・テンプレ質問は禁止）。',
  '出力は質問文そのものだけ。前置き・解説・番号・記号・引用符は付けない。1文・日本語。',
].join('\n');

function buildEvalContext(ctx: QaContext): string {
  const parts: string[] = [];
  if (ctx.universityName.trim()) parts.push(`志望校: ${ctx.universityName.trim()}`);
  if (ctx.facultyName.trim()) parts.push(`学部学科: ${ctx.facultyName.trim()}`);
  if (ctx.theme.trim()) parts.push(`プレゼンテーマ: ${ctx.theme.trim()}`);

  if (ctx.categories && typeof ctx.categories === 'object') {
    const cats = ctx.categories as Record<string, unknown>;
    const catLine = PRESENTATION_CATEGORY_KEYS.map((k) => {
      const v = cats[k];
      return typeof v === 'string' ? `${CATEGORY_LABELS[k]}=${v}` : null;
    })
      .filter(Boolean)
      .join(', ');
    if (catLine) parts.push(`AI評価カテゴリ: ${catLine}`);
  }
  if (ctx.overallComment && ctx.overallComment.trim()) {
    parts.push(`AI講評: ${ctx.overallComment.trim()}`);
  }
  return parts.join('\n');
}

function buildQaTranscript(turns: QaTurn[]): string {
  return turns
    .map((t) => (t.role === 'question' ? `試験官: ${t.content}` : `受験生: ${t.content}`))
    .join('\n');
}

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim();
}

async function generateText(args: {
  logRoute: string;
  system: string;
  userPrompt: string;
  maxTokens: number;
}): Promise<{ text: string; truncated: boolean }> {
  let response;
  try {
    response = await anthropic.messages.create({
      model: PRESENTATION_EVAL_MODEL,
      max_tokens: args.maxTokens,
      system: args.system,
      messages: [{ role: 'user', content: args.userPrompt }],
    });
  } catch {
    logAiUsage({ route: args.logRoute, model: PRESENTATION_EVAL_MODEL, status: 'failed' });
    throw new QaGenerationError('qa-generation-failed');
  }

  const truncated = response.stop_reason === 'max_tokens';
  logAiUsage({
    route: args.logRoute,
    model: PRESENTATION_EVAL_MODEL,
    status: truncated ? 'truncated' : 'success',
    usage: response.usage,
  });

  const text = extractText(response.content as Array<{ type: string; text?: string }>);
  return { text, truncated };
}

/**
 * 最初の質問（kickoff）を生成する。logAiUsage のみ。
 */
export async function generateKickoffQuestion(ctx: QaContext): Promise<string> {
  const system = [
    'あなたは大学入試（総合型選抜・学校推薦型選抜）のプレゼン試験官です。',
    '受験生のプレゼン発表（文字起こし）を踏まえ、発表後の質疑応答として深掘りする質問を1つだけ出してください。',
    QA_QUALITY_RULES,
  ].join('\n');
  const userPrompt =
    `${buildEvalContext(ctx)}\n\n` +
    `発表の文字起こし:\n${ctx.transcript.trim()}\n\n` +
    `上記を踏まえ、最初の質問を1つ出してください。`;

  const { text } = await generateText({
    logRoute: PRESENTATION_QA_KICKOFF_LOG_ROUTE,
    system,
    userPrompt,
    maxTokens: PRESENTATION_QA_QUESTION_MAX_TOKENS,
  });
  if (!text) throw new QaGenerationError('qa-generation-empty');
  return text;
}

/**
 * 直前の回答を深掘りする followup を生成する。priorTurns には新しい回答まで含めて渡す。
 */
export async function generateFollowupQuestion(args: {
  ctx: QaContext;
  priorTurns: QaTurn[];
}): Promise<string> {
  const system = [
    'あなたは大学入試（総合型選抜・学校推薦型選抜）のプレゼン試験官です。',
    'これまでの質疑応答と受験生の直前の回答を踏まえ、さらに深掘りする質問を1つだけ出してください。',
    QA_QUALITY_RULES,
  ].join('\n');
  const userPrompt =
    `${buildEvalContext(args.ctx)}\n\n` +
    `発表の文字起こし:\n${args.ctx.transcript.trim()}\n\n` +
    `これまでの質疑応答:\n${buildQaTranscript(args.priorTurns)}\n\n` +
    `受験生の直前の回答を踏まえ、深掘りする質問を1つ出してください。`;

  const { text } = await generateText({
    logRoute: PRESENTATION_QA_FOLLOWUP_LOG_ROUTE,
    system,
    userPrompt,
    maxTokens: PRESENTATION_QA_QUESTION_MAX_TOKENS,
  });
  if (!text) throw new QaGenerationError('qa-generation-empty');
  return text;
}

export type QaFinishSummary = {
  goodPoints: string[];
  improvements: string[];
  nextPractice: string[];
  overallComment: string;
};

function cleanFinishList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= PRESENTATION_QA_FINISH_LIST_MAX) break;
  }
  return out;
}

/**
 * Q&A 終了時の簡単な総評（JSON）。配列は 1〜3 個。保存はしない（route が返すだけ）。
 */
export async function generateFinishSummary(args: {
  ctx: QaContext;
  priorTurns: QaTurn[];
}): Promise<QaFinishSummary> {
  const system = [
    'あなたは大学入試（総合型選抜・学校推薦型選抜）のプレゼン試験官です。',
    '発表後の質疑応答のやり取りをもとに、受験生への簡単な総評を日本語で作成してください。',
    '出力は次の JSON オブジェクト **のみ**（前後の説明文・コードフェンスなし）:',
    '{',
    `  "goodPoints": string[],     // 良かった点（${PRESENTATION_QA_FINISH_LIST_MIN}〜${PRESENTATION_QA_FINISH_LIST_MAX}個）`,
    `  "improvements": string[],   // 改善点（${PRESENTATION_QA_FINISH_LIST_MIN}〜${PRESENTATION_QA_FINISH_LIST_MAX}個）`,
    `  "nextPractice": string[],   // 次に練習すべきこと（${PRESENTATION_QA_FINISH_LIST_MIN}〜${PRESENTATION_QA_FINISH_LIST_MAX}個）`,
    '  "overallComment": string    // 総括（数文）',
    '}',
    '実際の質疑応答の内容に即した具体的な指摘にする（一般論・テンプレ文の羅列は禁止）。空配列・空文字は禁止。',
  ].join('\n');
  const userPrompt =
    `${buildEvalContext(args.ctx)}\n\n` +
    `発表後の質疑応答:\n${buildQaTranscript(args.priorTurns)}\n\n` +
    `上記をもとに総評 JSON を出力してください。`;

  const { text, truncated } = await generateText({
    logRoute: PRESENTATION_QA_FINISH_LOG_ROUTE,
    system,
    userPrompt,
    maxTokens: PRESENTATION_QA_FINISH_MAX_TOKENS,
  });
  if (truncated) throw new QaGenerationError('qa-finish-truncated');

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new QaGenerationError('qa-finish-parse-failed');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new QaGenerationError('qa-finish-parse-failed');
  }
  const obj = parsed as Record<string, unknown>;
  const goodPoints = cleanFinishList(obj.goodPoints);
  const improvements = cleanFinishList(obj.improvements);
  const nextPractice = cleanFinishList(obj.nextPractice);
  const overallComment =
    typeof obj.overallComment === 'string' ? obj.overallComment.trim() : '';
  if (
    goodPoints.length < PRESENTATION_QA_FINISH_LIST_MIN ||
    improvements.length < PRESENTATION_QA_FINISH_LIST_MIN ||
    nextPractice.length < PRESENTATION_QA_FINISH_LIST_MIN ||
    !overallComment
  ) {
    throw new QaGenerationError('qa-finish-quality-failed');
  }
  return { goodPoints, improvements, nextPractice, overallComment };
}

// ── stateless（DB 保存なし）の単発 Q&A 練習（result 画面）─────────────────
// kickoff/answer/finish（DB 保存・ターン制）とは別系統。質問を1つ生成し、回答に対して
// その場でフィードバックを返すだけで、turns には保存しない・課金もしない。

/**
 * 発表後に面接官・教授が聞きそうな質問を1つ生成する（DB 保存なし）。
 * askedQuestions（画面内で既出の質問）と重複しない観点を促す。
 */
export async function generateStandaloneQuestion(args: {
  ctx: QaContext;
  askedQuestions: string[];
}): Promise<string> {
  const askedSection = args.askedQuestions.length
    ? `既に出した質問（重複しないこと）:\n${args.askedQuestions
        .map((q, i) => `${i + 1}. ${q}`)
        .join('\n')}\n\n`
    : '';
  const system = [
    'あなたは大学入試（総合型選抜・学校推薦型選抜）の面接官・教授です。',
    '受験生のプレゼン発表後に、面接官や教授が実際に聞きそうな質問を1つだけ出してください。',
    QA_QUALITY_RULES,
  ].join('\n');
  const userPrompt =
    `${buildEvalContext(args.ctx)}\n\n` +
    `発表の文字起こし:\n${args.ctx.transcript.trim()}\n\n` +
    askedSection +
    `上記を踏まえ、発表後に聞かれやすい質問を1つ出してください。`;

  const { text } = await generateText({
    logRoute: PRESENTATION_QA_GENERATE_LOG_ROUTE,
    system,
    userPrompt,
    maxTokens: PRESENTATION_QA_QUESTION_MAX_TOKENS,
  });
  if (!text) throw new QaGenerationError('qa-generation-empty');
  return text;
}

export type QaAnswerReview = {
  goodPoints: string[];
  improvements: string[];
  modelAnswerDirection: string;
};

/**
 * 1つの質問への回答に対する短いフィードバック（良かった点 / 改善点 / 模範回答の方向性）を返す。
 * DB 保存なし。配列は 1〜3 個・空禁止。
 */
export async function reviewAnswer(args: {
  ctx: QaContext;
  question: string;
  answer: string;
}): Promise<QaAnswerReview> {
  const system = [
    'あなたは大学入試（総合型選抜・学校推薦型選抜）の面接官・教授です。',
    '受験生の回答に対する短いフィードバックを日本語で作成してください。',
    '出力は次の JSON オブジェクト **のみ**（前後の説明文・コードフェンスなし）:',
    '{',
    `  "goodPoints": string[],          // 良かった点（${PRESENTATION_QA_FINISH_LIST_MIN}〜${PRESENTATION_QA_FINISH_LIST_MAX}個）`,
    `  "improvements": string[],        // 改善点（${PRESENTATION_QA_FINISH_LIST_MIN}〜${PRESENTATION_QA_FINISH_LIST_MAX}個）`,
    '  "modelAnswerDirection": string   // 模範回答の方向性（数文。回答全文ではなく方向性を示す）',
    '}',
    '実際の質問と回答に即した具体的な指摘にする（一般論・テンプレ文は禁止）。空配列・空文字は禁止。',
  ].join('\n');
  const userPrompt =
    `${buildEvalContext(args.ctx)}\n\n` +
    `質問:\n${args.question.trim()}\n\n` +
    `受験生の回答:\n${args.answer.trim()}\n\n` +
    `上記の回答へのフィードバック JSON を出力してください。`;

  const { text, truncated } = await generateText({
    logRoute: PRESENTATION_QA_REVIEW_LOG_ROUTE,
    system,
    userPrompt,
    maxTokens: PRESENTATION_QA_FINISH_MAX_TOKENS,
  });
  if (truncated) throw new QaGenerationError('qa-review-truncated');

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new QaGenerationError('qa-review-parse-failed');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new QaGenerationError('qa-review-parse-failed');
  }
  const obj = parsed as Record<string, unknown>;
  const goodPoints = cleanFinishList(obj.goodPoints);
  const improvements = cleanFinishList(obj.improvements);
  const modelAnswerDirection =
    typeof obj.modelAnswerDirection === 'string'
      ? obj.modelAnswerDirection.trim()
      : '';
  if (
    goodPoints.length < PRESENTATION_QA_FINISH_LIST_MIN ||
    improvements.length < PRESENTATION_QA_FINISH_LIST_MIN ||
    !modelAnswerDirection
  ) {
    throw new QaGenerationError('qa-review-quality-failed');
  }
  return { goodPoints, improvements, modelAnswerDirection };
}
