import { anthropic, extractJson } from '@/lib/ai';
import {
  STATEMENT_REVIEW_SYSTEM_PROMPT,
  buildStatementReviewPrompt,
} from '@/lib/statement/review/statementPrompt';
import { getStudentProfileFromRequest } from '@/lib/getStudentProfileFromRequest';
// admissionFocus wiring (getAdmissionFocusContextForUser) は PR9 で
// lib/admissionFocus/* の commit と同時に再導入する。本 PR では未接続。
// buildStatementReviewPrompt の admissionFocusContext は optional のため、
// 渡さなければ prompt 側で section が出ない（旧 v2 と意味等価）。
import { logAiUsage } from '@/lib/aiUsageLog';
import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { WallHittingResult } from '@/types/analysis';
import type { StudentProfile } from '@/types/studentProfile';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// /api/analysis 系列と同じパターン。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/statement-review';

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
  // 新規: クライアントが localStorage の canonical StudentProfile を送ってきた場合に受ける。
  // 形が壊れていれば null として扱い、wallHittingResult 側 fallback に任せる。
  const studentProfile: StudentProfile | null = getStudentProfileFromRequest({ body });

  if (!essay.trim()) {
    return Response.json({ error: '志望理由書本文を入力してください' }, { status: 400 });
  }
  if (essay.trim().length < 100) {
    return Response.json({ error: '志望理由書本文を100文字以上入力してください' }, { status: 400 });
  }

  try {
    // STEP3.2: static rule（役割宣言・採点ルール・JSON schema 等）を system に切り出した。
    //   - STATEMENT_REVIEW_SYSTEM_PROMPT は毎回不変
    //   - buildStatementReviewPrompt(...) は dynamic 部だけ（basicInfo / university / activity /
    //     wallHitting / examTypeGuidance / essay 本文）
    //   model / max_tokens / temperature / messages の role と shape は STEP3.1 から不変。
    //   prompt caching (cache_control) はまだ付けない（STEP3.1 調査で system が ~1,589 tokens と
    //   Sonnet 4-6 の実効 caching 閾値を下回るため）。
    // STEP4b（admissionFocusContext）は PR9 で lib/admissionFocus/* と同時に有効化する。
    // 現状は buildStatementReviewPrompt に admissionFocusContext を渡さず、prompt 側の
    // optional section をスキップしている。旧 v2 と意味等価。
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      temperature: 0.3,
      system: [
        {
          type: 'text',
          text: STATEMENT_REVIEW_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
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
            // canonical を優先、無ければ wallHittingResult から派生する fallback を prompt 側で行う。
            studentProfile,
            wallHittingResult,
            // admissionFocusContext は PR9 で再導入。現状は省略で optional skip。
          }),
        },
      ],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    // max_tokens で途中終了した出力は JSON が壊れているため明示エラーで弾く。
    // raw text を返さず、ユーザーには再試行を促すメッセージを出す。
    if (message.stop_reason === 'max_tokens') {
      console.error('statement-review truncated', {
        stopReason: message.stop_reason,
        rawTextTail: text.slice(-200),
      });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage });
      return Response.json(
        {
          error: 'AI_REVIEW_TRUNCATED',
          message: 'AIの添削結果が途中で終了しました。もう一度お試しください。',
        },
        { status: 502 },
      );
    }

    try {
      const json = extractJson(text);
      const result = JSON.parse(json);
      logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage });
      return Response.json(result);
    } catch {
      console.error('statement-review parse failed', { rawTextTail: text.slice(-200) });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: message.usage });
      return Response.json(
        {
          error: 'AI_REVIEW_PARSE_FAILED',
          message: 'AIの出力を正しく読み取れませんでした。もう一度お試しください。',
        },
        { status: 502 },
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('statement-review API error:', msg);
    // 例外経路: messages.create() が throw した時点で response が無いため usage は取れない。
    // status のみログして「失敗回数」が集計できる状態にする（analysis 系列と共通方針）。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    return Response.json({ error: 'AIの処理に失敗しました。時間をおいてお試しください。' }, { status: 500 });
  }
}
