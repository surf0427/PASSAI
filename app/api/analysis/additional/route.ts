// /api/analysis/additional の役割:
//
// このルートは「質問生成責務」専用のエンドポイント。深掘り質問を +2 問だけ追加する。
// /api/analysis の (A) profile 生成責務とは独立に動く（profile を再計算しない）のが重要。
// questions は壁打ちフロー内部の working memory であり、profile / 下流 feature とは独立。
// ここで生成された questions が StudentProfile に流れ込むことはない。
//
// STEP-SELFANALYSIS-QUESTION-QUALITY-01:
//   v2 で実装していた deterministic pool による AI skip 経路（pickAdditionalQuestions /
//   additionalQuestionsPool.ts）は v3 で完全廃止。固定 pool が活動内容に紐付かない
//   generic 質問しか返せず、自己分析機能の中核価値を毀損していたため。
//   既存質問との重複は AI prompt 内の【すでに出している質問（重複禁止）】section に
//   集約済みのため、AI 側で判定する。

import type { ActivityData } from '@/types/activity';
import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';
import { formatActivityData } from '@/lib/formatActivity';
import {
  ADDITIONAL_QUESTIONS_SYSTEM_PROMPT,
  buildAdditionalQuestionsPrompt,
} from '@/lib/prompts/additionalQuestionsPrompt';
import { anthropic, extractJson } from '@/lib/ai';
import { createTimeoutSignal } from '@/lib/aiTimeout';
import { buildThemeFrequency } from '@/lib/contextBuilders/divergence/buildThemeFrequency';
import { buildUniversityContextFromBasicInfo } from '@/lib/buildUniversityContext';
import { logAiUsage } from '@/lib/aiUsageLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { logAiValidation } from '@/lib/aiValidationLog';
import { validateAdditionalQuestionInput } from '@/lib/validation/validateAdditionalQuestionInput';
import { checkMaxLengths } from '@/lib/validation/checkMaxLengths';
import { INPUT_MAX_LENGTHS } from '@/lib/validation/inputLimits';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { recordUsage } from '@/lib/billing/usageLog';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// /api/analysis 側と同じパターン。model を切り替えるときはここを変えれば log も追従する。
const MODEL = 'claude-sonnet-4-6';
// M4: Vercel 実行時間上限。AI timeout（lib/aiTimeout.ts = 60s）+ 余裕。Pro 前提
// （Hobby は 60s 上限で AI timeout を吸収できない）。runtime は既定 nodejs（edge 不可）。
export const maxDuration = 80;
// 質問生成は毎回ユーザー固有入力に依存する。Next.js / fetch 層のキャッシュを明示無効化し、
// 古い生成結果が hit 扱いで返るのを防ぐ（POST handler は既定で dynamic だが明示する）。
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const ROUTE = 'api/analysis/additional';
const USAGE_ROUTE = 'analysis/additional';

