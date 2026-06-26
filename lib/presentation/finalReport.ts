import 'server-only';

import { anthropic, extractJson } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';
import {
  PRESENTATION_EVAL_MODEL,
  PRESENTATION_FINAL_COMMENT_MIN_CHARS,
  PRESENTATION_FINAL_REPORT_LOG_ROUTE,
  PRESENTATION_FINAL_REPORT_MAX_TOKENS,
} from './constants';
import type { QaContext } from './qa';

/**
 * STEP-PRESENTATION: 最終評価レポート（プレゼン + Q&A の締め）の AI 生成。
 *
 * 大学・企業の面接官が返す評価レポート相当の品質を狙う。点数（100点満点）・ランク・各項目スコア・
 * 具体引用つきの良かった点/改善点・プレゼン/Q&A の個別レビュー・最終総評（長文）・改善プラン・
 * 合格可能性（参考）を 1 つの JSON で生成する。
 *
 * 根拠は「今回のテーマ・プレゼン文字起こし・今回の Q&A」のみ。テンプレ・一般論・存在しない内容は禁止。
 * 課金は呼び出し側の責務ではなく Q&A 系と同じく非消費（logAiUsage のみ）。
 */

export class FinalReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinalReportError';
  }
}

export type FinalReportRank = 'S' | 'A' | 'B' | 'C' | 'D';

// 各項目スコア（0-100）の軸。
export const FINAL_REPORT_SCORE_KEYS = [
  'themeUnderstanding', // テーマ理解
  'logicalStructure', // 論理構成
  'depth', // 内容の深さ
  'persuasion', // 説得力
  'concreteExample', // 具体例
  'timeManagement', // 時間配分
  'delivery', // 話し方
  'qaHandling', // Q&A対応力
] as const;

export type FinalReportScoreKey = (typeof FINAL_REPORT_SCORE_KEYS)[number];

export const FINAL_REPORT_SCORE_LABELS: Record<FinalReportScoreKey, string> = {
  themeUnderstanding: 'テーマ理解',
  logicalStructure: '論理構成',
  depth: '内容の深さ',
  persuasion: '説得力',
  concreteExample: '具体例',
  timeManagement: '時間配分',
  delivery: '話し方',
  qaHandling: 'Q&A対応力',
};

export type FinalReportImprovement = { point: string; reason: string };
export type FinalReportPlanItem = {
  priority: number;
  title: string;
  today: string;
  tomorrow: string;
};

export type PresentationFinalReport = {
  totalScore: number; // 0-100
  rank: FinalReportRank;
  categoryScores: Record<FinalReportScoreKey, number>; // 各 0-100
  goodPoints: string[]; // >=5・具体引用
  improvements: FinalReportImprovement[]; // >=5・重要度順・なぜ上がるか
  presentationReview: string; // プレゼンのみの詳細レビュー
  qaReview: string; // Q&A のみの詳細レビュー
  finalComment: string; // 最終総評（長文）
  improvementPlan: FinalReportPlanItem[]; // 優先順位つき・今日/明日
  passProbabilityStars: number; // 1-5（参考）
  passProbabilityNote: string; // 参考の根拠・但し書き
};

export type FinalReportInput = {
  ctx: QaContext;
  pairs: { question: string; answer: string }[];
  durationSec: number;
  timeLimitSec: number;
};

function clampScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ランクはスコアから決定論的に導出（AI 出力のランクとスコアの不一致を防ぐ）。
function rankFromScore(score: number): FinalReportRank {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function cleanImprovements(value: unknown, max: number): FinalReportImprovement[] {
  if (!Array.isArray(value)) return [];
  const out: FinalReportImprovement[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const point = typeof o.point === 'string' ? o.point.trim() : '';
    const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
    if (!point || !reason) continue;
    out.push({ point, reason });
    if (out.length >= max) break;
  }
  return out;
}

function cleanPlan(value: unknown, max: number): FinalReportPlanItem[] {
  if (!Array.isArray(value)) return [];
  const out: FinalReportPlanItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    const today = typeof o.today === 'string' ? o.today.trim() : '';
    const tomorrow = typeof o.tomorrow === 'string' ? o.tomorrow.trim() : '';
    if (!title || !today || !tomorrow) continue;
    out.push({ priority: out.length + 1, title, today, tomorrow });
    if (out.length >= max) break;
  }
  return out;
}

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim();
}

