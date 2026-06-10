// 自己PR 添削向け plain text 応答 route（self-pr ページの「分析」ボタンから呼ばれる）。
//
// cache / PROMPT_VERSION 方針:
//   - 本 route は **client cache を持たない**（同入力でも毎回 AI を呼ぶ）。
//   - したがって **PROMPT_VERSION 管理対象外**。lib/hash/ にも対応する hash file は無い。
//   - buildReasonPrompt の本文を変更しても cache invalidation は不要（cache 自体が無いため）。
//   - 文言改修は PR description で明示する運用（docs/principles/ai_cache_observability.md §6.2 の
//     「Has cache? = No の route」と整合）。
//   - 現状 buildReasonPrompt は legacy `lib/prompts.ts` に置かれており、他 feature の
//     `lib/prompts/<feature>Prompt.ts` 配置と非統一。配置統一は将来 STEP の候補で、本 route の
//     挙動は不変。
//
// docs/principles/ai_cache_observability.md §6.1 / §6.3 を参照。
import { buildReasonPrompt } from '@/lib/prompts';
import { buildThemeFrequencySection } from '@/lib/contextBuilders/divergence/themeFrequencySection';
import { buildUnusedExperienceSection } from '@/lib/contextBuilders/divergence/unusedExperienceSection';
import type { ThemeFrequency, UnusedExperience } from '@/types/divergence';
import { anthropic } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { createTimeoutSignal } from '@/lib/aiTimeout';
import { checkMaxLengths } from '@/lib/validation/checkMaxLengths';
import { INPUT_MAX_LENGTHS } from '@/lib/validation/inputLimits';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { recordUsage } from '@/lib/billing/usageLog';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// 本 route は plain text 応答（JSON parse なし）のため parse_failed は発生しない。
// truncation は stop_reason から検出して log するが、既存挙動どおりレスポンスはそのまま返す。
const MODEL = 'claude-sonnet-4-6';
// M4: Vercel 実行時間上限。AI timeout（lib/aiTimeout.ts = 60s）+ 余裕。Pro 前提
// （Hobby は 60s 上限で AI timeout を吸収できない）。runtime は既定 nodejs（edge 不可）。
export const maxDuration = 80;
// 自己PR添削生成は毎回ユーザー固有入力に依存する。Next.js / fetch 層のキャッシュを明示無効化し、
// 古い生成結果が hit 扱いで返るのを防ぐ（POST handler は既定で dynamic だが明示する）。
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const ROUTE = 'api/reason';
const USAGE_ROUTE = 'reason';

export async function POST(req: Request) {
  const body = await req.json();
  const text: string = body.text ?? '';
  // STEP-DIVERGENCE-03B: client(self-pr page) が送ってきたテーマ偏り struct。
  // 未送信なら null（完全後方互換 = section を出さない）。route 内で localStorage /
  // Supabase は読まない（client が build 済みの struct をそのまま section formatter へ流す）。
  // optional field gate のため、将来 /api/reason を別 feature が text のみで叩いても section は出ない。
  const themeFrequency: ThemeFrequency | null = body.themeFrequency ?? null;
  // STEP-DIVERGENCE-04A: client(self-pr page) が送ってきた「まだ活用できていない可能性のある経験」
  // struct。未送信なら null（完全後方互換 = section を出さない）。route で localStorage / Supabase は
  // 読まない（client が build 済みの struct をそのまま section formatter へ流す）。
  const unusedExperience: UnusedExperience | null = body.unusedExperience ?? null;

  if (!text.trim()) {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }

  // B2: prompt に埋め込む自由記述（自己PR 分析用テキスト）の最大長ガード。
  const lengthCheck = checkMaxLengths([
    { label: '入力テキスト', value: text, max: INPUT_MAX_LENGTHS.TEXT },
  ]);
  if (!lengthCheck.ok) {
    return Response.json({ error: lengthCheck.message }, { status: 400 });
  }

  // STEP-GATE-COMPLETE: Plan Gate (self-pr feature)。
  const gate = await ensurePlanQuota('self-pr');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      temperature: 0.5,
      messages: [
        {
          role: 'user',
          content: buildReasonPrompt(text, {
            // STEP-DIVERGENCE-03B: 探索型 section。未送信 / documentsConsidered<3 / underused 空なら
            // formatter が空文字を返し、buildReasonPrompt 側で section ブロックごと省略される（旧挙動）。
            themeFrequencySection: buildThemeFrequencySection(themeFrequency),
            // STEP-DIVERGENCE-04A: 未使用経験の探索型 section。未送信 / totalExperiences<3 / unused 空なら
            // formatter が空文字を返し section ブロックごと省略される（旧挙動）。
            unusedExperienceSection: buildUnusedExperienceSection(unusedExperience),
          }),
        },
      ],
    }, { signal: createTimeoutSignal() });

    const result = message.content[0].type === 'text' ? message.content[0].text : '';

    // max_tokens で途中終了した出力は plain text 経路の本 route ではそのまま画面に
    // 表示されてしまう（self-pr 側で setResult される）。/api/essay-chat と同じ
    // パターンで 502 + ユーザー向けメッセージで弾く。
    if (message.stop_reason === 'max_tokens') {
      console.error('reason truncated', {
        stopReason: message.stop_reason,
        rawTextTail: result.slice(-200),
      });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
      await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
      return Response.json(
        {
          error: 'AI_REPLY_TRUNCATED',
          message: 'AIの返答が途中で終了しました。もう一度お試しください。',
        },
        { status: 502 },
      );
    }

    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'ok' });
    return Response.json({ result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Claude API error:', msg);
    // 例外経路: messages.create() が throw した時点で response が無いため usage は取れない。
    // status のみログして「失敗回数」を集計できる状態にする（analysis 系列と共通方針）。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
    captureRouteException(error, { route: ROUTE, feature: 'ai', status: 500 }, { status: 500, code: 'AI_REQUEST_FAILED' });
    return Response.json({ error: 'Claude API call failed', detail: msg }, { status: 500 });
  }
}
