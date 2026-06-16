// STEP-INTERVIEW-AI-PR8: 面接履歴の 2 ソース（対人記録 + AI 面接）統合表示の型。
//
// 既存 InterviewFeedback / LevelEvaluation / InterviewRecord は **変更しない**。
// 本ファイルは表示用の統合型を新規追加するだけ。

import type { InterviewRecord } from './interview';

// 履歴の出自。
//   - 'human'    : 対人面接練習記録（localStorage interview_records / StoredInterviewRecord）
//   - 'ai_voice' : AI 面接セッション（interview_ai_sessions/results、completed のみ）
export type InterviewSource = 'human' | 'ai_voice';

// 履歴一覧 / カードが受け取る統合表示型。
//   - InterviewRecord の表示フィールドをベースに source を付与する。
//   - ai_voice では partner / examType / mainQuestion は対人前提 UI なので空 ''（カードで非表示）。
//   - feedbackJson は InterviewFeedback の JSON 文字列（CTA / insights 用）。human/ai 双方が持ちうる。
export type UnifiedInterviewRecord = InterviewRecord & {
  source: InterviewSource;
  feedbackJson?: string;
  // ai_voice のときの面接タイプ（self_analysis/activity/... /free）。human は undefined。
  interviewType?: string;
};
