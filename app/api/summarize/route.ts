import type { ActivityData } from '@/types/activity';
import type { WallHittingResult, SummaryResult } from '@/types/analysis';
import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';
import { formatActivityData } from '@/lib/formatActivity';
import { buildSummarizePrompt } from '@/lib/prompts';
import { anthropic, extractJson } from '@/lib/ai';
import { buildUniversityContextFromBasicInfo } from '@/lib/buildUniversityContext';

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

  const activityText = formatActivityData(activityData);

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      temperature: 0.5,
      messages: [
        {
          role: 'user',
          content: buildSummarizePrompt({
            activityText,
            analysis,
            answers,
            basicInfo,
            universityContext,
          }),
        },
      ],
    });

    const raw = message.content[0].type === 'text' ? message.content[0].text : '';
    const summary: SummaryResult = JSON.parse(extractJson(raw));
    return Response.json({ summary });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Summarize API error:', msg);
    return Response.json({ error: 'AI summarize failed', detail: msg }, { status: 500 });
  }
}
