// /api/analysis の役割と将来の分割計画（StudentProfile 導入後の責務整理）:
//
// このルートは現在 2 つの責務を 1 回の AI 呼び出しで同時に処理している。
//
//   (A) profile 生成責務
//       → summary / strengths / weaknesses / futureConnections
//         （= toStudentProfile() の入力となる canonical な分析素材）
//
//   (B) 質問生成責務（初期 5 問固定）
//       → questions
//         （= 壁打ちフロー内部の working memory。下流 feature には渡さない）
//
// 後方互換のため出力スキーマは WallHittingResult のまま維持しているが、
// 本ファイル内では post-parse で **明示的に 2 つの責務へ分離した変数**として扱う。
// これにより将来：
//
//   /api/self-analysis/profile   ← (A) 専用 API
//   /api/self-analysis/questions ← (B) 専用 API（/api/analysis/additional と統合）
//
// に分割するときの境界線がコード上で見えるようにしてある。
//
// TODO（次フェーズ）:
//   1. (A) と (B) を別 AI 呼び出し化する（初期コストは増えるが、profile が変わって
//      いない場合に (B) だけ走らせる最適化が可能になる）
//   2. profile 側に sourceHash ベースの再生成スキップを入れる
//      （toStudentProfile() の sourceHash と組み合わせて、入力 hash 一致なら AI を呼ばない）
//   3. 出力スキーマを `{ profile: ProfileMaterial, questions: string[] }` に分けて返す
//      （その時点で WallHittingResult は legacy 型として deprecation 経路へ）

import type { ActivityData } from '@/types/activity';
import type { WallHittingResult } from '@/types/analysis';
import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';
import { formatActivityData } from '@/lib/formatActivity';
import { ANALYSIS_SYSTEM_PROMPT, buildWallHittingPrompt } from '@/lib/prompts/analysisPrompt';
import { anthropic, extractJson } from '@/lib/ai';
import { buildUniversityContextFromBasicInfo } from '@/lib/buildUniversityContext';
import {
  extractInitialQuestions,
  extractProfileMaterial,
} from '@/lib/analysis/extractWallHittingParts';
import { logAiUsage } from '@/lib/aiUsageLog';

// 使用 model を constant 化（messages.create() と usage log で同じ値を共有するため）。
// model を切り替えるときはここを変えれば log も追従する。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/analysis';

// (A) profile 生成責務 (extractProfileMaterial / ProfileMaterial 型) と
// (B) 質問生成責務 (extractInitialQuestions) の責務分離ヘルパは
// lib/analysis/extractWallHittingParts.ts に切り出した。戻り値 shape は完全に同一。

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

  const activityText = formatActivityData(activityData);
  if (!activityText.trim()) {
    return Response.json({ error: 'activity data is empty' }, { status: 400 });
  }

  try {
    // STEP3.5: static rule（役割宣言・志望先文脈の解釈方針・出力内容の指針・JSON schema 等）を
    // system に切り出した。
    //   - ANALYSIS_SYSTEM_PROMPT は毎回不変
    //   - buildWallHittingPrompt(...) は dynamic 部だけ（basicInfo / universityContext /
    //     【活動データ】 + activityText）
    //   model / max_tokens / messages の role と shape は STEP3.4 から不変。
    //   prompt caching (cache_control) はまだ付けない（STEP3.4 調査で system が ~1,294 tokens と
    //   Sonnet 4-6 の実効 caching 閾値を下回るため）。
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          // buildWallHittingPrompt は dynamic 部のみ（basicInfo / universityContext / activityText）。
          // (A) profile 生成 + (B) questions 生成の責務境界は ANALYSIS_SYSTEM_PROMPT 側で
          // 「出力内容の指針」として記述されている。lib/prompts.ts のヘッダコメント参照。
          content: buildWallHittingPrompt({ activityText, basicInfo, universityContext }),
        },
      ],
    });

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
      logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage });
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
      console.error('analysis parse failed', { rawTextTail: raw.slice(-200) });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: message.usage });
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
    // 将来 API 分割時は profileMaterial と initialQuestions を別エンドポイントで返す。
    const profileMaterial = extractProfileMaterial(parsed);
    const initialQuestions = extractInitialQuestions(parsed);
    const result: WallHittingResult = { ...profileMaterial, questions: initialQuestions };

    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage });
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
