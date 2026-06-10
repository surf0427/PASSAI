// /api/essay-deep-questions の役割（STEP-ESSAY-DEEPQ-AI-01 新規）:
//
// 小論文「改善」フローの深掘り質問を、ユーザーの本文・テーマ・改善対象・直前のAI
// フィードバックに紐付けて AI 生成する。従来は lib/essay/deepDiveQuestions.ts の
// axis 別固定テンプレ（AI 不使用）から取り出していたが、固定テンプレは本文文脈に
// 一切紐付かず抽象質問になる実機問題があったため、本 route で動的生成に切り替える。
//
// ai_policy 厳守:
//   本文ドラフト・完成文・段落例を返さない。深掘り = 考えを引き出す問いのみ。
//   制約は ESSAY_DEEP_QUESTIONS_SYSTEM_PROMPT 側に集約。
//
// cache（重要）:
//   質問は毎回ユーザー固有の本文・改善対象に依存するため、Next.js / fetch 層の
//   キャッシュを明示的に無効化する。client 側は AI 出力を ImprovementWork.deepQuestions
//   に snapshot 保存して resume 時に再利用する（再生成しない）。

import { anthropic, extractJson } from '@/lib/ai';
import { createTimeoutSignal } from '@/lib/aiTimeout';
import {
  ESSAY_DEEP_QUESTIONS_SYSTEM_PROMPT,
  buildEssayDeepQuestionsPrompt,
  type EssayDeepQuestionsPreviousFeedback,
} from '@/lib/prompts/essayDeepQuestionsPrompt';
import { logAiUsage } from '@/lib/aiUsageLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { checkMaxLengths } from '@/lib/validation/checkMaxLengths';
import { INPUT_MAX_LENGTHS } from '@/lib/validation/inputLimits';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { recordUsage } from '@/lib/billing/usageLog';
import type { BasicInfo } from '@/types/basicInfo';

const MODEL = 'claude-sonnet-4-6';
// M4: Vercel 実行時間上限。AI timeout（lib/aiTimeout.ts = 60s）+ 余裕。Pro 前提
// （Hobby は 60s 上限で AI timeout を吸収できない）。runtime は既定 nodejs（edge 不可）。
export const maxDuration = 80;
// 質問は毎回ユーザー固有の本文・改善対象に依存する。Next.js Route Handler 層 /
// fetch 層のキャッシュを明示無効化し、古い質問が hit 扱いで返るのを防ぐ。
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const ROUTE = 'api/essay-deep-questions';
const USAGE_ROUTE = 'essay-deep-questions';

type Body = {
  essayBody?: string;
  theme?: string;
  issueText?: string;
  axis?: string;
  mini?: { conclusion?: string; reasonOne?: string; reasonTwo?: string };
  previousFeedback?: EssayDeepQuestionsPreviousFeedback | null;
  basicInfo?: BasicInfo | null;
  // 同一 workspace の他改善点で生成済みの質問（重複回避・観点分散の参考）。
  existingQuestions?: string[];
};

