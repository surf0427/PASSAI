// 受験タイプ診断（9タイプ・15問）の判定ロジック。
// 移植元: juken-shindan/lib/scoring.ts（normalized scoring + FNV-1a 安定タイブレーク）。
//
// PASSAI 適合の変更点:
//   - 入力を juken の Answer[]（{questionId, selectedOptionIndex}）ではなく PASSAI 既存の
//     `answers: number[]`（質問順に option index）に統一。これにより answers を唯一の真実源と
//     し、resultType / secondaryType / scoreVector は **保存せず都度再計算**する（Phase 3 Option B）。
//   - maxPossible は juken の理論最大方式（問ごとに各タイプのベスト選択肢1つ分を合計）を採用。
//     ⚠️ PASSAI 4タイプ診断（lib/diagnosisScoring.ts）の「面積方式」は流用しない。
//        juken データは 1選択肢が複数タイプへ重み（3/1）を配るため、面積定義は誤った正規化になる。
//
// 既存4タイプ scoring（lib/diagnosisScoring.ts）には一切触れない（別系統・併存）。

import {
  EXAM_TYPES,
  type ExamType,
  type ExamQuestion,
  type ExamScoreVector,
  type ExamDiagnosisResult,
} from '@/types/examDiagnosis';
import { EXAM_QUESTIONS } from './questions';

// secondaryType を保持する normalized スコア差の閾値。
// primary と 2位の normalized 差がこの値以下なら「僅差」とみなし secondaryType を残す。
export const EXAM_SECONDARY_THRESHOLD = 0.15;

function zeroRecord(): Record<ExamType, number> {
  const rec = {} as Record<ExamType, number>;
  for (const type of EXAM_TYPES) rec[type] = 0;
  return rec;
}

// 各タイプの「理論最大スコア」を questions から自動算出する。
// 1問につき、そのタイプに最も加点される選択肢1つ分だけを採用して合計する
// （1問1回答のため、ユーザーが取り得る理論上の最大スコア）。
export function computeExamMaxPossible(
  questions: ExamQuestion[] = EXAM_QUESTIONS,
): Record<ExamType, number> {
  const max = zeroRecord();

  for (const question of questions) {
    const bestPerType = zeroRecord();
    for (const option of question.options) {
      // 同一選択肢内で同じタイプに複数加点されるケースも合算しておく。
      const perType = zeroRecord();
      for (const point of option.points) {
        perType[point.type] += point.score;
      }
      for (const type of EXAM_TYPES) {
        if (perType[type] > bestPerType[type]) bestPerType[type] = perType[type];
      }
    }
    for (const type of EXAM_TYPES) max[type] += bestPerType[type];
  }

  return max;
}

// answers（質問順の option index）から scoreVector（raw / normalized / maxPossible）を算出する。
// 注: answers[i] が範囲外 / 不在だと option が undefined になり throw する
//     （本番は 15 問完答後にのみ呼ばれる前提。QA で空 / 不正入力の throw を固定）。
export function computeExamScoreVector(
  answers: number[],
  questions: ExamQuestion[] = EXAM_QUESTIONS,
): ExamScoreVector {
  const raw = zeroRecord();

  for (let i = 0; i < questions.length; i++) {
    const option = questions[i].options[answers[i]];
    if (!option) {
      throw new Error(`Invalid answer index at question ${i}: ${answers[i]}`);
    }
    for (const point of option.points) {
      raw[point.type] += point.score;
    }
  }

  const maxPossible = computeExamMaxPossible(questions);
  const normalized = zeroRecord();
  for (const type of EXAM_TYPES) {
    normalized[type] = maxPossible[type] > 0 ? raw[type] / maxPossible[type] : 0;
  }

  return { raw, normalized, maxPossible };
}

// 回答から決定論的なタイブレークキーを作る（質問順に index:選択 を連結）。
function stableKey(answers: number[]): string {
  return answers.map((a, i) => `${i}:${a}`).join('|');
}

// FNV-1a 32bit ハッシュ。乱数を使わず、入力が同じなら常に同じ値を返す。
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// normalized 降順で全タイプを並べる。完全同点は回答由来の安定ハッシュで決める
// （宣言順・タイプ名順には依存しない）。
export function rankExamTypes(
  normalized: Record<ExamType, number>,
  tiebreakKey: string,
): ExamType[] {
  return [...EXAM_TYPES].sort((a, b) => {
    if (normalized[b] !== normalized[a]) return normalized[b] - normalized[a];
    return fnv1a(`${tiebreakKey}#${b}`) - fnv1a(`${tiebreakKey}#${a}`);
  });
}

// 詳細な判定結果（primary / secondary / scoreVector）を返す。保存しない（都度再計算）。
export function calculateExamDiagnosisResult(
  answers: number[],
  questions: ExamQuestion[] = EXAM_QUESTIONS,
): ExamDiagnosisResult {
  const scoreVector = computeExamScoreVector(answers, questions);
  const ranked = rankExamTypes(scoreVector.normalized, stableKey(answers));

  const primaryType = ranked[0];
  const runnerUp = ranked[1];

  const secondaryType =
    runnerUp !== undefined &&
    scoreVector.normalized[primaryType] - scoreVector.normalized[runnerUp] <=
      EXAM_SECONDARY_THRESHOLD
      ? runnerUp
      : undefined;

  return { primaryType, secondaryType, scoreVector };
}

// 後方互換ラッパ（primaryType の ExamType 文字列だけ返す）。UI / 保存はこれを使う。
export function calcExamResultType(answers: number[]): ExamType {
  return calculateExamDiagnosisResult(answers).primaryType;
}
