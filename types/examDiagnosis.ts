// 受験タイプ診断（9タイプ・15問）の型定義。
//
// ⚠️ 既存 types/diagnosis.ts の `DiagnosisType = 1|2|3|4` とは **完全に別系統**。
//   - DiagnosisType（数値 1-4）: legacy 4タイプ診断 + self-analysis（inferAnalysisType）が共有。
//   - ExamType（文字列 9種）: 本ファイル。juken-shindan 由来の正式版診断専用。
// 番号系と文字列系は恒久併存させる（STEP-DIAGNOSIS-MIGRATION 設計監査 §4）。混ぜない。
//
// 移植元: juken-shindan/types/index.ts（content 系のみ）。
//   保存系（DiagnosisProfile / score_vector DB 列）は **移植しない**（Phase 3 Option B 維持）。

// 受験タイプの正準リスト（判定・配点・結果の単一の真実の源）。
// 並び順は判定結果に影響しない（ランキングは normalized スコア、同点は安定ハッシュ）。
export const EXAM_TYPES = [
  'riaju',
  'challenger',
  'creator',
  'kaigai',
  'kakumeika',
  'kyoyo',
  'yutosei',
  'jiyujin',
  'gariben',
] as const;

export type ExamType = (typeof EXAM_TYPES)[number];

// string 境界（DB 読み出し・保存 payload・ルートパラメータ等）で使う型ガード。
export function isExamType(value: unknown): value is ExamType {
  return typeof value === 'string' && (EXAM_TYPES as readonly string[]).includes(value);
}

// 質問の型（各選択肢が複数タイプへ重み付き加点する juken モデル）。
export interface ExamQuestion {
  id: number;
  text: string;
  options: ExamOption[];
}

export interface ExamOption {
  text: string;
  points: ExamPoint[];
}

// 各タイプへの加点（score は 3 or 1）。
export interface ExamPoint {
  type: ExamType;
  score: number;
}

// 結果コンテンツ（9タイプ分）。
export interface ExamResult {
  type: ExamType;
  name: string;
  catchphrase: string;
  description: string;
  strategy: string;
  universities: string[];
  universityCharacter: string;
  reason: string;
  ngBehavior: string;
  ngExplanation: string;
  badExamples: string[];
  countermeasure: string;
}

// スコアベクトル（raw / normalized / maxPossible の3点セット）。
// ⚠️ Option B: これは **判定・表示時の再計算結果**であり、DB / localStorage には保存しない。
export type ExamScoreVector = {
  raw: Record<ExamType, number>;
  normalized: Record<ExamType, number>;
  maxPossible: Record<ExamType, number>;
};

// 判定結果（再計算で得られる。保存しない）。
export type ExamDiagnosisResult = {
  primaryType: ExamType;
  secondaryType?: ExamType;
  scoreVector: ExamScoreVector;
};
