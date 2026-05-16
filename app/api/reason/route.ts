import { buildReasonPrompt } from '@/lib/prompts';
import { anthropic } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';

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
      max_tokens: 500,
      temperature: 0.5,
      messages: [{ role: 'user', content: buildReasonPrompt(text) }],
    });

    const result = message.content[0].type === 'text' ? message.content[0].text : '';
    logAiUsage({
      route: ROUTE,
      model: MODEL,
      status: message.stop_reason === 'max_tokens' ? 'truncated' : 'success',
      usage: message.usage,
    });
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
