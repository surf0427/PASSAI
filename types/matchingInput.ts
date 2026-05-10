import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { WallHittingResult } from '@/types/analysis';
import type { UniversityContext } from '@/types/universityContext';

// 志望校マッチング機能の入力データを表す共通型。
//
// 設計意図:
//   将来 Supabase / 大学DB / 推薦判定強化 を導入したときに、
//   型・データフロー・呼び出し先 を最小限の変更で拡張できるよう、
//   先行して「matching パイプラインへの入力契約」を一箇所で定義しておく。
//
// データフロー (構造としてはこの順で組み立てる):
//   basicInfo               …… ユーザーが入力した基本情報
//   activityData            …… 活動整理フォームの内容
//   selfAnalysis            …… AI壁打ちの結果（自己分析）
//   universityContexts      …… 各志望校の大学DB由来情報（現状は basicInfo から派生）
//   ↓
//   スコアリング層 (lib/matching/*) — deterministic
//   ↓
//   文章生成層 (app/api/matching/route.ts) — Claude
//
// 型のフィールド名は将来の拡張も意識して整えてある:
//   - activityData: 現状の集約型 ActivityData をそのまま受ける（後で Activity[] にしたければ型をすげ替えるだけ）
//   - selfAnalysis: 現状は WallHittingResult。後で SelfAnalysisResult のような汎用型に拡張可能
//   - universityContexts: 第一志望〜第N志望の各大学コンテキスト（DB enrich 後はリッチになる）
export type MatchingInput = {
  basicInfo: BasicInfo | null;
  activityData: ActivityData | null;
  selfAnalysis?: WallHittingResult | null;
  universityContexts?: UniversityContext[];
};
