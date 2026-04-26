import type { WallHittingResult } from '@/types/analysis';
import type { MatchingResult } from '@/types/matching';
import { anthropic, extractJson } from '@/lib/ai';

// AI が生成する各大学への強化アドバイス
export type AiMatchAdvice = {
  universityId: string;
  reason: string;
  strengthPoints: string[];
  weaknesses: string[];
  actionItems: string[];
};

function buildMatchingPrompt(
  wallHitting: WallHittingResult,
  results: MatchingResult[],
): string {
  const universitiesText = results
    .map(
      (r) => `
大学ID: ${r.university.id}
大学名: ${r.university.name}（${r.university.faculty}）
入試方式: ${r.university.admissionType}
スコア: ${r.score}点
特徴: ${r.university.description}
タグ: ${r.university.tags.join('・')}
スコア内訳: ${r.scoreBreakdown.items
        .map((i) => `${i.label}（生徒:${i.studentScore} / 大学要求:${i.required}）`)
        .join('、')}`,
    )
    .join('\n---');

  return `あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。
以下の生徒のAI分析結果と志望校マッチングデータをもとに、各大学への受験アドバイスを生成してください。

【生徒のAI分析】
活動ストーリー: ${wallHitting.summary}

強み:
${wallHitting.strengths.map((s) => `・${s}`).join('\n')}

弱み・補強ポイント:
${wallHitting.weaknesses.map((w) => `・${w}`).join('\n')}

将来とのつながり:
${wallHitting.futureConnections.map((f) => `・${f}`).join('\n')}

【各大学のスコア情報】
${universitiesText}

各大学に対して以下をJSON配列で出力してください。
- reason: なぜこの生徒にこの大学が合うか（または課題があるか）を2〜3文で。生徒の具体的な強みや弱みに必ず言及すること。
- strengthPoints: この大学との相性が良い点（1〜2個の配列）
- weaknesses: この大学に向けて補強が必要な点（1〜2個の配列）
- actionItems: 今から具体的にやるべきアクション（2〜3個の配列。「〜する」で終わる文）

【出力形式（JSONのみ。前後の説明文やコードブロックは一切不要）】
[
  {
    "universityId": "大学のid",
    "reason": "...",
    "strengthPoints": ["..."],
    "weaknesses": ["..."],
    "actionItems": ["..."]
  }
]`;
}

export async function POST(req: Request) {
  const body = await req.json();
  const wallHitting: WallHittingResult | undefined = body.wallHitting;
  const results: MatchingResult[] | undefined = body.results;

  if (!wallHitting || !results || results.length === 0) {
    return Response.json({ error: 'wallHitting and results are required' }, { status: 400 });
  }

  // 上位5件のみAI強化（コスト・速度のバランス）
  const topResults = results.slice(0, 5);

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: buildMatchingPrompt(wallHitting, topResults) }],
    });

    const raw = message.content[0].type === 'text' ? message.content[0].text : '';
    const advices: AiMatchAdvice[] = JSON.parse(extractJson(raw));
    return Response.json({ advices });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Matching AI error:', msg);
    return Response.json({ error: 'AI matching failed', detail: msg }, { status: 500 });
  }
}
