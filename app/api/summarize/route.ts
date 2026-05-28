// /api/summarize の役割:
//   「自己分析の簡潔な要約」を返すだけ。下流 feature の完成物（自己PR下書き・面接で話す要点）は
//   ここでは作らない。下流は StudentProfile を経由して自前で必要な context を派生する。

import type { ActivityData } from '@/types/activity';
import type { SummarizeMode, WallHittingResult, SummaryResult } from '@/types/analysis';
import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';
import { formatActivityData } from '@/lib/formatActivity';
import { buildSummarizePrompt, getSummarizeSystemPrompt } from '@/lib/prompts/summarizePrompt';
import { anthropic, extractJson } from '@/lib/ai';
import { createTimeoutSignal } from '@/lib/aiTimeout';
import { buildUniversityContextFromBasicInfo } from '@/lib/buildUniversityContext';
import {
  normalizeDeepAnswers,
  normalizeFreeMemo,
  normalizeSummary,
} from '@/lib/summarizeNormalize';
import { logAiUsage } from '@/lib/aiUsageLog';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// /api/analysis / /api/analysis/additional と同じパターン。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/summarize';

// normalizeSummary は lib/summarizeNormalize.ts に co-locate（input 正規化 helpers と同居）。
// 戻り値 SummaryResult shape および fallback 挙動は完全に同一。

export async function POST(req: Request) {
  const body = await req.json();
  const activityData: ActivityData | undefined = body.activityData;
  const analysis: WallHittingResult | undefined = body.analysis;
  const answers: string[] | undefined = body.answers;
  const basicInfo: BasicInfo | null = body.basicInfo ?? null;
  // TODO: 将来は basicInfo から大学DB検索を経由して UniversityContext を enrich する。
  const universityContext: UniversityContext | null =
    body.universityContext ?? buildUniversityContextFromBasicInfo(basicInfo);

  if (!activityData || !analysis || !answers) {
    return Response.json(
      { error: 'activityData, analysis, and answers are required' },
      { status: 400 },
    );
  }

  // 各質問の任意「追加深掘りメモ」。
  // body 省略時 / 配列でない / 長さズレに耐えるため、必ず共有 helper で正規化する。
  // client (page.tsx) も同じ helper を経由するため、同入力なら hash が一致して cache hit する。
  const deepAnswers = normalizeDeepAnswers(body.deepAnswers, answers.length);

  // light / deep の mode 分岐。body.mode が 'deep' のときだけ deep、それ以外は 'light' fallback。
  // 不明値（undefined / 文字化け / 想定外の string）も 'light' に倒すことで AI 入力の安全側を担保する。
  // client は decideSummarizeMode で都度算出した値を渡すため、両側で値が一致する。
  const mode: SummarizeMode = body.mode === 'deep' ? 'deep' : 'light';

  // 任意の自由メモ。共有 helper で trim + FREE_MEMO_MAX_CHARS truncate する。
  // client (page.tsx) も同じ helper を経由するため、上限超過 / 余分な空白の差で hash がズレない。
  // /api/summarize のみで読む（StudentProfile / Context Builder には流さない）。
  const freeMemo = normalizeFreeMemo(body.freeMemo);

  const activityText = formatActivityData(activityData);

  try {
    // STEP3.9: static rule（役割宣言・志望先文脈の解釈方針・出力ルール・JSON schema 等）を
    // system に切り出した。
    //   - SUMMARIZE_SYSTEM_PROMPT は毎回不変
    //   - buildSummarizePrompt(...) は dynamic 部だけ（basicInfo / universityContext /
    //     活動情報 / AI分析 / 深掘り質問と回答）
    //   model / max_tokens / temperature / messages の role と shape は STEP3.8 以前から不変。
    //   prompt caching (cache_control: 'ephemeral') 配備済み（STEP-API-CACHE-02）。
    //   STEP-API-MEASURE-01 で light ~2,554 chars / deep ~2,699 chars（共に中央推定で
    //   1,024 tokens を超える境界）と計測。閾値未達なら Anthropic 側で silently skip される
    //   ため low-risk 配備。getSummarizeSystemPrompt(mode) の light / deep 分岐は不変で、
    //   選ばれた system 文字列が ephemeral cache 対象になる。
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      temperature: 0.5,
      system: [
        {
          type: 'text',
          text: getSummarizeSystemPrompt(mode),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: buildSummarizePrompt({
            activityText,
            analysis,
            answers,
            deepAnswers,
            freeMemo,
            basicInfo,
            universityContext,
          }),
        },
      ],
    }, { signal: createTimeoutSignal() });

    const raw = message.content[0].type === 'text' ? message.content[0].text : '';

    // STEP3.10: AI 出力が max_tokens 到達で途中切れする pre-existing 問題に対する hardening。
    // 他 route (/api/statement-review / /api/essay-review / /api/interview-feedback /
    // /api/analysis) と同じパターンで、JSON.parse 前に stop_reason を確認して
    // 明示エラーで弾く。途中切れた raw を JSON.parse すると "Unexpected end of JSON input"
    // など実装詳細がユーザーに露出してしまうため、構造化エラーで包む。
    if (message.stop_reason === 'max_tokens') {
      console.error('summary truncated', {
        stopReason: message.stop_reason,
        rawTextTail: raw.slice(-200),
      });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage });
      return Response.json(
        {
          error: 'AI_SUMMARY_TRUNCATED',
          detail: 'AI response was truncated before completion',
        },
        { status: 502 },
      );
    }

    // truncation 以外の JSON malformation を parse failure として区別する。
    // (truncation を弾いた後でも extractJson / JSON.parse が失敗するケースは
    // model が schema 違反の文字列を返した場合などに発生し得る。)
    let summary: SummaryResult;
    try {
      // normalize で deprecated field を空値で埋めるため、生 JSON のキー過不足に強い。
      summary = normalizeSummary(JSON.parse(extractJson(raw)));
    } catch {
      console.error('summary parse failed', {
        stopReason: message.stop_reason,
        rawLength: raw.length,
        rawTextHead: raw.slice(0, 200),
        rawTextTail: raw.slice(-200),
        outputTokens: message.usage?.output_tokens,
      });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: message.usage });
      return Response.json(
        {
          error: 'AI_SUMMARY_PARSE_FAILED',
          detail: 'AI response could not be parsed as JSON',
        },
        { status: 502 },
      );
    }

    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage });
    return Response.json({ summary });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Summarize API error:', msg);
    // 例外経路: messages.create() が throw した時点で response が無いため usage は取れない。
    // status のみログして「失敗回数」が集計できる状態にする（analysis 系 3 route 共通方針）。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    return Response.json({ error: 'AI summarize failed', detail: msg }, { status: 500 });
  }
}
