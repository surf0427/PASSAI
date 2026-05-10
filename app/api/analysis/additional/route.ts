import type { ActivityData } from '@/types/activity';
import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';
import { formatActivityData } from '@/lib/formatActivity';
import { buildAdditionalQuestionsPrompt } from '@/lib/prompts';
import { anthropic, extractJson } from '@/lib/ai';
import { buildUniversityContextFromBasicInfo } from '@/lib/buildUniversityContext';

export async function POST(req: Request) {
  const body = await req.json();
  const activityData: ActivityData | undefined = body.activityData;
  const existingQuestions: string[] = body.existingQuestions ?? [];
  const basicInfo: BasicInfo | null = body.basicInfo ?? null;
  // TODO: 将来は basicInfo から大学DB検索を経由して UniversityContext を enrich する。
  const universityContext: UniversityContext | null =
    body.universityContext ?? buildUniversityContextFromBasicInfo(basicInfo);

  if (!activityData) {
    return Response.json({ error: 'activityData is required' }, { status: 400 });
  }

  const activityText = formatActivityData(activityData);

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: buildAdditionalQuestionsPrompt({
            activityText,
            existingQuestions,
            basicInfo,
            universityContext,
          }),
        },
      ],
    });

    const raw = message.content[0].type === 'text' ? message.content[0].text : '';
    const result = JSON.parse(extractJson(raw));
    return Response.json({ questions: result.questions as string[] });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Additional questions API error:', msg);
    return Response.json(
      { error: '質問の追加生成に失敗しました', detail: msg },
      { status: 500 },
    );
  }
}
