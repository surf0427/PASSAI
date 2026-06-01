// /api/analysis の役割:
//
// このルートは 1 回の AI 呼び出しで 2 つの責務を同時に処理する。
//
//   (A) profile 生成責務
//       → summary / strengths / weaknesses / futureConnections / applicantType
//         （= toStudentProfile() の入力となる canonical な分析素材）
//
//   (B) 質問生成責務（初期 5 問）
//       → questions（活動データに直接言及した深掘り質問）
//         （= 壁打ちフロー内部の working memory。下流 feature には渡さない）
//
// STEP-SELFANALYSIS-QUESTION-QUALITY-01:
//   v4 で deterministic catalog（initialQuestionsCatalog.ts）に移管していた (B) を
//   v5 で AI 生成に戻した。固定テンプレが activity 名・テーマ・固有名詞に言及しない
//   generic 質問しか返せず、自己分析機能の中核価値を毀損していたため。
//   catalog 経路は完全廃止し、extractInitialQuestions で AI 出力から取り出す。

import type { ActivityData } from '@/types/activity';
import type { WallHittingResult } from '@/types/analysis';
import { isApplicantType } from '@/types/applicantType';
import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';
import { formatActivityData } from '@/lib/formatActivity';
import { ANALYSIS_SYSTEM_PROMPT, buildWallHittingPrompt } from '@/lib/prompts/analysisPrompt';
import { anthropic, extractJson } from '@/lib/ai';
import { createTimeoutSignal } from '@/lib/aiTimeout';
import { buildUniversityContextFromBasicInfo } from '@/lib/buildUniversityContext';
import {
  extractProfileMaterial,
  extractInitialQuestions,
} from '@/lib/analysis/extractWallHittingParts';
import { logAiUsage } from '@/lib/aiUsageLog';
import { logAiValidation } from '@/lib/aiValidationLog';
import { validateAnalysisInput } from '@/lib/validation/validateAnalysisInput';

// 使用 model を constant 化（messages.create() と usage log で同じ値を共有するため）。
// model を切り替えるときはここを変えれば log も追従する。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/analysis';

// 責務分離ヘルパは lib/analysis/extractWallHittingParts.ts に集約。
// - extractProfileMaterial : (A) profile 素材を取り出す
// - extractInitialQuestions: (B) 初期 5 問を取り出す
// WallHittingResult.questions の shape は不変（5 件・`【カテゴリ】本文` 形式）。

