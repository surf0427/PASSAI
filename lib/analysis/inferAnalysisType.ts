// 自己分析 summary（/api/summarize の出力）から、ユーザーがどの「受験タイプ」に
// 近いかを軽量ルールベースで推定する。AI 推論は呼ばない。
//
// 出力タイプは固定 4 種類（types/diagnosis.ts:DiagnosisType）:
//   1: 活動アピール型
//   2: 探究・研究型
//   3: 将来ビジョン型
//   4: 成長ポテンシャル型
//
// 設計思想:
//   - "厳密診断" ではなく "今回の自己分析から見える傾向" を返すだけ
//   - Explainable (どのキーワードが効いたか説明できる) を優先
//   - keyword 群はタイプごとに named const に分離し、将来 AI 推論化や
//     語彙チューニングが必要になったときに差し替えやすくする
//   - 完全 match ゼロのときは null を返し、caller 側に fallback 判断を委ねる
//     （現状は呼び出し側で旧 diagnosis_result → PromoCard の順にフォールバック）

import type { SummaryResult } from '@/types/analysis';
import type { DiagnosisType } from '@/types/diagnosis';

// ── タイプ別 keyword 群 ──────────────────────────────────────────
// 部分一致（String#includes）で十分なので形態素解析は行わない。
// 名詞だけでなく動詞語幹・連語まで含めて拾うのが目的。
// 将来 AI 化する場合は、ここを feature embedding やプロンプト材料へ置換する。

export const ACTIVITY_KEYWORDS = [
  '部活',
  '生徒会',
  'ボランティア',
  '留学',
  '課外活動',
  'アルバイト',
  '実績',
  'チーム',
  '行動',
  'リーダー',
  '活動',
  '大会',
  '受賞',
] as const;

export const RESEARCH_KEYWORDS = [
  '興味',
  '関心',
  '社会課題',
  '問題意識',
  'なぜ',
  '調べた',
  '探究',
  '研究',
  '学びたい',
  '分析',
  '考察',
  '深く',
  '仕組み',
] as const;

export const VISION_KEYWORDS = [
  '将来',
  '夢',
  'キャリア',
  '社会で',
  '役立つ',
  '実現',
  '目標',
  'なりたい',
  'ビジョン',
  '貢献',
  '職業',
  '志す',
] as const;

export const GROWTH_KEYWORDS = [
  '変化',
  '苦手',
  '挑戦',
  '努力',
  '成長',
  '克服',
  '変わった',
  'これから',
  '伸び',
  '気づき',
  '失敗',
  '乗り越え',
] as const;

// ── 判定閾値 ────────────────────────────────────────────────────
// 内容が薄い状態で無理にタイプ分類しないため、最低一致数を設ける。
// 1 語だけのヒット（例：「これから」「行動」など汎用度の高い 1 語）で
// 特定タイプに倒れる誤判定を防ぎ、自己分析がほぼ書けていない段階では
// null を返して caller に fallback（旧 diagnosis_result → PromoCard）を委ねる。
//
// 2 にしている根拠（dry-run 観測）:
//   - 1 では sparse-vague case（「これから頑張りたい」のみ）が type 4 に倒れた
//   - 2 にすると pure-* / mix-* の通常ケースは余裕で通る（最低でも 6 点台）
const MIN_SCORE = 2;

// ── 推定結果 ────────────────────────────────────────────────────

export type InferAnalysisTypeResult = {
  type: DiagnosisType;
  // どのタイプも 0 点なら null を返すので、ここに来る時点で少なくとも 1 つは match。
  scores: Record<DiagnosisType, number>;
  // どの keyword が当たったか（debug / explainability 用）。タイプ別。
  matchedKeywords: Record<DiagnosisType, string[]>;
};

// ── 本体 ────────────────────────────────────────────────────────

function findMatches(text: string, keywords: readonly string[]): string[] {
  return keywords.filter((k) => text.includes(k));
}

export function inferAnalysisType(
  summary: SummaryResult,
): InferAnalysisTypeResult | null {
  // 3 フィールドを 1 本のテキストに連結して match を取る。
  // SummaryResult は plain string なので形態素解析や正規化はしない。
  const text = [summary.activitySummary, summary.strengths, summary.appealPoints]
    .filter((s) => typeof s === 'string')
    .join(' ');

  if (!text.trim()) return null;

  const matchedKeywords: Record<DiagnosisType, string[]> = {
    1: findMatches(text, ACTIVITY_KEYWORDS),
    2: findMatches(text, RESEARCH_KEYWORDS),
    3: findMatches(text, VISION_KEYWORDS),
    4: findMatches(text, GROWTH_KEYWORDS),
  };

  const scores: Record<DiagnosisType, number> = {
    1: matchedKeywords[1].length,
    2: matchedKeywords[2].length,
    3: matchedKeywords[3].length,
    4: matchedKeywords[4].length,
  };

  // 最低 MIN_SCORE 点に満たない（= 0 or 1 ヒット）なら推定不能とし、
  // caller に fallback を委ねる。1 語ヒットで類型化される副作用の予防。
  const maxScore = Math.max(scores[1], scores[2], scores[3], scores[4]);
  if (maxScore < MIN_SCORE) return null;

  // 同点タイブレーク: 1 → 2 → 3 → 4 の順で安定（番号小を優先）。
  // /diagnosis の calcResultType と同じ tiebreak ポリシーに揃え、両経路で
  // 結果が一意になるようにする。
  let winner: DiagnosisType = 1;
  if (scores[2] > scores[winner]) winner = 2;
  if (scores[3] > scores[winner]) winner = 3;
  if (scores[4] > scores[winner]) winner = 4;

  return { type: winner, scores, matchedKeywords };
}
