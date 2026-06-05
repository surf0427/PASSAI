import { anthropic, extractJson } from '@/lib/ai';
import { createTimeoutSignal } from '@/lib/aiTimeout';
import type { BasicInfo } from '@/types/basicInfo';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildEssayUniversityContext } from '@/lib/buildEssayUniversityContext';
import { safeParseResult } from '@/lib/essay/parseEssayReview';
import { logAiUsage } from '@/lib/aiUsageLog';
import { logAiValidation } from '@/lib/aiValidationLog';
import { validateEssayReviewInput } from '@/lib/validation/validateEssayReviewInput';
import { analyzeStructure, type StructureAnalysis } from '@/lib/structureAnalysis';
// STEP-LIB-04: SYSTEM_PROMPT を lib/prompts/essayReviewPrompt.ts に lift した。
// 本 route はそれを import して anthropic.messages.create の system に渡すだけ。
// 文言を変える場合は ESSAY_REVIEW_PROMPT_VERSION（lib/hash/essayReview.ts）を必ず bump すること。
import { ESSAY_REVIEW_SYSTEM_PROMPT } from '@/lib/prompts/essayReviewPrompt';
import { buildPreviousOutputSummarySection } from '@/lib/contextBuilders/divergence/previousOutputSummarySection';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { recordUsage } from '@/lib/billing/usageLog';
import type { PreviousOutputSummary } from '@/types/divergence';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// /api/analysis 系列と同じパターン。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/essay-review';
// STEP-BILLING-06: usage_records.route に入れる識別子 (schema コメント規約に従う)。
const USAGE_ROUTE = 'essay-review';

// 受験方式に応じた小論文添削の方針を生成する。breakdown 構造（5項目固定）には影響を与えず、
// improvement / weakPoints / goodPoints の中身を文脈に沿わせるためだけに使う。
function buildExamTypeEssayGuidance(examTypes: string[] | undefined): string {
  const types = examTypes ?? [];
  const rules: string[] = [];

  if (types.includes('総合型選抜（AO入試）')) {
    rules.push('- 総合型選抜（AO）対策として、思考力・主体性・社会課題との接続を重視する。');
  }
  if (types.includes('学校推薦型選抜（公募・指定校）')) {
    rules.push('- 学校推薦型選抜対策として、高校生活での経験や基礎的な論理性を重視する。難解な専門知識は要求しない。');
  }
  if (types.includes('一般選抜') || types.includes('共通テスト利用')) {
    rules.push('- 一般選抜（共通テスト利用を含む）も併願しているため、汎用性が高く短時間でも書きやすい構成かどうかを評価する。');
  }
  if (types.includes('海外大学受験')) {
    rules.push('- 海外大学受験を含むため、国際的視点・多文化理解への接続も評価軸に加える。');
  }
  if (types.includes('まだ決まっていない')) {
    rules.push('- 受験方式が未確定なため、特定方式に偏らず汎用的な観点で評価する。');
  }
  if (rules.length === 0) return '';
  return ['【受験方式に応じた添削方針】', ...rules].join('\n');
}

// AI 出力 JSON parser / 正規化 (safeParseResult / deriveVerdict / safeStringArray /
// VALID_VERDICTS / VALID_BREAKDOWN_LABELS / FALLBACK_* / ReviewResult / BreakdownItem) は
// lib/essay/parseEssayReview.ts に切り出した。戻り値 shape および fallback 挙動は完全に同一。

// DET-3: deterministic 構造分析結果を AI に "既知" として提示する section。
// 再判定 / 重複指摘を抑えて、改善提案 / 具体例 / improvement の質に token を割かせる目的。
// analyzeStructure は常に 6 要素を返す pure 関数（lib/structureAnalysis.ts）。
// 万一空配列が来た場合は空文字を返し、section を出さない（旧 v2 と意味等価）。
// 各要素は `type: score` の 1 行形式で出力する（簡潔さ優先、reason / hint は AI 側の責務として残す）。
function buildStructureAnalysisSection(analyses: StructureAnalysis[]): string {
  if (analyses.length === 0) return '';
  const lines = analyses.map((a) => `${a.type}: ${a.score}`);
  return [
    '【既存構造分析】',
    '',
    ...lines,
    '',
    '以下は deterministic 構造分析結果です。',
    'これらを再判定するのではなく、改善提案や具体例作成に注力してください。',
  ].join('\n');
}

