// /api/analysis の AI 出力（WallHittingResult）を概念的に責務分離するヘルパ。
//
// 役割:
//   - extractProfileMaterial: WallHittingResult から questions を除いた「profile 素材」を取り出す
//   - extractInitialQuestions: WallHittingResult から初期質問配列を取り出す
//   - ProfileMaterial 型: questions を除いた WallHittingResult の片割れ
//
// 責務分離:
//   /api/analysis ルートは 1 回の AI 呼び出しで 2 つの責務を処理する。
//     (A) profile 生成責務 → summary / strengths / weaknesses / futureConnections
//                          （= toStudentProfile() の入力となる canonical な分析素材）
//     (B) 質問生成責務（初期 5 問） → questions
//                          （= 壁打ちフロー内部の working memory）
//   v4 で (B) を deterministic catalog に移管したが、固定テンプレが activity の中身に言及
//   しない generic 質問しか返せず自己分析機能の中核価値を損なったため、v5 で AI 生成に戻した
//   （STEP-SELFANALYSIS-QUESTION-QUALITY-01）。route.ts は extractInitialQuestions(parsed)
//   で AI 出力から questions を取り出して WallHittingResult.questions に乗せ直す。
//
// 注意:
//   - 戻り値 ProfileMaterial の shape を変えてはいけない。POST handler 側で
//     `{ ...profileMaterial, questions: initialQuestions }` の組み立て直しが
//     WallHittingResult 出力スキーマと等価であることに依存している。
//   - questions が array でない場合の空配列フォールバックは defensive guard として
//     維持する（v4 cache hit や AI schema 違反時の safety net）。

import type { WallHittingResult } from '@/types/analysis';

// (A) profile 生成責務に対応する素材だけを取り出すヘルパ。
// WallHittingResult から questions を除いた形 = ProfileMaterial と概念的に等価。
// 将来 /api/self-analysis/profile に切り出すときは、この型がそのまま出力契約になる。
export type ProfileMaterial = Omit<WallHittingResult, 'questions'>;

export function extractProfileMaterial(raw: WallHittingResult): ProfileMaterial {
  // questions は (B) 質問生成責務の方で別途取り出すので、profile 側からは明示的に除外する。
  return {
    summary: raw.summary,
    strengths: raw.strengths,
    weaknesses: raw.weaknesses,
    futureConnections: raw.futureConnections,
  };
}

// (B) 質問生成責務に対応する初期質問だけを取り出すヘルパ。
// 将来 /api/self-analysis/questions（または既存 /api/analysis/additional と統合）の
// 出力契約と揃える形にしてある。
export function extractInitialQuestions(raw: WallHittingResult): string[] {
  return Array.isArray(raw.questions) ? raw.questions : [];
}
