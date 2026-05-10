// 面接フィードバック関連の型定義。
// API ルートに閉じていた型をここに集約し、client 側からも import できるようにする。

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
