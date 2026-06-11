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
import { captureRouteException } from '@/lib/sentry/capture';
import { logAiValidation } from '@/lib/aiValidationLog';
import { validateSummarizeInput } from '@/lib/validation/validateSummarizeInput';
import { checkMaxLengths } from '@/lib/validation/checkMaxLengths';
import { INPUT_MAX_LENGTHS } from '@/lib/validation/inputLimits';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { recordUsage } from '@/lib/billing/usageLog';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// /api/analysis / /api/analysis/additional と同じパターン。
const MODEL = 'claude-sonnet-4-6';
// M4: Vercel 実行時間上限。AI timeout（lib/aiTimeout.ts = 60s）+ 余裕。Pro 前提
// （Hobby は 60s 上限で AI timeout を吸収できない）。runtime は既定 nodejs（edge 不可）。
export const maxDuration = 80;

const ROUTE = 'api/summarize';
const USAGE_ROUTE = 'summarize';

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

  // V-6: client validator の最終防衛線。summary は短文 source でも成立するため
  // TOO_SHORT は適用しない（EMPTY / REPEATED_CHAR / PLACEHOLDER のみ）。
  const validation = validateSummarizeInput(activityData);
  if (!validation.ok) {
    logAiValidation({
      type: 'validation_reject',
      route: 'summarize',
      code: validation.code,
    });
    return Response.json({ error: validation.message }, { status: 400 });
  }

  // B2: validator が見ない自由記述配列（回答メモ）の最大長ガード。AI call / quota 前に弾く。
  const lengthCheck = checkMaxLengths([
    { label: '回答', value: answers, max: INPUT_MAX_LENGTHS.ANSWERS_TOTAL },
    { label: '追加メモ', value: body.deepAnswers, max: INPUT_MAX_LENGTHS.ANSWERS_TOTAL },
  ]);
  if (!lengthCheck.ok) {
    logAiValidation({ type: 'validation_reject', route: 'summarize', code: lengthCheck.code });
    return Response.json({ error: lengthCheck.message }, { status: 400 });
  }

  // STEP-GATE-COMPLETE: Plan Gate (self-pr feature)。
  const gate = await ensurePlanQuota('self-pr');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

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
    // 入力は決定論的なので system / user は 1 度だけ組み立てて 2 回の attempt で再利用する。
    const systemBlocks = [
      {
        type: 'text' as const,
        text: getSummarizeSystemPrompt(mode),
        cache_control: { type: 'ephemeral' as const },
      },
    ];
    const userMessages = [
      {
        role: 'user' as const,
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
    ];

    // parse 失敗時のみ 1 回だけ temperature 0 で再生成する暫定安定化。
    //   - JSON.parse(extractJson(raw)) が失敗したケースだけ retry（model 出力揺れの吸収）。
    //   - max_tokens truncation は retry せず、既存どおり AI_SUMMARY_TRUNCATED で返す。
    //   - 2 回目も失敗したときだけ AI_SUMMARY_PARSE_FAILED を返す。
    // prompt / output schema / max_tokens / truncation 分岐は据え置き。
    let summary: SummaryResult | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        // 初回は既存どおり 0.5。retry 時のみ 0 に下げて出力を安定させる。
        temperature: attempt === 2 ? 0 : 0.5,
        system: systemBlocks,
        messages: userMessages,
      }, { signal: createTimeoutSignal() });

      const raw = message.content[0].type === 'text' ? message.content[0].text : '';

      // STEP3.10: AI 出力が max_tokens 到達で途中切れする pre-existing 問題に対する hardening。
      // 他 route (/api/statement-review / /api/essay-review / /api/interview-feedback /
      // /api/analysis) と同じパターンで、JSON.parse 前に stop_reason を確認して明示エラーで弾く。
      // truncation は出力揺れではなく長さ起因のため retry 対象にしない。
      if (message.stop_reason === 'max_tokens') {
        console.error('summary truncated', {
          attempt,
          stopReason: message.stop_reason,
          rawTextTail: raw.slice(-200),
        });
        logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
        await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
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
      try {
        // normalize で deprecated field を空値で埋めるため、生 JSON のキー過不足に強い。
        summary = normalizeSummary(JSON.parse(extractJson(raw)));
      } catch {
        if (attempt === 1) {
          // 1 回目失敗: 生レスポンス全文は残さず、retry する旨だけ記録する。
          console.error('summary parse failed, retrying', {
            attempt,
            stopReason: message.stop_reason,
            rawLength: raw.length,
          });
          continue;
        }
        // 2 回目も失敗: ここで初めて PARSE_FAILED として返す。
        console.error('summary parse failed', {
          attempt,
          stopReason: message.stop_reason,
          rawLength: raw.length,
          rawTextTail: raw.slice(-200),
          outputTokens: message.usage?.output_tokens,
        });
        logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
        await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
        captureRouteException(new Error('AI_SUMMARY_PARSE_FAILED'), { route: ROUTE, feature: 'ai', status: 502 }, { status: 502, code: 'AI_SUMMARY_PARSE_FAILED' });
        return Response.json(
          {
            error: 'AI_SUMMARY_PARSE_FAILED',
            detail: 'AI response could not be parsed as JSON',
          },
          { status: 502 },
        );
      }

      // parse 成功: 成功 attempt の usage を success ログに残してループを抜ける。
      logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
      break;
    }

    // 制御フロー上 summary は break 前に必ず代入される（attempt 2 失敗時は return 済み）。
    if (!summary) {
      await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
      return Response.json(
        { error: 'AI_SUMMARY_PARSE_FAILED', detail: 'AI response could not be parsed as JSON' },
        { status: 502 },
      );
    }

    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'ok' });
    return Response.json({ summary });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Summarize API error:', msg);
    // 例外経路: messages.create() が throw した時点で response が無いため usage は取れない。
    // status のみログして「失敗回数」が集計できる状態にする（analysis 系 3 route 共通方針）。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
    captureRouteException(error, { route: ROUTE, feature: 'ai', status: 500 }, { status: 500, code: 'AI_REQUEST_FAILED' });
    return Response.json({ error: 'AI summarize failed', detail: msg }, { status: 500 });
  }
}