// SYSTEM_PROMPT（ESSAY_REVIEW_SYSTEM_PROMPT）は lib/prompts/essayReviewPrompt.ts に lift 済み（STEP-LIB-04）。
// 役割（不変）: 役割宣言 / 採点軸 5 項目 / verdict 4 種 / スコアルール / 出力 JSON ルール / トーン規律 / 長さ上限 / 出力スキーマ例。
// 本 route は ESSAY_REVIEW_SYSTEM_PROMPT を import して anthropic.messages.create の system に渡すだけ。
// userMessage（可変部）は下記 POST handler 内で組み立てる。
export async function POST(req: Request) {
  const body = await req.json();
  const theme: string = body.theme ?? '';
  const conclusion: string = body.conclusion ?? '';
  const reasonOne: string = body.reasonOne ?? '';
  const reasonTwo: string = body.reasonTwo ?? '';
  const essayBody: string = body.essayBody ?? '';
  // basicInfo は任意。未送信や形が不正でも null として扱う。
  const basicInfo: BasicInfo | null = body.basicInfo ?? null;
  // STEP-DIVERGENCE-02B: client が workspace.reviews[] の compact projection を
  // buildPreviousOutputSummary() に通して送ってきた divergence context。
  // 未送信なら null（完全後方互換 = section を出さない）。route 内で localStorage /
  // Supabase は一切読まない（client が build 済みの struct をそのまま section へ流す）。
  const previousOutputSummary: PreviousOutputSummary | null = body.previousOutputSummary ?? null;

  // V-6: client validator の最終防衛線。AI call / prompt build / aiUsageLog 未到達で 400。
  const validation = validateEssayReviewInput(essayBody);
  if (!validation.ok) {
    logAiValidation({
      type: 'validation_reject',
      route: 'essay-review',
      code: validation.code,
    });
    return Response.json({ error: validation.message }, { status: 400 });
  }

  // STEP-BILLING-06: Plan Gate。バリデーション後 / AI call 前に実施。
  const gate = await ensurePlanQuota('essay');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  const basicInfoSection = buildBasicInfoPromptSection(basicInfo);
  const examTypeGuidance = buildExamTypeEssayGuidance(basicInfo?.examTypes);
  const firstPreference = basicInfo?.preferences?.[0];
  const essayUniversityContext = buildEssayUniversityContext({
    university: firstPreference?.university ?? '',
    faculty: firstPreference?.faculty ?? '',
    department: firstPreference?.department ?? '',
  });
  // DET-3: 構造 6 要素を deterministic に事前検出し prompt に「既知」として渡す。
  // essayBody から純関数（lib/structureAnalysis.ts）で派生するため hash 入力には追加不要。
  // 同 essayBody → 同 structure → 同 prompt body の関係で cache identity に drift をもたらさない。
  // AI が同じ 6 要素を再 discovery する往復コストを削減し、改善提案 / 具体例作成に token を割けるようにする。
  const structureSection = buildStructureAnalysisSection(analyzeStructure(essayBody));
  // STEP-DIVERGENCE-02B: 過去に提示済みフィードバック section。空なら空文字（履歴 0/1 件・
  // 未送信＝旧挙動と等価）。SYSTEM_PROMPT 側の ESSAY_REVIEW_PREVIOUS_OUTPUT_QUALIFIER と組で動く。
  // 実データは user message にだけ載せ、system（cache 対象）には入れない（prompt cache 維持）。
  const previousOutputSection = buildPreviousOutputSummarySection(previousOutputSummary);

  const userMessage = `以下の小論文を採点・添削してください。

${basicInfoSection}

${essayUniversityContext ? `${essayUniversityContext}\n\n` : ''}${examTypeGuidance ? `${examTypeGuidance}\n\n` : ''}【テーマ】
${theme || '（未入力）'}

【生徒の結論（1文）】
${conclusion || '（未入力）'}

【理由①】
${reasonOne || '（未入力）'}

【理由②】
${reasonTwo || '（未入力）'}

${structureSection ? `${structureSection}\n\n` : ''}${previousOutputSection ? `${previousOutputSection}\n\n` : ''}【本文】
${essayBody}`;

  try {
    // STEP2.7: Anthropic prompt caching を system 部にのみ適用する（STEP2.4 と同じパターン）。
    //   - ESSAY_REVIEW_SYSTEM_PROMPT は採点軸・JSON schema・出力ルール・トーン規律など毎回不変の static 部
    //   - userMessage は essayBody / theme / 結論 / 理由 / basicInfo / universityContext と
    //     毎回変化する動的データを含むため cache_control は付けない
    //   → system のみキャッシュ対象とすることで、5 分以内の連続添削で input 単価を ~90% 割引
    //     にできる（Anthropic prompt caching 仕様）。
    //   SDK: @anthropic-ai/sdk@0.91.1 で cache_control: { type: 'ephemeral' } を型安全に指定可能。
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      temperature: 0.2,
      system: [
        {
          type: 'text',
          text: ESSAY_REVIEW_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    }, { signal: createTimeoutSignal() });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    // max_tokens で途中終了している場合、JSON はほぼ確実に壊れている。safeParseResult が
    // 静的フォールバックに落とすため raw text 自体は露出しないが、ユーザーには「点数 0 ・
    // 既定の改善提案」が出るだけで添削が動かなかった事実が伝わらない。明示エラーで弾く。
    if (message.stop_reason === 'max_tokens') {
      console.error('essay-review truncated', {
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

    // essay-review は parse 失敗時も safeParseResult で fallback して 200 を返す既存 control flow を維持する。
    // ただし usage log では「parse が壊れた事実」を区別したいので、flag で status を分岐させる。
    let parsed: unknown = {};
    let parseOk = true;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      parseOk = false;
      console.error('essay-review: JSON parse failed. rawTextTail:', text.slice(-200));
    }

    logAiUsage({
      route: ROUTE,
      model: MODEL,
      status: parseOk ? 'success' : 'parse_failed',
      usage: message.usage,
      cache_creation_input_tokens: message.usage?.cache_creation_input_tokens,
      cache_read_input_tokens: message.usage?.cache_read_input_tokens,
    });
    // STEP-BILLING-06: parse 失敗はユーザーが本来の AI 出力を得ていないため
    // quota は消費させない (status='error')。parse 成功時のみ ok でカウントする。
    await recordUsage({
      userId,
      route: USAGE_ROUTE,
      model: MODEL,
      status: parseOk ? 'ok' : 'error',
    });
    return Response.json(safeParseResult(parsed));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('essay-review API error:', msg);
    // 例外経路: messages.create() が throw した時点で response が無いため usage は取れない。
    // status のみログして「失敗回数」が集計できる状態にする（analysis 系列と共通方針）。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
    return Response.json(
      { error: 'AIの処理に失敗しました。時間をおいてお試しください。' },
      { status: 500 }
    );
  }
}
