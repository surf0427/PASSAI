import { anthropic, extractJson } from '@/lib/ai';
import { createTimeoutSignal } from '@/lib/aiTimeout';
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
import { logAiValidation } from '@/lib/aiValidationLog';
import { validateStatementReviewInput } from '@/lib/validation/validateStatementReviewInput';
import { detectNgWords } from '@/lib/detectNgWords';
import { analyzeStructure } from '@/lib/structureAnalysis';
import { buildThemeFrequency } from '@/lib/contextBuilders/divergence/buildThemeFrequency';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { recordUsage } from '@/lib/billing/usageLog';
import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { WallHittingResult } from '@/types/analysis';
import type { StudentProfile } from '@/types/studentProfile';
import type { PreviousOutputSummary, UnusedExperience } from '@/types/divergence';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// /api/analysis 系列と同じパターン。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/statement-review';
// STEP-BILLING-06: usage_records.route に入れる識別子。
// schema コメント (supabase/schema.sql §30) 規約: app/api/<name>/route.ts の <name>。
const USAGE_ROUTE = 'statement-review';

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
  // STEP-DIVERGENCE-02A: client が statementReviewHistory の compact projection を
  // buildPreviousOutputSummary() に通して送ってきた divergence context。
  // 未送信なら null（完全後方互換 = section を出さない）。route 内で localStorage /
  // Supabase は一切読まない（client が build 済みの struct をそのまま prompt builder へ流す）。
  const previousOutputSummary: PreviousOutputSummary | null = body.previousOutputSummary ?? null;
  // STEP-DIVERGENCE-04B: client(edit page) が activityData × 使用面から決定論派生した
  // 「まだ活用できていない可能性のある経験」struct。未送信なら null（完全後方互換 = section なし）。
  // route 内で localStorage / Supabase は読まない（client が build 済みの struct をそのまま渡す）。
  const unusedExperience: UnusedExperience | null = body.unusedExperience ?? null;

  // V-6: client validator の最終防衛線。同じ deterministic rule を server でも適用する。
  // direct API call / stale client / bypassed JS で invalid 入力が到達した場合に AI call /
  // prompt build / aiUsageLog すべて未到達のまま 400 で返す。response shape は不変。
  const validation = validateStatementReviewInput(essay);
  if (!validation.ok) {
    logAiValidation({
      type: 'validation_reject',
      route: 'statement-review',
      code: validation.code,
    });
    return Response.json({ error: validation.message }, { status: 400 });
  }

  // STEP-BILLING-06: Plan Gate。バリデーション後 / AI call 前に実施。
  // 401 (未認証) / 402 (quota-exceeded) / 500 (内部エラー) は本ヘルパが組み立てる。
  const gate = await ensurePlanQuota('statement');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  try {
    // STEP3.2: static rule（役割宣言・採点ルール・JSON schema 等）を system に切り出した。
    //   - STATEMENT_REVIEW_SYSTEM_PROMPT は毎回不変
    //   - buildStatementReviewPrompt(...) は dynamic 部だけ（basicInfo / university / activity /
    //     wallHitting / examTypeGuidance / essay 本文）
    //   model / max_tokens / temperature / messages の role と shape は STEP3.1 から不変。
    //   prompt caching (cache_control: 'ephemeral') 配備済み（STEP-API-CACHE-01）。
    //   STEP-API-MEASURE-01 で system prompt が ~3,614 chars / ~1,800 tokens（中央推定）と
    //   Sonnet 4-6 の 1,024 tokens 閾値を確実に上回ることを確認したうえで配備した。
    //   5 分以内の連続「再添削」呼び出しで input cache hit による単価割引が期待される。
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
            // DET-2: NG 指摘を deterministic に事前検出し prompt に「既知」として渡す。
            // essay / activityData / university / faculty から純関数で派生するため、
            // hash 入力に追加せずとも同入力 → 同 NG → 同 prompt body が成立し
            // cache identity に drift をもたらさない。同 phrase を AI が再 discovery する
            // 往復コストを削減し、改善提案 / 構造分析に token を割けるようにする。
            ngIssues: detectNgWords(essay, activityData, university, faculty),
            // DET-4: 構造 6 要素を deterministic に事前検出し prompt に「既知」として渡す。
            // essay のみから純関数（lib/structureAnalysis.ts）で派生するため hash 入力には
            // 追加不要。同 essay → 同 structure → 同 prompt body の関係で cache identity に
            // drift をもたらさない。DET-2 の NG section と独立 / 共存させ、AI が両者を踏まえた
            // 重複しない指摘 / 具体例 / 行動レベル actions に token を割けるようにする。
            structureAnalysis: analyzeStructure(essay),
            // STEP-DIVERGENCE-02A: 過去に提示済みフィードバックの divergence context。
            // DET-2/DET-4 と違い statementReviewHistory（時間で変化する出力）由来のため、
            // client 側で hash 入力にも含めて app-cache を履歴変化時に miss させている。
            previousOutputSummary,
            // STEP-DIVERGENCE-03A: ユーザーのテーマ偏り（activityData + studentProfile から
            // 決定論派生）。DET-2/DET-4 と同型で、既に hash 済みの入力からの派生のため hash field は
            // 増やさず PROMPT_VERSION bump のみで cache lane を分離する。AI review 出力は数えない
            // （PreviousOutputSummary との二重計上回避）。route 側で localStorage / Supabase は読まない。
            themeFrequency: buildThemeFrequency({ activityData, studentProfile }),
            // STEP-DIVERGENCE-04B: まだ活用できていない可能性のある経験（client build・body 経由）。
            // usedText が hash 外・時間変化 source を含むため client 側で hash 入力にも含めている。
            unusedExperience,
          }),
        },
      ],
    }, { signal: createTimeoutSignal() });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    // max_tokens で途中終了した出力は JSON が壊れているため明示エラーで弾く。
    // raw text を返さず、ユーザーには再試行を促すメッセージを出す。
    if (message.stop_reason === 'max_tokens') {
      console.error('statement-review truncated', {
        stopReason: message.stop_reason,
        rawTextTail: text.slice(-200),
      });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
      await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
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
      logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
      await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'ok' });
      return Response.json(result);
    } catch {
      console.error('statement-review parse failed', { rawTextTail: text.slice(-200) });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
      await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
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
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
    return Response.json({ error: 'AIの処理に失敗しました。時間をおいてお試しください。' }, { status: 500 });
  }
}
