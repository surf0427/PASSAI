// /api/analysis/additional の役割（StudentProfile 導入後の責務整理）:
//
// このルートは「質問生成責務」専用のエンドポイント。深掘り質問を +2 問だけ追加する。
// /api/analysis の (A) profile 生成責務とは独立に動く（profile を再計算しない）のが重要。
//
// 将来の収束点:
//   - 「質問生成責務」はこのルート（または同等の後継 /api/self-analysis/questions）に集約する
//   - 初期質問（現在は /api/analysis に同居）も将来こちらに引っ越し、引数で
//     `mode: 'initial' | 'additional'` を切り替える形が候補
//   - questions は壁打ちフロー内部の working memory であり、profile / 下流 feature とは独立。
//     ここで生成された questions が StudentProfile に流れ込むことはない
//
// TODO（次フェーズ）:
//   1. 初期質問の生成を /api/analysis から本ルートへ移し、profile API と完全分離する
//   2. （実装済 / Deterministic Audit P1-2）existingQuestions を hash 化して、同じ前提なら
//      AI を呼ばず deterministic fallback pool から「次の 2 問」を返す
//      → lib/analysis/additionalQuestionsPool.ts:pickAdditionalQuestions

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
import { buildUniversityContextFromBasicInfo } from '@/lib/buildUniversityContext';
import { logAiUsage } from '@/lib/aiUsageLog';
import { logAiValidation } from '@/lib/aiValidationLog';
import { validateAdditionalQuestionInput } from '@/lib/validation/validateAdditionalQuestionInput';
import { pickAdditionalQuestions } from '@/lib/analysis/additionalQuestionsPool';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// /api/analysis 側と同じパターン。model を切り替えるときはここを変えれば log も追従する。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/analysis/additional';

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

  // Deterministic Audit P1-2: AI 呼び出し前に deterministic fallback pool を試行する。
  // 同入力（activityData / existingQuestions / basicInfo / universityContext）から hash を作り、
  // pool から重複しない 2 問が拾えた場合は AI を skip して即返す。
  //   - response shape は変更なし（{ questions: string[] }）
  //   - 既存 client cache (additionalQuestionsCache) には影響なし。client 側は同じ shape を保存
  //   - skip 発火時は aiUsageLog を呼ばない（AI を消費していないため）。代わりに skip log を出す
  //   - pool が枯渇（候補 < 2）した場合は null が返り、従来の AI 経路に倒れる
  const skipResult = pickAdditionalQuestions({
    activityData,
    existingQuestions,
    basicInfo,
    universityContext,
  });
  if (skipResult !== null) {
    console.info('additional questions deterministic skip', {
      route: ROUTE,
      hash: skipResult.hash,
      existingCount: existingQuestions.length,
    });
    return Response.json({ questions: skipResult.questions });
  }

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
      return Response.json(
        {
          error: 'AI_ADDITIONAL_QUESTIONS_PARSE_FAILED',
          detail: 'AI response could not be parsed as JSON',
        },
        { status: 502 },
      );
    }

    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
    return Response.json({ questions });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Additional questions API error:', msg);
    // 例外経路: messages.create() が throw した時点で response が無いため usage は取れない。
    // status のみログして「失敗回数」が集計できる状態にする（/api/analysis と同じ方針）。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    return Response.json(
      { error: '質問の追加生成に失敗しました', detail: msg },
      { status: 500 },
    );
  }
}
