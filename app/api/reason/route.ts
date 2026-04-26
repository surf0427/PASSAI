import { buildReasonPrompt } from '@/lib/prompts';
import { anthropic } from '@/lib/ai';

export async function POST(req: Request) {
  const body = await req.json();
  const text: string = body.text ?? '';

  if (!text.trim()) {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      temperature: 0.5,
      messages: [{ role: 'user', content: buildReasonPrompt(text) }],
    });

    const result = message.content[0].type === 'text' ? message.content[0].text : '';
    return Response.json({ result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Claude API error:', msg);
    return Response.json({ error: 'Claude API call failed', detail: msg }, { status: 500 });
  }
}