export async function POST(req: Request) {
  const body = await req.json();
  const activityData: ActivityData | undefined = body.activityData;
  // basicInfo は任意。null フォールバックで安全に扱う。
  const basicInfo: BasicInfo | null = body.basicInfo ?? null;
  // universityContext は client から直接送られることもあれば、basicInfo から派生させることもある。
  // TODO: 将来は basicInfo.preferences[*].university から大学DBを引いて
  //       enrich された UniversityContext を生成する処理をここに挟む。
  const universityContext: UniversityContext | null =
    body.universityContext ?? buildUniversityContextFromBasicInfo(basicInfo);

  if (!activityData) {
    return Response.json({ error: 'activityData is required' }, { status: 400 });
  }

  // V-6: client validator の最終防衛線。conversational UX は維持（threshold 30 chars / EMPTY /
  // REPEATED_CHAR / PLACEHOLDER のみ）。AI call / prompt build / aiUsageLog 未到達で 400。
  const validation = validateAnalysisInput(activityData);
  if (!validation.ok) {
    logAiValidation({
      type: 'validation_reject',
      route: 'analysis',
      code: validation.code,
    });
    return Response.json({ error: validation.message }, { status: 400 });
  }

  const activityText = formatActivityData(activityData);

  try {
    // STEP3.5: static rule（役割宣言・志望先文脈の解釈方針・出力内容の指針・JSON schema 等）を
    // system に切り出した。
    //   - ANALYSIS_SYSTEM_PROMPT は毎回不変
    //   - buildWallHittingPrompt(...) は dynamic 部だけ（basicInfo / universityContext /
    //     【活動データ】 + activityText）
    //   model / max_tokens / messages の role と shape は STEP3.4 から不変。
    //   prompt caching (cache_control: 'ephemeral') 配備済み（STEP-API-CACHE-01）。
    //   STEP-API-MEASURE-01 で system prompt が ~4,145 chars / ~2,000 tokens（中央推定）と
    //   Sonnet 4-6 の 1,024 tokens 閾値を確実に上回ることを確認したうえで配備した。
    //   同一受験生による再分析 / 再生成で input cache hit による単価割引が期待される。
    // max_tokens: profile (~600-900 tokens) + 初期 5 問 (~400-600 tokens) + JSON 構造
    // overhead を見込み 2400 を確保する。STEP-SELFANALYSIS-QUESTION-QUALITY-01 で
    // questions を AI 出力に戻したため、旧 1600 から増量。
    // truncation hardening は既存ロジックで継続して効く。
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2400,
      system: [
        {
          type: 'text',
          text: ANALYSIS_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          // buildWallHittingPrompt は dynamic 部のみ（basicInfo / universityContext / activityText）。
          // (A) profile 生成 + (B) questions 生成の責務境界は ANALYSIS_SYSTEM_PROMPT 側で
          // 「出力内容の指針」として記述されている。lib/prompts.ts のヘッダコメント参照。
          content: buildWallHittingPrompt({ activityText, basicInfo, universityContext }),
        },
      ],
    }, { signal: createTimeoutSignal() });

    const raw = message.content[0].type === 'text' ? message.content[0].text : '';

    // STEP3.7: AI 出力が max_tokens 到達で途中切れする pre-existing 問題に対する hardening。
    // 他 route (/api/statement-review / /api/essay-review / /api/interview-feedback) と
    // 同じパターンで、JSON.parse 前に stop_reason を確認して明示エラーで弾く。
    // 途中切れた raw を JSON.parse すると "Unexpected end of JSON input" など実装詳細が
    // ユーザーに露出してしまうため、構造化エラーで包む。
    if (message.stop_reason === 'max_tokens') {
      console.error('analysis truncated', {
        stopReason: message.stop_reason,
        rawTextTail: raw.slice(-200),
      });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
      return Response.json(
        {
          error: 'AI_ANALYSIS_TRUNCATED',
          detail: 'AI response was truncated before completion',
        },
        { status: 502 },
      );
    }

    // truncation 以外の JSON malformation を parse failure として区別する。
    // (truncation を弾いた後でも extractJson / JSON.parse が失敗するケースは
    // model が schema 違反の文字列を返した場合などに発生し得る。)
    let parsed: WallHittingResult;
    try {
      parsed = JSON.parse(extractJson(raw)) as WallHittingResult;
    } catch {
      console.error('analysis parse failed', {
        stopReason: message.stop_reason,
        rawLength: raw.length,
        rawTextHead: raw.slice(0, 200),
        rawTextTail: raw.slice(-200),
        outputTokens: message.usage?.output_tokens,
      });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
      return Response.json(
        {
          error: 'AI_ANALYSIS_PARSE_FAILED',
          detail: 'AI response could not be parsed as JSON',
        },
        { status: 502 },
      );
    }

    // 概念的に 2 つの責務へ分離してから組み立て直す。
    // 後方互換のため WallHittingResult を返す（出力スキーマは温存）。
    // - profile 素材 (A) は AI 出力から取り出す
    // - 初期 5 問 (B) も AI 出力から取り出す（v5 で catalog 経路廃止）
    const profileMaterial = extractProfileMaterial(parsed);
    const initialQuestions = extractInitialQuestions(parsed);
    // STEP B: applicantType は optional 出力。AI が 5 種 enum 以外（null / 未定義 /
    // 想定外の文字列）を返したケースは drop し、result の key 自体を出さない。
    // extractProfileMaterial は applicantType を picked field に含めないため、
    // ここで明示的に conditional spread で乗せる（責務分離ヘルパは触らない）。
    const rawApplicantType: unknown = (parsed as { applicantType?: unknown }).applicantType;
    const validApplicantType = isApplicantType(rawApplicantType) ? rawApplicantType : undefined;
    const result: WallHittingResult = {
      ...profileMaterial,
      questions: initialQuestions,
      ...(validApplicantType ? { applicantType: validApplicantType } : {}),
    };

    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
    return Response.json({ result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Analysis API error:', msg);
    // 例外経路: messages.create() が throw した時点で response が無いため usage は取れない。
    // status のみログして「失敗回数」が集計できる状態にする（無理に複雑化しない）。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    return Response.json({ error: 'AI analysis failed', detail: msg }, { status: 500 });
  }
}
