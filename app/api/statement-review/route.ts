import { anthropic, extractJson } from '@/lib/ai';
import { buildStatementReviewPrompt } from '@/lib/statementPrompt';
import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { WallHittingResult } from '@/types/analysis';

export async function POST(req: Request) {
  const body = await req.json();
  const university: string = body.university ?? '';
  const faculty: string = body.faculty ?? '';
  const department: string = body.department ?? '';
  const essay: string = body.essay ?? '';
  // 補助情報は任意。未送信や形が不正でも null として扱い、プロンプト側でフォールバックする。
  const basicInfo: BasicInfo | null = body.basicInfo ?? null;
  const activityData: ActivityData | null = body.activityData ?? null;
  const wallHittingResult: WallHittingResult | null = body.wallHittingResult ?? null;

  if (!essay.trim()) {
    return Response.json({ error: '志望理由書本文を入力してください' }, { status: 400 });
  }
  if (essay.trim().length < 100) {
    return Response.json({ error: '志望理由書本文を100文字以上入力してください' }, { status: 400 });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: buildStatementReviewPrompt({
            university,
            faculty,
            department,
            essay,
            basicInfo,
            activityData,
            wallHittingResult,
          }),
        },
      ],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const json = extractJson(text);
    const result = JSON.parse(json);

    return Response.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('statement-review API error:', msg);
    return Response.json({ error: 'AIの処理に失敗しました。時間をおいてお試しください。' }, { status: 500 });
  }
}
