import type { ActivityData } from '@/types/activity';
import type { AnalysisResult } from '@/types/analysis';
import { formatActivityData } from '@/lib/formatActivity';
import { buildAnalyzePrompt } from '@/lib/prompts';
import { anthropic, extractJson } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// NOTE: STEP4.10 時点で grep ベースのクライアント検索では本 route の呼び出し元が見つからなかった。
// /api/analysis に置き換えられた dead code の可能性がある（今回は観測優先のため削除はしない）。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/analyze';

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
    // STEP4.10: 既存 control flow を変えずに観測する。messages.create() と JSON.parse を
    // 個別 try/catch で囲み、log → re-throw で外側の既存 catch に届ける。レスポンス shape /
    // status code は完全維持。truncation は parse 失敗の catch 内で stop_reason から区別する
    //（既存 route は truncation の明示チェックを持っていないため、新しい early return は追加しない）。
    let message;
    try {
      message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1000,
        temperature: 0.5,
        messages: [{ role: 'user', content: buildAnalyzePrompt(activityText) }],
      });
    } catch (error) {
      logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
      throw error;
    }

    const raw = message.content[0].type === 'text' ? message.content[0].text : '';
    let analysis: AnalysisResult;
    try {
      analysis = JSON.parse(extractJson(raw)) as AnalysisResult;
    } catch (error) {
      logAiUsage({
        route: ROUTE,
        model: MODEL,
        status: message.stop_reason === 'max_tokens' ? 'truncated' : 'parse_failed',
        usage: message.usage,
      });
      throw error;
    }

    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage });
    return Response.json({ analysis });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Analyze API error:', msg);
    // inner で具体 status を log 済みのため、ここでは追加 log しない（double-log 回避）。
    return Response.json({ error: 'AI analysis failed', detail: msg }, { status: 500 });
  }
}
