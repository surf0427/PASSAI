// /api/analysis の input hash。STEP-LIB-02 で lib/aiInputHash.ts から分離。
// VERSION / MODEL / Hash 型 / 関数の signature と値は分離前と完全に同一。
//
// 関連保存層: lib/wallHittingInputHashStorage.ts
// 観測ログ: lib/aiCacheLog.ts / docs/principles/ai_cache_observability.md

import { djb2 } from '@/lib/hash/djb2';
import { stableStringify } from '@/lib/hash/stableStringify';

// プロンプト本文を変更した時に bump する版数。これを上げると既存 cache が一律 miss になる。
// STEP5.2 時点では 1。ANALYSIS_SYSTEM_PROMPT / buildWallHittingPrompt を改修するときに +1 する。
//
// PROMPT_VERSION bump 履歴:
//   v1 → v2 : STEP15f で SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE /
//             ANALYSIS_SUBJECT_GRADES_QUALIFIER を SYSTEM_PROMPT に接続。
//             user prompt（buildWallHittingPrompt の戻り値）は byte-identical。
//             analysis の出力は StudentProfile に固定化され下流に伝染するため、
//             qualifier では「評定値・欠席日数を strengths/weaknesses/futureConnections/summary
//             に残さない」を最重要制約として明示している。既存 cache の意味的妥当性が変わるため
//             lane を分離する必要があり bump 必須。
//   v2 → v3 : STEP B（applicantType）で ANALYSIS_SYSTEM_PROMPT に「6. 受験生タイプの推定」
//             セクションと JSON 出力 schema の applicantType field（5 種 enum）を追加。
//             受験生側の「型（傾向）」を AI に推定させ、route 側で validate → StudentProfile
//             に passthrough する。内部 context 用ラベルで UI には強く露出しない。
//             hash 入力構造（HashAnalysisInput の signature）は不変だが、AI 出力 schema が
//             optional field 増分で変わるため既存 v2 cache の意味的妥当性が変わる。
//             旧 v2 cache が新コードに hit すると applicantType を欠いた WallHittingResult が
//             下流に流れるため lane 分離が必要で bump 必須（intentional 1 回 cache miss）。
//             user prompt（buildWallHittingPrompt の戻り値）は byte-identical。
//   v3 → v4 : Deterministic Audit P1-1 で「(B) 初期 5 問生成責務」を deterministic catalog
//             （lib/analysis/initialQuestionsCatalog.ts:buildInitialQuestions）に移管。
//             ANALYSIS_SYSTEM_PROMPT から「5. 深掘り質問」セクションと JSON schema の
//             questions field を削除し、route 側で post-parse 時に deterministic な
//             初期 5 問を WallHittingResult.questions に注入する。AI 出力は questions
//             field を含まなくなったため、v3 cache（AI 生成 questions を含む）が
//             新コードに hit すると stale な AI questions と新 catalog の二重生成経路が
//             共存する。lane 分離のため bump 必須（intentional 1 回 cache miss）。
//             hash 入力構造（HashAnalysisInput の signature）は不変。
//             WallHittingResult の出力 shape は完全に不変（questions field は今まで通り
//             string[5] が入る）。
export const ANALYSIS_PROMPT_VERSION = 4;

// /api/analysis が使用するモデル。server route.ts 側の MODEL 定数と一致させること。
// モデル変更は cache invalidation の主因なので hash 入力に必ず含める。
export const ANALYSIS_MODEL = 'claude-sonnet-4-6';

export type HashAnalysisInput = {
  activityData: unknown;
  basicInfo: unknown;
  universityContext: unknown;
  model: string;
  promptVersion: number;
};

export function hashAnalysisInput(input: HashAnalysisInput): string {
  return djb2(stableStringify(input));
}
