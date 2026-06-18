import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';

import { anthropic, extractJson } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';
import {
  PRESENTATION_EVAL_MAX_TOKENS,
  PRESENTATION_EVAL_MODEL,
  PRESENTATION_EVALUATE_LOG_ROUTE,
  PRESENTATION_LIST_MAX,
  PRESENTATION_LIST_MIN,
} from './constants';
import {
  normalizePresentationFeedback,
  PresentationFeedbackError,
  type PresentationFeedback,
} from './feedbackTypes';

/**
 * STEP-PRESENTATION-PR5: プレゼン AI 評価（PresentationFeedback）生成。
 *
 * 重要:
 *   - 本ファイルは **logAiUsage のみ**。recordUsage は **絶対に呼ばない**（課金は route の
 *     compare-and-set 経路でのみ行う）。lib/billing/usageLog を import しない。
 *   - 失敗（API error / truncation / parse 失敗 / normalize 不一致）はすべて
 *     PresentationFeedbackError を throw する（route で 500 evaluate-failed・保存も課金もしない）。
 */

export type EvaluateInput = {
  transcript: string;
  durationSec: number;
  timeLimitSec: number;
  universityName: string;
  facultyName: string;
  theme: string;
  script: string;
  // 大学選択（任意）。空文字 / null は出力しない。
  departmentName?: string;
  admissionType?: string;
  presentationFormat?: string;
  presentationLimitSec?: number | null;
  universityNotes?: string;
  // AI 即興テーマ（generated）時の発表条件。指定時は評価プロンプトに含める。
  conditions?: string[];
};

// 添付資料の有無で JSON contract と評価観点を切り替える。
function buildSystem(hasMaterial: boolean): string {
  const categoryLines = [
    '  "categories": {                  // 各値は "weak" | "normal" | "strong" のいずれか',
    '    "composition": string,         // 構成力',
    '    "persuasion": string,          // 説得力',
    '    "concreteness": string,        // 具体性',
    '    "clarity": string,             // わかりやすさ',
    '    "timeManagement": string,      // 時間配分（制限時間と実際の発表時間の差をふまえる）',
    hasMaterial
      ? '    "completeness": string,        // 発表の完成度'
      : '    "completeness": string         // 発表の完成度',
    ...(hasMaterial
      ? ['    "materialConsistency": string  // 資料と発表内容の整合性']
      : []),
    '  },',
  ];
  const materialFeedbackLine = hasMaterial
    ? ['  "materialFeedback": string[],    // 資料に関する改善提案（1〜4個。空にしない）']
    : [];

  const base = [
    'あなたは大学入試（総合型選抜・学校推薦型選抜）のプレゼン評価官です。',
    hasMaterial
      ? '受験生のプレゼン発表（文字起こし）・発表条件・添付された発表資料（PDF または画像）をもとに、評価を日本語で作成してください。'
      : '受験生のプレゼン発表（文字起こし）と発表条件をもとに、評価を日本語で作成してください。',
    '出力は次の JSON オブジェクト **のみ**（前後の説明文・コードフェンスなし）:',
    '{',
    ...categoryLines,
    '  "overallComment": string,        // 全体講評の総括（数文）',
    '  "goodPoints": string[],          // 良かった点',
    '  "improvements": string[],        // 改善点',
    '  "nextPractice": string[],        // 次に練習すべきこと',
    ...materialFeedbackLine,
    '}',
    'categories の各値は必ず "weak" / "normal" / "strong" のいずれかにする。数値は出さない。',
    '【出力品質（厳守）】',
    `- goodPoints / improvements / nextPractice は必ずそれぞれ ${PRESENTATION_LIST_MIN}〜${PRESENTATION_LIST_MAX} 個入れ、空配列にしない。`,
    '- 実際の発表内容（文字起こし）・テーマ・志望校 / 学部学科に即した具体的な指摘にする。一般論・テンプレ文の羅列は禁止。',
    '- 同じ内容や同一文の繰り返しを避ける。各項目は異なる観点にし、表現も重複させない。',
    '- overallComment と各配列項目は意味のある日本語にする（単語だけ・空文字は禁止）。',
    '- timeManagement は「制限時間」と「実際の発表時間」の差を根拠に判定する（大きく超過 / 大幅に余す場合は weak 寄り）。',
  ];

  const materialRules = hasMaterial
    ? [
        '【資料評価（厳守）】',
        '- 添付資料の内容を読み取り、次を評価する: 資料と発表内容の一致 / 情報の抜け漏れ / 説明不足 / データの根拠 / 文字量 / 情報量 / 結論の伝わりやすさ。',
        '- materialConsistency は「資料と発表内容の整合性」を weak/normal/strong で示す。',
        '- materialFeedback は資料に関する具体的な改善提案（例: 「スライド3枚目の説明が不足」「データの根拠説明を追加」「文字量を減らすと見やすい」）を 1〜4 個。',
        '- **資料だけで評価してはならない。発表内容（文字起こし）だけで評価してもならない。必ず両方を組み合わせて評価する。**',
      ]
    : [];

  return [...base, ...materialRules].join('\n');
}

