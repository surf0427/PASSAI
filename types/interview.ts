// 面接フィードバック関連の型定義。
// API ルートに閉じていた型をここに集約し、client 側からも import できるようにする。

// ── UI / 履歴 で共有する面接データ型 ──────────────────────────
// （旧: app/interview/{record,history}/types.ts に閉じていたものを中立レイヤーへ移管）

// UI の入力単位（新形式）。送信時に questionsAsked / myAnswers へ変換される。
export type QuestionAnswerItem = {
  id: string;
  question: string;
  answer: string;
};

// 履歴一覧画面で使う表示用の型（StoredInterviewRecord のサブセット）。
// InterviewHistoryCard / InterviewHistoryList が受け取る props の型として使う。
// 保存用の全フィールドは StoredInterviewRecord（lib/interviewRecordStorage.ts）を参照。
export type InterviewRecord = {
  id: string;
  practiceDate: string;
  universityName: string;
  facultyName: string;
  examType: string;
  partner: string;
  mainQuestion: string;
  improvementSummary: string;
};

// ── AI / API レスポンス型 ──────────────────────────────────────

// Claude が返す各回答のレベル評価軸
export type Level = 'weak' | 'normal' | 'strong';

// 1問ごとの5軸レベル評価（AI/API が返す構造）
export type LevelEvaluation = {
  logical: Level;
  concrete: Level;
  consistency: Level;
  originality: Level;
  interviewReadiness: Level;
};

// Claude が返す面接フィードバック全体（AI/API が返す構造）。
// フィールド名を変えると feedbackToText の出力テキストが変わり、
// InterviewHistoryCard の parseImprovementSummary が壊れるため変更禁止。
export type InterviewFeedback = {
  overallEvaluation: string;
  goodPoints: string[];
  improvements: string[];
  perQuestionFeedback: {
    question: string;
    answer: string;
    evaluation: string;
    improvement: string;
    betterAnswer: string;
    levelEvaluation: LevelEvaluation;
  }[];
  followUpQuestions: {
    questionNumber: number;
    originalQuestion: string;
    followUps: string[];
  }[];
  nextPractice: string[];
};