function buildContextLines(input: FinalReportInput): string {
  const { ctx } = input;
  const parts: string[] = [];
  if (ctx.universityName.trim()) parts.push(`志望校: ${ctx.universityName.trim()}`);
  if (ctx.facultyName.trim()) parts.push(`学部学科: ${ctx.facultyName.trim()}`);
  parts.push(`今回のプレゼンテーマ: ${ctx.theme.trim()}`);
  parts.push(
    `制限時間: ${input.timeLimitSec} 秒 / 実際の発表時間: ${input.durationSec} 秒`,
  );
  if (ctx.categories && typeof ctx.categories === 'object') {
    const cats = Object.entries(ctx.categories)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => `${k}=${v as string}`)
      .join(', ');
    if (cats) parts.push(`プレゼン評価カテゴリ（参考）: ${cats}`);
  }
  if (ctx.overallComment && ctx.overallComment.trim()) {
    parts.push(`プレゼン評価の総評（参考）: ${ctx.overallComment.trim()}`);
  }
  return parts.join('\n');
}

/**
 * 最終評価レポートを生成する。根拠は今回のテーマ・プレゼン・Q&A のみ。logAiUsage のみ（課金なし）。
 */
export async function generatePresentationFinalReport(
  input: FinalReportInput,
): Promise<PresentationFinalReport> {
  const scoreLines = FINAL_REPORT_SCORE_KEYS.map(
    (k) => `      "${k}": 0-100,   // ${FINAL_REPORT_SCORE_LABELS[k]}`,
  ).join('\n');
  const qaTranscript = input.pairs
    .map((p, i) => `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer}`)
    .join('\n');

  const system = [
    'あなたは大学入試（総合型選抜・学校推薦型選抜）および採用面接の評価官です。',
    '受験生のプレゼン発表とその後の質疑応答（Q&A）を総合し、大学・企業の面接官が返す「評価レポート」相当の品質で講評を作成してください。',
    '',
    '厳守事項:',
    '- 根拠は「今回のプレゼンテーマ」「今回のプレゼン文字起こし」「今回の Q&A」のみ。テンプレ・一般論・定型文は禁止。',
    '- 良かった点・改善点・各レビューは、必ず今回の発表/回答の具体的な箇所を引用・参照して書く（例:「〜という具体例を挙げた点」）。',
    '- 発表/回答に存在しない内容を褒めたり批判したりしない。',
    '- すべて日本語。スコアは整数。',
    '',
    '出力は次の JSON オブジェクト **のみ**（前後の説明文・コードフェンスなし）:',
    '{',
    '  "totalScore": 0-100,            // 総合スコア（100点満点）',
    '  "categoryScores": {',
    scoreLines,
    '  },',
    '  "goodPoints": string[],         // 良かった点。最低5個。各項目は今回の内容を具体的に引用',
    '  "improvements": [               // 改善点。最低5個。重要度の高い順に並べる',
    '    { "point": string, "reason": string }   // point=改善点 / reason=改善すると なぜ評価が上がるか',
    '  ],',
    '  "presentationReview": string,   // プレゼンのみの詳細レビュー（構成・流れ・具体性・論理性・時間など。数文以上）',
    '  "qaReview": string,             // Q&Aのみの詳細レビュー（質問理解・回答の深さ・論理性・説得力など。数文以上）',
    `  "finalComment": string,         // プレゼン+Q&Aを合わせた最終総評。${PRESENTATION_FINAL_COMMENT_MIN_CHARS}文字以上の評価レポート文体`,
    '  "improvementPlan": [            // 次回までの改善プラン。優先度の高い順。最低3個',
    '    { "title": string, "today": string, "tomorrow": string }   // today=今日練習すること / tomorrow=明日練習すること',
    '  ],',
    '  "passProbabilityStars": 1-5,    // 大学・企業面接を想定した合格可能性の目安（参考。断定しない）',
    '  "passProbabilityNote": string   // 合格可能性の根拠と「あくまで参考」である旨',
    '}',
    '空配列・空文字は禁止。goodPoints と improvements は必ず5個以上にすること。',
  ].join('\n');

  const userPrompt =
    `${buildContextLines(input)}\n\n` +
    `プレゼンの文字起こし:\n${input.ctx.transcript.trim()}\n\n` +
    `発表後の質疑応答（全${input.pairs.length}問）:\n${qaTranscript}\n\n` +
    `上記のみを根拠に、最終評価レポート JSON を出力してください。`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: PRESENTATION_EVAL_MODEL,
      max_tokens: PRESENTATION_FINAL_REPORT_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch {
    logAiUsage({
      route: PRESENTATION_FINAL_REPORT_LOG_ROUTE,
      model: PRESENTATION_EVAL_MODEL,
      status: 'failed',
    });
    throw new FinalReportError('final-report-generation-failed');
  }

  const truncated = response.stop_reason === 'max_tokens';
  logAiUsage({
    route: PRESENTATION_FINAL_REPORT_LOG_ROUTE,
    model: PRESENTATION_EVAL_MODEL,
    status: truncated ? 'truncated' : 'success',
    usage: response.usage,
  });
  if (truncated) throw new FinalReportError('final-report-truncated');

  const text = extractText(
    response.content as Array<{ type: string; text?: string }>,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new FinalReportError('final-report-parse-failed');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new FinalReportError('final-report-parse-failed');
  }
  const obj = parsed as Record<string, unknown>;

  const totalScore = clampScore(obj.totalScore);
  const rawScores =
    obj.categoryScores && typeof obj.categoryScores === 'object'
      ? (obj.categoryScores as Record<string, unknown>)
      : {};
  const categoryScores = FINAL_REPORT_SCORE_KEYS.reduce(
    (acc, k) => {
      acc[k] = clampScore(rawScores[k]);
      return acc;
    },
    {} as Record<FinalReportScoreKey, number>,
  );
  const goodPoints = cleanList(obj.goodPoints, 8);
  const improvements = cleanImprovements(obj.improvements, 8);
  const presentationReview =
    typeof obj.presentationReview === 'string' ? obj.presentationReview.trim() : '';
  const qaReview = typeof obj.qaReview === 'string' ? obj.qaReview.trim() : '';
  const finalComment =
    typeof obj.finalComment === 'string' ? obj.finalComment.trim() : '';
  const improvementPlan = cleanPlan(obj.improvementPlan, 5);
  const passProbabilityStars = Math.max(
    1,
    Math.min(5, Math.round(Number(obj.passProbabilityStars) || 0) || 1),
  );
  const passProbabilityNote =
    typeof obj.passProbabilityNote === 'string'
      ? obj.passProbabilityNote.trim()
      : '';

  // 品質ゲート（要件の最低条件を満たさなければ失敗扱い → 呼び出し側で再試行）。
  if (
    goodPoints.length < 5 ||
    improvements.length < 5 ||
    !presentationReview ||
    !qaReview ||
    finalComment.length < PRESENTATION_FINAL_COMMENT_MIN_CHARS ||
    improvementPlan.length < 3 ||
    !passProbabilityNote
  ) {
    throw new FinalReportError('final-report-quality-failed');
  }

  return {
    totalScore,
    rank: rankFromScore(totalScore),
    categoryScores,
    goodPoints,
    improvements,
    presentationReview,
    qaReview,
    finalComment,
    improvementPlan,
    passProbabilityStars,
    passProbabilityNote,
  };
}