function buildUserPrompt(input: EvaluateInput, hasMaterial: boolean): string {
  const opt = (v?: string | null) => (typeof v === 'string' ? v.trim() : '');
  const universityLines = [
    input.universityName.trim() && `大学名: ${input.universityName.trim()}`,
    input.facultyName.trim() && `学部名: ${input.facultyName.trim()}`,
    opt(input.departmentName) && `学科名: ${opt(input.departmentName)}`,
    opt(input.admissionType) && `入試方式: ${opt(input.admissionType)}`,
    opt(input.presentationFormat) && `プレゼン形式: ${opt(input.presentationFormat)}`,
    input.presentationLimitSec
      ? `想定制限時間: ${Math.round(input.presentationLimitSec / 60)} 分`
      : '',
    opt(input.universityNotes) && `備考: ${opt(input.universityNotes)}`,
  ].filter(Boolean);

  // 大学情報があれば「想定する大学・学部・入試方式」を明示する。
  const target = input.universityName.trim()
    ? `この発表は、以下の大学・学部・入試方式を想定したプレゼンです。\n${universityLines.join(
        '\n',
      )}\n${input.theme.trim() ? `プレゼンテーマ: ${input.theme.trim()}` : ''}`.trim()
    : [
        input.theme.trim() && `プレゼンテーマ: ${input.theme.trim()}`,
      ]
        .filter(Boolean)
        .join('\n') || 'プレゼンテーマ・志望校情報なし';

  const timeLine =
    `制限時間: ${input.timeLimitSec} 秒 / 実際の発表時間: ${input.durationSec} 秒`;

  // generated テーマの発表条件があれば「この発表は以下の条件に基づくプレゼンです」を提示。
  const conditions = (input.conditions ?? []).filter((c) => c.trim());
  const conditionLine =
    conditions.length > 0
      ? `この発表は以下の条件に基づくプレゼンです。各条件を満たせているかも評価に含めてください。\n` +
        conditions.map((c) => `- ${c.trim()}`).join('\n') +
        `\n\n`
      : '';

  const scriptLine = input.script.trim()
    ? `発表原稿（任意提出。文字起こしと照合してよい）:\n${input.script.trim()}\n\n`
    : '';

  const materialLine = hasMaterial
    ? '発表資料が添付されています（PDF または画像）。資料と発表内容の両方を必ず参照して評価してください。\n\n'
    : '';

  return (
    `${target}\n${timeLine}\n\n` +
    conditionLine +
    materialLine +
    scriptLine +
    `発表の文字起こし:\n${input.transcript.trim()}\n\n` +
    `上記をもとにプレゼン評価 JSON を出力してください。`
  );
}

// 資料を Claude の content ブロックに変換する（PDF=document / 画像=image）。
function materialBlock(material: {
  mimeType: string;
  base64: string;
}): Anthropic.Messages.ContentBlockParam {
  if (material.mimeType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: material.base64 },
    };
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: material.mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
      data: material.base64,
    },
  };
}

/**
 * プレゼン評価を生成する。logAiUsage のみ。recordUsage は呼ばない。
 * 失敗は PresentationFeedbackError を throw する。
 */
export async function generatePresentationFeedback(
  input: EvaluateInput,
  material?: { mimeType: string; base64: string },
): Promise<PresentationFeedback> {
  const hasMaterial = !!material;
  const userPrompt = buildUserPrompt(input, hasMaterial);
  // 資料がある場合は資料ブロック→テキストの順でマルチモーダル content を組む。
  const content: Anthropic.Messages.MessageParam['content'] = material
    ? [materialBlock(material), { type: 'text', text: userPrompt }]
    : userPrompt;

  let response;
  try {
    response = await anthropic.messages.create({
      model: PRESENTATION_EVAL_MODEL,
      max_tokens: PRESENTATION_EVAL_MAX_TOKENS,
      system: buildSystem(hasMaterial),
      messages: [{ role: 'user', content }],
    });
  } catch {
    logAiUsage({
      route: PRESENTATION_EVALUATE_LOG_ROUTE,
      model: PRESENTATION_EVAL_MODEL,
      status: 'failed',
    });
    throw new PresentationFeedbackError('feedback-generation-failed');
  }

  if (response.stop_reason === 'max_tokens') {
    logAiUsage({
      route: PRESENTATION_EVALUATE_LOG_ROUTE,
      model: PRESENTATION_EVAL_MODEL,
      status: 'truncated',
      usage: response.usage,
    });
    throw new PresentationFeedbackError('feedback-truncated');
  }

  const text = (response.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    logAiUsage({
      route: PRESENTATION_EVALUATE_LOG_ROUTE,
      model: PRESENTATION_EVAL_MODEL,
      status: 'parse_failed',
      usage: response.usage,
    });
    throw new PresentationFeedbackError('feedback-parse-failed');
  }

  let feedback: PresentationFeedback;
  try {
    feedback = normalizePresentationFeedback(parsed, { hasMaterial });
  } catch (err) {
    logAiUsage({
      route: PRESENTATION_EVALUATE_LOG_ROUTE,
      model: PRESENTATION_EVAL_MODEL,
      status: 'parse_failed',
      usage: response.usage,
    });
    // normalize の品質エラーはそのまま伝播（route で evaluate-failed）。
    if (err instanceof PresentationFeedbackError) throw err;
    throw new PresentationFeedbackError('feedback-normalize-failed');
  }

  logAiUsage({
    route: PRESENTATION_EVALUATE_LOG_ROUTE,
    model: PRESENTATION_EVAL_MODEL,
    status: 'success',
    usage: response.usage,
  });
  return feedback;
}
