// PASSAI 受験チューターAI 専用 context builder 群の型・定数（実装 STEP3）。
//
// 役割:
//   - 各 builder 間で共有する option 型・主 entry 入力型を定義
//   - 文字列 truncation の上限長を集約
//
// 設計方針:
//   - 入力 source は unknown | null で受ける（builder 側で shape guard）
//   - 過剰に型を増やさない（canonical な BasicInfo / StudentProfile の再宣言はしない）
//   - 値を変えると出力 string が変わる場合は TUTOR_PROMPT_VERSION の bump 要否を必ず判断する
//     （[lib/aiInputHash.ts](../../aiInputHash.ts) のコメント参照）
//
// 関連: [lib/tutor/types.ts](../../tutor/types.ts) (TutorIntent / PreferredProfileField)

import type { TutorIntent, PreferredProfileField } from '@/lib/tutor/types';

// ── builder option 型 ─────────────────────────────────────────────

// StudentProfile context builder のオプション。
// intent に応じて含める field を切り替える（stabilize なら summary のみ）。
// preferredProfileField は client 側が「前回引いた要素と違う方」を渡すための制御。
export type TutorContextOptions = {
  intent: TutorIntent;
  preferredProfileField?: PreferredProfileField;
};

// 主 entry buildTutorPromptContext の入力型。
// すべて unknown | null で受けることで route 側の shape guard 負荷を下げ、
// builder 内で defensive に解釈する責務を負う（型不一致時は throw せず空文字）。
export type TutorPromptContextInput = {
  basicInfo?: unknown | null;
  studentProfile?: unknown | null;
  intent: TutorIntent;
  preferredProfileField?: PreferredProfileField;
  statementDraft?: unknown | null;
  statementReviewLatest?: unknown | null;
  interviewRecordLatest?: unknown | null;
  interviewFeedbackLatest?: unknown | null;
  wallHittingResult?: unknown | null;
  selfPRDraft?: string | null;
};

// ── truncation 定数 ──────────────────────────────────────────────
//
// 各 source 由来の文字列を AI prompt に乗せる際の上限長。
// 超過時は省略記号なしで自然な位置で slice(0, MAX) する。
// 値を変えても TUTOR_PROMPT_VERSION 自体は不変だが、出力 string が変わるため
// 実質的には bump 必須（cache 整合性の観点）。

export const MAX_STATEMENT_EXCERPT_LENGTH = 100;
export const MAX_INTERVIEW_QUESTION_LENGTH = 60;
export const MAX_INTERVIEW_ANSWER_LENGTH = 80;
export const MAX_SELF_ANALYSIS_ANSWER_LENGTH = 80;
export const MAX_SELF_PR_EXCERPT_LENGTH = 100;
export const MAX_PROFILE_ITEM_LENGTH = 60;
export const MAX_FUTURE_CONNECTION_LENGTH = 80;
export const MAX_VALUE_KEYWORDS = 3;
// v1.1 STEP17 追加: signatureEpisodes は 1 件のみ、title のみ出力する設計。
// 監視感 / 過剰個人化リスクが最も高い field のため、複数件出力は構造的に阻止。
// 「summary」「relatedStrengthIdx」は context に出さない（client 側で除外、builder 側でも参照しない）。
export const MAX_SIGNATURE_EPISODES = 1;
// title は toStudentProfile 側で 20 字キャップされている（既存）が、builder 側でも
// 念のため truncate して防御層を厚くする。
export const MAX_SIGNATURE_EPISODE_TITLE_LENGTH = 20;
