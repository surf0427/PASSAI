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
import { anthropic } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';
import { createTimeoutSignal } from '@/lib/aiTimeout';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// 本 route は plain text 応答（JSON parse なし）のため parse_failed は発生しない。
// truncation は stop_reason から検出して log するが、既存挙動どおりレスポンスはそのまま返す。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/reason';

export async function POST(req: Request) {
  const body = await req.json();
  const text: string = body.text ?? '';

  if (!text.trim()) {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      temperature: 0.5,
      messages: [{ role: 'user', content: buildReasonPrompt(text) }],
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
      return Response.json(
        {
          error: 'AI_REPLY_TRUNCATED',
          message: 'AIの返答が途中で終了しました。もう一度お試しください。',
        },
        { status: 502 },
      );
    }

    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
    return Response.json({ result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Claude API error:', msg);
    // 例外経路: messages.create() が throw した時点で response が無いため usage は取れない。
    // status のみログして「失敗回数」を集計できる状態にする（analysis 系列と共通方針）。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    return Response.json({ error: 'Claude API call failed', detail: msg }, { status: 500 });
  }
}