export async function POST(req: Request) {
  const body = await req.json();
  const activityData: ActivityData | undefined = body.activityData;
  const existingQuestions: string[] = body.existingQuestions ?? [];
  const basicInfo: BasicInfo | null = body.basicInfo ?? null;
  // TODO: 将来は basicInfo から大学DB検索を経由して UniversityContext を enrich する。
  const universityContext: UniversityContext | null =
    body.universityContext ?? buildUniversityContextFromBasicInfo(basicInfo);

  if (!activityData) {
    return Response.json({ error: 'activityData is required' }, { status: 400 });
  }

  // V-6: client validator の最終防衛線。conversational UX 維持で EMPTY のみ。
  // 深掘り段階は短文入力が正常のため TOO_SHORT / REPEATED_CHAR / PLACEHOLDER は適用しない。
  const validation = validateAdditionalQuestionInput(activityData);
  if (!validation.ok) {
    logAiValidation({
      type: 'validation_reject',
      route: 'additional-questions',
      code: validation.code,
    });
    return Response.json({ error: validation.message }, { status: 400 });
  }

  // B2: prompt に埋め込む既出質問リストの合計長を制限する。
  const lengthCheck = checkMaxLengths([
    { label: '既出の質問', value: existingQuestions, max: INPUT_MAX_LENGTHS.ANSWERS_TOTAL },
  ]);
  if (!lengthCheck.ok) {
    logAiValidation({ type: 'validation_reject', route: 'additional-questions', code: lengthCheck.code });
    return Response.json({ error: lengthCheck.message }, { status: 400 });
  }

  // STEP-GATE-COMPLETE: Plan Gate (self-pr feature)。
  const gate = await ensurePlanQuota('self-pr');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  const activityText = formatActivityData(activityData);

  try {
    // STEP3.8: static rule（役割宣言・志望先文脈の解釈方針・制約・JSON schema 等）を
    // system に切り出した。
    //   - ADDITIONAL_QUESTIONS_SYSTEM_PROMPT は毎回不変
    //   - buildAdditionalQuestionsPrompt(...) は dynamic 部だけ（basicInfo / universityContext /
    //     活動データ / existingQuestions）
    //   model / max_tokens / messages の role と shape は STEP3.7 以前から不変。
    //   prompt caching (cache_control: 'ephemeral') 配備済み（STEP-API-CACHE-02）。
    //   STEP-API-MEASURE-01 で system prompt が ~2,191 chars / ~1,100 tokens（中央推定でほぼ
    //   1,024 tokens 閾値）と計測。閾値未達なら Anthropic 側で silently skip されるため
    //   low-risk 配備。「再び深掘る」連打など短時間連続呼び出しで cache hit する余地がある。
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: [
        {
          type: 'text',
          text: ADDITIONAL_QUESTIONS_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: buildAdditionalQuestionsPrompt({
            activityText,
            existingQuestions,
            basicInfo,
            universityContext,
            // STEP-DIVERGENCE-03C: テーマ偏り（activityData から決定論派生）を質問生成の探索 context に。
            // この段階では StudentProfile 未生成のため studentProfile は null（activityData のみで集計）。
            // activityData は既に HashAdditionalQuestionsInput に含まれるため hash field は増やさず
            // PROMPT_VERSION bump のみ（03A/DET 系と同型）。StudentProfile 生成には一切作用しない。
            themeFrequency: buildThemeFrequency({ activityData, studentProfile: null }),
          }),
        },
      ],
    }, { signal: createTimeoutSignal() });

    const raw = message.content[0].type === 'text' ? message.content[0].text : '';

    // STEP3.11: AI 出力が max_tokens 到達で途中切れする pre-existing 問題に対する hardening。
    // 他 route (/api/analysis / /api/summarize / /api/statement-review / /api/essay-review /
    // /api/interview-feedback) と同じパターンで、JSON.parse 前に stop_reason を確認して
    // 明示エラーで弾く。途中切れた raw を JSON.parse すると "Unexpected end of JSON input"
    // など実装詳細がユーザーに露出してしまうため、構造化エラーで包む。
    // max_tokens=500 / 出力 2 問のため truncation 確率は低いが、analysis 系列 3 route
    // (analysis / additional / summarize) の防御構造を揃えるために本 route も追加対応。
    if (message.stop_reason === 'max_tokens') {
      console.error('additional questions truncated', {
        stopReason: message.stop_reason,
        rawTextTail: raw.slice(-200),
      });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
      await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
      return Response.json(
        {
          error: 'AI_ADDITIONAL_QUESTIONS_TRUNCATED',
          detail: 'AI response was truncated before completion',
        },
        { status: 502 },
      );
    }

    // truncation 以外の JSON malformation を parse failure として区別する。
    // (truncation を弾いた後でも extractJson / JSON.parse が失敗するケースは
    // model が schema 違反の文字列を返した場合などに発生し得る。)
    let questions: string[];
    try {
      const result = JSON.parse(extractJson(raw));
      questions = result.questions as string[];
    } catch {
      console.error('additional questions parse failed', {
        stopReason: message.stop_reason,
        rawLength: raw.length,
        rawTextHead: raw.slice(0, 200),
        rawTextTail: raw.slice(-200),
        outputTokens: message.usage?.output_tokens,
      });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
      await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
      captureRouteException(new Error('AI_ADDITIONAL_QUESTIONS_PARSE_FAILED'), { route: ROUTE, feature: 'ai', status: 502 }, { status: 502, code: 'AI_ADDITIONAL_QUESTIONS_PARSE_FAILED' });
      return Response.json(
        {
          error: 'AI_ADDITIONAL_QUESTIONS_PARSE_FAILED',
          detail: 'AI response could not be parsed as JSON',
        },
        { status: 502 },
      );
    }

    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'ok' });
    return Response.json({ questions });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Additional questions API error:', msg);
    // 例外経路: messages.create() が throw した時点で response が無いため usage は取れない。
    // status のみログして「失敗回数」が集計できる状態にする（/api/analysis と同じ方針）。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
    captureRouteException(error, { route: ROUTE, feature: 'ai', status: 500 }, { status: 500, code: 'AI_REQUEST_FAILED' });
    return Response.json(
      { error: '質問の追加生成に失敗しました', detail: msg },
      { status: 500 },
    );
  }
}
