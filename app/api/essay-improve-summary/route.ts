// 改善ワークの「方針整理」を AI に依頼する route（essay STEP F 新規、UX 修正で multi-issue 化）。
//
// 役割:
//   生徒が複数の改善点（works）に対する深掘り回答を、AI が「改善方針」として統合整理する。
//   本文ドラフトを書かない。完成文・段落例・「こう書きましょう」を一切返さない。
//
// 入力（v2 契約: multi-issue）:
//   - works[]             : 各改善点の Q&A 集合
//     - issueText         : 取り組む改善点の文言
//     - axis              : 推定された軸
//     - deepQuestions     : 質問 snapshot
//     - answers           : 生徒の回答
//   - currentEssayBody    : 書き直し対象の本文
//   - theme               : テーマ（文脈）
//   - mini                : ミニ思考欄（結論 / 理由 1 / 理由 2）
//   - basicInfo           : 志望校・学部（文脈）
//
// 出力（ImprovementSummary）:
//   - summary             : 改善方針の全体像（1〜2 文）
//   - focusPoints         : 強化すべきポイント（最大 3 件、箇条書き）
//   - suggestedDirections : 書き直し方向性（最大 3 件、本文例ではない）
//
// 不変条件:
//   - 本文段落・完成文・例文を出さない（ai_policy 厳守）
//   - PROMPT_VERSION bump は lib/aiInputHash.ts の ESSAY_IMPROVE_SUMMARY_PROMPT_VERSION で集約
//   - sonnet-4-6 を使用（essay-review と同モデルで一貫性確保）
//
// cache:
//   client 側で essayImproveSummaryInputHash cache を使って AI call を dedupe する。
//   route 自体には cache を入れない（既存 essay-review / interview-questions と同方針）。

import { anthropic, extractJson } from '@/lib/ai';
import { createTimeoutSignal } from '@/lib/aiTimeout';
import { safeParseImproveSummary } from '@/lib/essay/parseImproveSummary';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { logAiUsage } from '@/lib/aiUsageLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { checkMaxLengths } from '@/lib/validation/checkMaxLengths';
import { INPUT_MAX_LENGTHS } from '@/lib/validation/inputLimits';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { recordUsage } from '@/lib/billing/usageLog';
// STEP-LIB-06: SYSTEM_PROMPT を lib/prompts/essayImproveSummaryPrompt.ts に lift した。
// 本 route はそれを import して anthropic.messages.create の system に渡すだけ。
// 文言を変える場合は ESSAY_IMPROVE_SUMMARY_PROMPT_VERSION（lib/hash/essayImproveSummary.ts）を必ず bump すること。
import { ESSAY_IMPROVE_SUMMARY_SYSTEM_PROMPT } from '@/lib/prompts/essayImproveSummaryPrompt';
import type { BasicInfo } from '@/types/basicInfo';

const MODEL = 'claude-sonnet-4-6';
// M4: Vercel 実行時間上限。AI timeout（lib/aiTimeout.ts = 60s）+ 余裕。Pro 前提
// （Hobby は 60s 上限で AI timeout を吸収できない）。runtime は既定 nodejs（edge 不可）。
export const maxDuration = 80;
// 改善まとめ生成は毎回ユーザー固有の本文・回答に依存する。Next.js / fetch 層のキャッシュを
// 明示無効化し、古い生成結果が hit 扱いで返るのを防ぐ（POST handler は既定で dynamic だが明示する）。
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const ROUTE = 'api/essay-improve-summary';
const USAGE_ROUTE = 'essay-improve-summary';

// SYSTEM_PROMPT（ESSAY_IMPROVE_SUMMARY_SYSTEM_PROMPT）は lib/prompts/essayImproveSummaryPrompt.ts に lift 済み（STEP-LIB-06）。
// 役割（不変）: 役割宣言 / 禁止 5 項目 / やること 4 種 / 出力ルール / 出力 schema / トーン / 自問チェック。
// 本 route は ESSAY_IMPROVE_SUMMARY_SYSTEM_PROMPT を import して anthropic.messages.create の system に渡すだけ。
// userMessage（可変部）は下記 buildUserMessage / POST handler で組み立てる。

type WorkPayload = {
  issueText?: string;
  axis?: string;
  deepQuestions?: string[];
  answers?: string[];
};

type Body = {
  works?: WorkPayload[];
  currentEssayBody?: string;
  theme?: string;
  mini?: { conclusion?: string; reasonOne?: string; reasonTwo?: string };
  basicInfo?: BasicInfo | null;
};