export async function POST(req: Request) {
  const body = (await req.json()) as Body;

  const issueText = body.issueText?.trim() ?? '';
  if (issueText === '') {
    return Response.json(
      { error: '改善対象（issueText）が指定されていません' },
      { status: 400 },
    );
  }

  // prompt に埋め込む自由記述の最大長ガード（B2: AI 入力長の無制限を防ぐ）。
  const lengthCheck = checkMaxLengths([
    { label: '本文', value: body.essayBody, max: INPUT_MAX_LENGTHS.ESSAY },
    { label: 'テーマ', value: body.theme, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '改善対象', value: body.issueText, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '軸', value: body.axis, max: INPUT_MAX_LENGTHS.LABEL },
    { label: '結論', value: body.mini?.conclusion, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '理由1', value: body.mini?.reasonOne, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '理由2', value: body.mini?.reasonTwo, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '改善点', value: body.previousFeedback?.improvement, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '弱点', value: body.previousFeedback?.weakPoints, max: INPUT_MAX_LENGTHS.ANSWERS_TOTAL },
    { label: '評価点', value: body.previousFeedback?.goodPoints, max: INPUT_MAX_LENGTHS.ANSWERS_TOTAL },
    { label: '既出の質問', value: body.existingQuestions, max: INPUT_MAX_LENGTHS.ANSWERS_TOTAL },
  ]);
  if (!lengthCheck.ok) {
    return Response.json({ error: lengthCheck.message }, { status: 400 });
  }

  // STEP-GATE-COMPLETE: Plan Gate (essay feature)。validation 後 / AI 前。
  // essay-improve-summary と同じ 'essay' feature quota を消費する。
  const gate = await ensurePlanQuota('essay');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  const userMessage = buildEssayDeepQuestionsPrompt({
    essayBody: body.essayBody ?? '',
    theme: body.theme ?? '',
    issueText,
    axis: body.axis ?? '',
    mini: body.mini,
    previousFeedback: body.previousFeedback ?? null,
    basicInfo: body.basicInfo ?? null,
    existingQuestions: Array.isArray(body.existingQuestions)
      ? body.existingQuestions
      : [],
  });

  try {
    // SYSTEM_PROMPT は不変なので cache_control: 'ephemeral' で 5 分以内の連続生成を
    // input 単価割引にする（既存 essay-improve-summary / essay-review と同パターン）。
    // これは Anthropic 側の prompt cache であり、出力（質問）を返し回す cache ではない。
    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 700,
        // 0.5 → 0.7。観点分散プロンプトと併用し、収束（毎回似た質問）を緩和する。
        // これはモデル側のサンプリング温度であり、コードでの擬似乱数生成（Math.random 等）は使わない。
        temperature: 0.7,
        system: [
          {
            type: 'text',
            text: ESSAY_DEEP_QUESTIONS_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      },
      { signal: createTimeoutSignal() },
    );

    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';

    if (message.stop_reason === 'max_tokens') {
      console.error('essay-deep-questions truncated', {
        stopReason: message.stop_reason,
        rawTextTail: raw.slice(-200),
      });
      logAiUsage({
        route: ROUTE,
        model: MODEL,
        status: 'truncated',
        usage: message.usage,
        cache_creation_input_tokens: message.usage?.cache_creation_input_tokens,
        cache_read_input_tokens: message.usage?.cache_read_input_tokens,
      });
      await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
      return Response.json(
        {
          error: 'AI_DEEP_QUESTIONS_TRUNCATED',
          detail: 'AI response was truncated before completion',
        },
        { status: 502 },
      );
    }

    let questions: string[];
    try {
      const result = JSON.parse(extractJson(raw)) as { questions?: unknown };
      const arr = Array.isArray(result.questions) ? result.questions : [];
      questions = arr
        .filter((q): q is string => typeof q === 'string' && q.trim() !== '')
        .map((q) => q.trim());
      if (questions.length === 0) throw new Error('no questions');
    } catch {
      console.error('essay-deep-questions parse failed', {
        stopReason: message.stop_reason,
        rawLength: raw.length,
        rawTextHead: raw.slice(0, 200),
        rawTextTail: raw.slice(-200),
      });
      logAiUsage({
        route: ROUTE,
        model: MODEL,
        status: 'parse_failed',
        usage: message.usage,
        cache_creation_input_tokens: message.usage?.cache_creation_input_tokens,
        cache_read_input_tokens: message.usage?.cache_read_input_tokens,
      });
      await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
      captureRouteException(
        new Error('AI_DEEP_QUESTIONS_PARSE_FAILED'),
        { route: ROUTE, feature: 'ai', status: 502 },
        { status: 502, code: 'AI_DEEP_QUESTIONS_PARSE_FAILED' },
      );
      return Response.json(
        {
          error: 'AI_DEEP_QUESTIONS_PARSE_FAILED',
          detail: 'AI response could not be parsed as JSON',
        },
        { status: 502 },
      );
    }

    logAiUsage({
      route: ROUTE,
      model: MODEL,
      status: 'success',
      usage: message.usage,
      cache_creation_input_tokens: message.usage?.cache_creation_input_tokens,
      cache_read_input_tokens: message.usage?.cache_read_input_tokens,
    });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'ok' });
    return Response.json({ questions });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('essay-deep-questions API error:', msg);
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
    captureRouteException(
      error,
      { route: ROUTE, feature: 'ai', status: 500 },
      { status: 500, code: 'AI_REQUEST_FAILED' },
    );
    return Response.json(
      { error: '深掘り質問の生成に失敗しました', detail: msg },
      { status: 500 },
    );
  }
}
