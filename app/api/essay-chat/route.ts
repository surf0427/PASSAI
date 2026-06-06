import { anthropic } from '@/lib/ai';
import type { BasicInfo } from '@/types/basicInfo';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildEssayUniversityContext } from '@/lib/buildEssayUniversityContext';
import { logAiUsage } from '@/lib/aiUsageLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { createTimeoutSignal } from '@/lib/aiTimeout';
import { checkMaxLengths } from '@/lib/validation/checkMaxLengths';
import { INPUT_MAX_LENGTHS } from '@/lib/validation/inputLimits';
// STEP-LIB-05: SYSTEM_PROMPT を lib/prompts/essayChatPrompt.ts に lift した。
// 本 route はそれを import して anthropic.messages.create の system に渡すだけ。
// essay-chat は cache を持たないため PROMPT_VERSION bump 対象外。文言改修は PR description で明示する。
import { ESSAY_CHAT_SYSTEM_PROMPT } from '@/lib/prompts/essayChatPrompt';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { recordUsage } from '@/lib/billing/usageLog';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// /api/analysis 系列と同じパターン。
// 本 route は plain text 応答（JSON parse なし）のため parse_failed は発生しない。
const MODEL = 'claude-sonnet-4-6';
// M4: Vercel 実行時間上限。AI timeout（lib/aiTimeout.ts = 60s）+ 余裕。Pro 前提
// （Hobby は 60s 上限で AI timeout を吸収できない）。runtime は既定 nodejs（edge 不可）。
export const maxDuration = 80;

const ROUTE = 'api/essay-chat';
const USAGE_ROUTE = 'essay-chat';

// SYSTEM_PROMPT（ESSAY_CHAT_SYSTEM_PROMPT）は lib/prompts/essayChatPrompt.ts に lift 済み（STEP-LIB-05）。
// 役割（不変）: 役割宣言 / 禁止 4 項目 / やること 4 種 / 生徒の志望情報の踏まえ方 / 出力ルール。
// 本 route は ESSAY_CHAT_SYSTEM_PROMPT を import して anthropic.messages.create の system に渡すだけ。
// userMessage（可変部）は下記 POST handler 内で組み立てる。

export async function POST(req: Request) {
  const body = await req.json();
  const theme: string = body.theme ?? '';
  const conclusion: string = body.conclusion ?? '';
  const reasonOne: string = body.reasonOne ?? '';
  const reasonTwo: string = body.reasonTwo ?? '';
  const essayBody: string = body.essayBody ?? '';
  const userQuestion: string = body.userQuestion ?? '';
  // basicInfo は任意。未送信や形が不正でも null として扱う。
  const basicInfo: BasicInfo | null = body.basicInfo ?? null;

  if (!userQuestion.trim()) {
    return Response.json({ error: '質問を入力してください' }, { status: 400 });
  }

  // B2: prompt に埋め込む自由記述の最大長ガード。AI call / quota 前に弾く。
  const lengthCheck = checkMaxLengths([
    { label: '質問', value: userQuestion, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '本文', value: essayBody, max: INPUT_MAX_LENGTHS.ESSAY },
    { label: 'テーマ', value: theme, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '結論', value: conclusion, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '理由1', value: reasonOne, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '理由2', value: reasonTwo, max: INPUT_MAX_LENGTHS.TEXT },
  ]);
  if (!lengthCheck.ok) {
    return Response.json({ error: lengthCheck.message }, { status: 400 });
  }

  // STEP-GATE-COMPLETE: Plan Gate (essay feature)。validation 後 / AI 前。
  const gate = await ensurePlanQuota('essay');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  const basicInfoSection = buildBasicInfoPromptSection(basicInfo);
  const firstPreference = basicInfo?.preferences?.[0];
  const essayUniversityContext = buildEssayUniversityContext({
    university: firstPreference?.university ?? '',
    faculty: firstPreference?.faculty ?? '',
    department: firstPreference?.department ?? '',
  });

  const userMessage = `${basicInfoSection}

${essayUniversityContext ? `${essayUniversityContext}\n\n` : ''}【テーマ】
${theme}

【生徒の結論（1文）】
${conclusion || '（未記入）'}

【生徒の理由①】
${reasonOne || '（未記入）'}

【生徒の理由②】
${reasonTwo || '（未記入）'}

【生徒の本文】
${essayBody || '（未記入）'}

【生徒の相談内容】
${userQuestion}`;

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      // 暫定: 120 だと日本語で 1〜2 文を出し切る前に max_tokens で切れて単語の途中で
      // 終わる事故が出ていた。400 に引き上げ、加えて下の stop_reason ガードで途中切れを弾く。
      // 長期的にはプロンプトで字数を絞ったうえで再度下げる余地あり。
      max_tokens: 400,
      temperature: 0.3,
      system: ESSAY_CHAT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    }, { signal: createTimeoutSignal() });

    // max_tokens で途中終了した reply はそのままだと単語の途中で切れて表示されるため、
    // 文字列として返さずに 502 + ユーザー向けメッセージで弾く。
    if (message.stop_reason === 'max_tokens') {
      const rawTail = message.content[0].type === 'text' ? message.content[0].text.slice(-200) : '';
      console.error('essay-chat truncated', { stopReason: message.stop_reason, rawTextTail: rawTail });
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

    const reply = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'ok' });
    return Response.json({ reply });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('essay-chat API error:', msg);
    // 例外経路: messages.create() が throw した時点で response が無いため usage は取れない。
    // status のみログして「失敗回数」を集計できる状態にする（analysis 系列と共通方針）。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
    captureRouteException(error, { route: ROUTE, feature: 'ai', status: 500 }, { status: 500, code: 'AI_REQUEST_FAILED' });
    return Response.json({ error: 'AIの処理に失敗しました。時間をおいてお試しください。' }, { status: 500 });
  }
}