function buildUserMessage(b: Body): string {
  const basicInfoSection = buildBasicInfoPromptSection(b.basicInfo ?? null);

  const works = b.works ?? [];
  const worksSection = works
    .map((w, idx) => {
      const issueText = w.issueText?.trim() || '（未指定）';
      const axis = w.axis ?? '（未指定）';
      const qa = (w.deepQuestions ?? [])
        .map((q, i) => {
          const a = w.answers?.[i]?.trim() ?? '';
          return `  Q${i + 1}. ${q}\n  A. ${a || '（未回答）'}`;
        })
        .join('\n\n');
      return [
        `[改善点 ${idx + 1}]`,
        `内容: ${issueText}`,
        `軸: ${axis}`,
        qa ? `深掘り Q&A:\n${qa}` : '深掘り Q&A: （なし）',
      ].join('\n');
    })
    .join('\n\n---\n\n');

  const mini = b.mini ?? {};
  const miniLines: string[] = [];
  if (mini.conclusion?.trim()) miniLines.push(`結論: ${mini.conclusion.trim()}`);
  if (mini.reasonOne?.trim()) miniLines.push(`理由①: ${mini.reasonOne.trim()}`);
  if (mini.reasonTwo?.trim()) miniLines.push(`理由②: ${mini.reasonTwo.trim()}`);
  const miniSection =
    miniLines.length > 0 ? `【ミニ思考欄】\n${miniLines.join('\n')}` : '';

  const bodySection = b.currentEssayBody?.trim()
    ? `【現在の本文】\n${b.currentEssayBody.trim()}`
    : '【現在の本文】\n（空）';

  return [
    '生徒が複数の改善点に対して深掘り質問に答えた内容を読み、統合した改善方針を JSON で整理してください。',
    '',
    basicInfoSection,
    '',
    `【テーマ】\n${b.theme?.trim() || '（未指定）'}`,
    '',
    miniSection,
    '',
    bodySection,
    '',
    `【取り組む改善点と深掘り Q&A（${works.length} 件）】\n${worksSection || '（なし）'}`,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;

  // 最低限の必須入力チェック。
  if (!Array.isArray(body.works) || body.works.length === 0) {
    return Response.json(
      { error: '改善点が指定されていません（works 配列が空です）' },
      { status: 400 },
    );
  }
  // 少なくとも 1 件の work に issueText / deepQuestions があれば許容。
  const hasValidWork = body.works.some(
    (w) =>
      typeof w.issueText === 'string' &&
      w.issueText.trim() !== '' &&
      Array.isArray(w.deepQuestions) &&
      w.deepQuestions.length > 0,
  );
  if (!hasValidWork) {
    return Response.json(
      { error: '改善点の内容または深掘り質問が空です' },
      { status: 400 },
    );
  }

  // B2: prompt に埋め込む自由記述（本文 / テーマ / ミニ思考 / 各 work の Q&A）の最大長ガード。
  const lengthCheck = checkMaxLengths([
    { label: '本文', value: body.currentEssayBody, max: INPUT_MAX_LENGTHS.ESSAY },
    { label: 'テーマ', value: body.theme, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '結論', value: body.mini?.conclusion, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '理由1', value: body.mini?.reasonOne, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '理由2', value: body.mini?.reasonTwo, max: INPUT_MAX_LENGTHS.TEXT },
    ...(body.works ?? []).flatMap((w, i) => [
      { label: `改善点${i + 1}`, value: w.issueText, max: INPUT_MAX_LENGTHS.TEXT },
      { label: `深掘り質問${i + 1}`, value: w.deepQuestions, max: INPUT_MAX_LENGTHS.ANSWERS_TOTAL },
      { label: `回答${i + 1}`, value: w.answers, max: INPUT_MAX_LENGTHS.ANSWERS_TOTAL },
    ]),
  ]);
  if (!lengthCheck.ok) {
    return Response.json({ error: lengthCheck.message }, { status: 400 });
  }

  // STEP-GATE-COMPLETE: Plan Gate (essay feature)。validation 後 / AI 前。
  const gate = await ensurePlanQuota('essay');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  const userMessage = buildUserMessage(body);

  try {
    // SYSTEM_PROMPT は不変なので cache_control: 'ephemeral' で
    // 5 分以内の連続生成を input 単価大幅割引にする（既存 essay-review と同パターン）。
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      temperature: 0.2,
      system: [
        {
          type: 'text',
          text: ESSAY_IMPROVE_SUMMARY_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    }, { signal: createTimeoutSignal() });

    const text =
      message.content[0]?.type === 'text' ? message.content[0].text : '';

    if (message.stop_reason === 'max_tokens') {
      console.error('essay-improve-summary truncated', {
        stopReason: message.stop_reason,
        rawTextTail: text.slice(-200),
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
          error: 'AI_SUMMARY_TRUNCATED',
          message:
            'AI のまとめ生成が途中で終了しました。もう一度お試しください。',
        },
        { status: 502 },
      );
    }

    let parsed: unknown = {};
    let parseOk = true;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      parseOk = false;
      console.error(
        'essay-improve-summary: JSON parse failed. rawTextTail:',
        text.slice(-200),
      );
    }

    logAiUsage({
      route: ROUTE,
      model: MODEL,
      status: parseOk ? 'success' : 'parse_failed',
      usage: message.usage,
      cache_creation_input_tokens: message.usage?.cache_creation_input_tokens,
      cache_read_input_tokens: message.usage?.cache_read_input_tokens,
    });
    await recordUsage({
      userId,
      route: USAGE_ROUTE,
      model: MODEL,
      status: parseOk ? 'ok' : 'error',
    });

    return Response.json(safeParseImproveSummary(parsed));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('essay-improve-summary API error:', msg);
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
    captureRouteException(error, { route: ROUTE, feature: 'ai', status: 500 }, { status: 500, code: 'AI_REQUEST_FAILED' });
    return Response.json(
      { error: 'AIの処理に失敗しました。時間をおいてお試しください。' },
      { status: 500 },
    );
  }
}
