// /api/essay-themes の役割（小論文テーマ追加生成）:
//
// 志望校・学部・アドミッションポリシー文脈をもとに、既出テーマと重複しない新しい
// 小論文の練習テーマ（お題）を追加生成する。決定論テンプレ（lib/essayThemes.ts）の
// 3〜9 件固定循環を脱し、「別のテーマを見る」連打で実質無限に練習できる状態を作る。
//
// ai_policy 厳守:
//   生成するのは「お題（設問文）」のみ。本文・模範解答・段落例を返さない。
//   制約は ESSAY_THEMES_SYSTEM_PROMPT 側に集約。
//
// データ境界:
//   data/ は直 import しない。志望校文脈は lib/essayThemes.getEssayThemeAiContext()
//   （内部で lib/universities 経由）から取得する。
//
// cache:
//   毎回「既出と違う新テーマ」を返すのが目的なので、入力 hash cache は使わない。
//   Next.js / fetch 層のキャッシュも明示無効化する。

import { anthropic, extractJson } from '@/lib/ai';
import { createTimeoutSignal } from '@/lib/aiTimeout';
import { getEssayThemeAiContext } from '@/lib/essayThemes';
import {
  ESSAY_THEMES_SYSTEM_PROMPT,
  buildEssayThemesPrompt,
} from '@/lib/prompts/essayThemesPrompt';
import { parseEssayThemes } from '@/lib/essay/parseEssayThemes';
import { logAiUsage } from '@/lib/aiUsageLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { checkMaxLengths } from '@/lib/validation/checkMaxLengths';
import { INPUT_MAX_LENGTHS } from '@/lib/validation/inputLimits';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { recordUsage } from '@/lib/billing/usageLog';
import type { BasicInfo } from '@/types/basicInfo';

const MODEL = 'claude-sonnet-4-6';
// M4: Vercel 実行時間上限。AI timeout（lib/aiTimeout.ts = 60s）+ 余裕。Pro 前提。
export const maxDuration = 80;
// テーマは毎回「既出と違うもの」を返すのが目的。古い生成結果が hit 扱いで返るのを防ぐ。
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const ROUTE = 'api/essay-themes';
const USAGE_ROUTE = 'essay-themes';

type Body = {
  university?: string;
  faculty?: string;
  department?: string;
  examType?: string;
  alreadyShownThemes?: string[];
  usedCategories?: string[];
  basicInfo?: BasicInfo | null;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json(
      { error: 'リクエスト内容を読み取れませんでした。' },
      { status: 400 },
    );
  }

  const alreadyShownThemes = Array.isArray(body.alreadyShownThemes)
    ? body.alreadyShownThemes.filter((t): t is string => typeof t === 'string')
    : [];
  const usedCategories = Array.isArray(body.usedCategories)
    ? body.usedCategories.filter((c): c is string => typeof c === 'string')
    : [];

  // prompt に埋め込む自由記述の最大長ガード（AI 入力長の無制限を防ぐ）。
  const lengthCheck = checkMaxLengths([
    { label: '大学名', value: body.university, max: INPUT_MAX_LENGTHS.LABEL },
    { label: '学部', value: body.faculty, max: INPUT_MAX_LENGTHS.LABEL },
    { label: '学科', value: body.department, max: INPUT_MAX_LENGTHS.LABEL },
    { label: '入試方式', value: body.examType, max: INPUT_MAX_LENGTHS.LABEL },
    { label: '既出テーマ', value: alreadyShownThemes, max: INPUT_MAX_LENGTHS.ANSWERS_TOTAL },
  ]);
  if (!lengthCheck.ok) {
    return Response.json({ error: lengthCheck.message }, { status: 400 });
  }

  // STEP-GATE-COMPLETE: Plan Gate (essay feature)。validation 後 / AI 前。
  // 既存 essay-review / essay-deep-questions と同じ 'essay' quota を消費する。
  const gate = await ensurePlanQuota('essay');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  // 志望校文脈（admission_policy / バイアス順 / reason / sourceType）を取得。
  // data/ 境界は essayThemes 内に閉じている。
  const ctx = getEssayThemeAiContext({
    university: body.university ?? '',
    faculty: body.faculty ?? '',
    department: body.department ?? '',
    examType: body.examType ?? '',
  });

  const userMessage = buildEssayThemesPrompt({
    label: ctx.label,
    hasPolicy: ctx.hasPolicy,
    policies: ctx.policies,
    biasOrder: ctx.biasOrder,
    experiencePhrase: ctx.experiencePhrase,
    alreadyShownThemes,
    usedCategories,
    basicInfo: body.basicInfo ?? null,
  });

  try {
    // SYSTEM_PROMPT は不変なので cache_control: 'ephemeral' で連続生成を input 単価割引に。
    // temperature は高め: 「同じ志望校でも毎回違う切り口」を引き出すため（既存
    // essay-deep-questions の 0.7 と同等以上の発散を狙う）。コードでの乱数生成はしない。
    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 900,
        temperature: 0.8,
        system: [
          {
            type: 'text',
            text: ESSAY_THEMES_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      },
      { signal: createTimeoutSignal() },
    );

    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';

    if (message.stop_reason === 'max_tokens') {
      console.error('essay-themes truncated', {
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
          error: 'AI_THEMES_TRUNCATED',
          detail: 'AI response was truncated before completion',
        },
        { status: 502 },
      );
    }

    let themes;
    try {
      const parsed: unknown = JSON.parse(extractJson(raw));
      themes = parseEssayThemes(parsed, {
        sourceType: ctx.sourceType,
        reason: ctx.reason,
      });
      if (themes.length === 0) throw new Error('no themes');
    } catch {
      console.error('essay-themes parse failed', {
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
        new Error('AI_THEMES_PARSE_FAILED'),
        { route: ROUTE, feature: 'ai', status: 502 },
        { status: 502, code: 'AI_THEMES_PARSE_FAILED' },
      );
      return Response.json(
        {
          error: 'AI_THEMES_PARSE_FAILED',
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
    return Response.json({ themes });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('essay-themes API error:', msg);
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
    captureRouteException(
      error,
      { route: ROUTE, feature: 'ai', status: 500 },
      { status: 500, code: 'AI_REQUEST_FAILED' },
    );
    return Response.json(
      { error: 'テーマの生成に失敗しました', detail: msg },
      { status: 500 },
    );
  }
}
