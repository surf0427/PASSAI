import type { ActivityData } from '@/types/activity';
import type { WallHittingResult } from '@/types/analysis';
import { formatActivityData } from '@/lib/formatActivity';
import { buildWallHittingPrompt } from '@/lib/prompts';
import { anthropic, extractJson } from '@/lib/ai';

export async function POST(req: Request) {
  const body = await req.json();
  const activityData: ActivityData | undefined = body.activityData;

  if (!activityData) {
    return Response.json({ error: 'activityData is required' }, { status: 400 });
  }

  const activityText = formatActivityData(activityData);
  if (!activityText.trim()) {
    return Response.json({ error: 'activity data is empty' }, { status: 400 });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: buildWallHittingPrompt(activityText) }],
    });

    const raw = message.content[0].type === 'text' ? message.content[0].text : '';
    const result: WallHittingResult = JSON.parse(extractJson(raw));
    return Response.json({ result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Analysis API error:', msg);
    return Response.json({ error: 'AI analysis failed', detail: msg }, { status: 500 });
  }
}
