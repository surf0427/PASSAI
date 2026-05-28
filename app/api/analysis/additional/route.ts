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
//   2. existingQuestions を hash 化して、同じ前提なら AI を呼ばず deterministic に「次の質問」を返す
//      最適化を検討（軽量質問の token 削減）

import type { ActivityData } from '@/types/activity';
import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';
import { formatActivityData } from '@/lib/formatActivity';
import {
  ADDITIONAL_QUESTIONS_SYSTEM_PROMPT,
  buildAdditionalQuestionsPrompt,
} from '@/lib/prompts/additionalQuestionsPrompt';
import { anthropic, extractJson } from '@/lib/ai';
import { buildUniversityContextFromBasicInfo } from '@/lib/buildUniversityContext';
import { logAiUsage } from '@/lib/aiUsageLog';

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

  const activityText = formatActivityData(activityData);

  try {
    // STEP3.8: static rule（役割宣言・志望先文脈の解釈方針・制約・JSON schema 等）を
    // system に切り出した。
    //   - ADDITIONAL_QUESTIONS_SYSTEM_PROMPT は毎回不変
    //   - buildAdditionalQuestionsPrompt(...) は dynamic 部だけ（basicInfo / universityContext /
    //     活動データ / existingQuestions）
    //   model / max_tokens / messages の role と shape は STEP3.7 以前から不変。
    //   prompt caching (cache_control) は付けない（system 候補は短く、Sonnet 4-6 の
    //   実効 caching 閾値を大きく下回るため）。
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
    });

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
      logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage });
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
      logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: message.usage });
      return Response.json(
        {
          error: 'AI_ADDITIONAL_QUESTIONS_PARSE_FAILED',
          detail: 'AI response could not be parsed as JSON',
        },
        { status: 502 },
      );
    }

    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage });
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
