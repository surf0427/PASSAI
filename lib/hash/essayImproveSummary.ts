// /api/essay-improve-summary の input hash。STEP-LIB-02 で lib/aiInputHash.ts から分離。
// 改善方針（summary / focusPoints / suggestedDirections）のみを返す思考整理 route。
// 本文ドラフトを生成しない（ai_policy 準拠）。
// VERSION / MODEL / Hash 型 / 関数の signature と値は分離前と完全に同一。
//
// 関連: app/api/essay-improve-summary/route.ts
//
// hash に含めるもの:
//   - issueText（取り組む改善点の文言。これが変われば方針が変わる）
//   - axis（深掘りテンプレ選定軸。同じ issueText でも軸違いで方針が変わるため）
//   - deepQuestions（質問 snapshot。テンプレ更新で内容が変わるため）
//   - answers（生徒の回答。これが入力の中核）
//   - essayBodySnapshot（書き直し対象本文。同じ Q&A でも本文が違えば方針が変わる）
//   - themeText（テーマも文脈として影響）
//   - mini（結論 / 理由 1 / 理由 2）
//   - basicInfo（志望大学・学部）
//   - templateVersion（テンプレ版変更で AI 出力が変わる可能性）
//   - model / promptVersion
//
// hash に含めないもの:
//   - workspace.id / improvementInProgress.startedAt
//   - reviews 全体（latest review.improvement / weakPoints は issueText に集約済み）
//   - summary（出力側）

import { djb2 } from '@/lib/hash/djb2';
import { stableStringify } from '@/lib/hash/stableStringify';

// PROMPT_VERSION bump 履歴:
//   v1 : essay STEP F 初期実装。本文ドラフト禁止 + 改善方針のみ（single-issue 契約）。
//   v2 : 責務分離 UX 修正で multi-issue 契約に変更。works[] 配列で複数改善点を集約。
//        prompt 文言も「複数 issue の統合改善方針」を返す内容に bump。
//        旧 v1 cache は 1 回 miss → 新 v2 で再生成。
export const ESSAY_IMPROVE_SUMMARY_PROMPT_VERSION = 2;
export const ESSAY_IMPROVE_SUMMARY_MODEL = 'claude-sonnet-4-6';

export type HashEssayImproveSummaryWork = {
  issueText: string;
  axis: string;
  deepQuestions: string[];
  answers: string[];
};

export type HashEssayImproveSummaryInput = {
  works: HashEssayImproveSummaryWork[];
  essayBodySnapshot: string;
  themeText: string;
  mini: { conclusion: string; reasonOne: string; reasonTwo: string };
  basicInfo: unknown;
  templateVersion: number;
  model: string;
  promptVersion: number;
};

export function hashEssayImproveSummaryInput(
  input: HashEssayImproveSummaryInput,
): string {
  return djb2(stableStringify(input));
}
