// /api/analysis の AI 出力（WallHittingResult）を概念的に 2 つの責務へ分離するヘルパ。
//
// 役割:
//   - extractProfileMaterial: WallHittingResult から questions を除いた「profile 素材」を取り出す
//   - extractInitialQuestions: WallHittingResult から初期質問配列を取り出す
//   - ProfileMaterial 型: questions を除いた WallHittingResult の片割れ
//
// なぜ分離するか（/api/analysis route 元コメントより）:
//   /api/analysis ルートは現在 2 つの責務を 1 回の AI 呼び出しで同時に処理している。
//     (A) profile 生成責務 → summary / strengths / weaknesses / futureConnections
//                          （= toStudentProfile() の入力となる canonical な分析素材）
//     (B) 質問生成責務（初期 5 問固定） → questions
//                          （= 壁打ちフロー内部の working memory）
//   将来 /api/self-analysis/profile (=A) と /api/self-analysis/questions (=B) に分割する
//   ときの境界線を、AI 出力 parse 後にコード上で明示する目的で本ヘルパ群を使う。
//
// 切り出し経緯:
//   元は app/api/analysis/route.ts に同居していたが、route.ts 内 private のため Claude Code は
//   route 全体を読まないと「責務境界の定義」が掴めなかった。lib/analysis/ 配下に逃がすことで
//   将来の API 分割時の出力契約候補として参照しやすくする。AI 呼び出し経路 /
//   ANALYSIS_SYSTEM_PROMPT / buildWallHittingPrompt / parse 経路とは無関係の純粋関数。
//
// 注意:
//   - 戻り値 ProfileMaterial / string[] の shape を変えてはいけない。POST handler 側で
//     `{ ...profileMaterial, questions: initialQuestions }` の組み立て直しが
//     WallHittingResult 出力スキーマと等価であることに依存している。
//   - questions が array でない場合の空配列フォールバックは defensive guard として
//     後方互換のために維持する（元実装どおり）。

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
