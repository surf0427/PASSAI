export type AnalysisResult = {
  strengths: string[];
  interests: string[];
  gaps: string[];
  questions: string[];
};

export type WallHittingResult = {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  futureConnections: string[];
  questions: string[];
};

export type SummaryResult = {
  activitySummary: string;
  strengths: string;
  appealPoints: string;
  selfPRDraft: string;
  interviewPoints: string[];
};

// AI壁打ちのフロー上のステップ
export type AnalyzeStep = 'confirm' | 'answering' | 'summary';

// localStorage に保存する壁打ちセッションの状態
export type PersistedAnalyzeState = {
  step: AnalyzeStep;
  answers: string[];
  analysis: WallHittingResult | null;
  summary: SummaryResult | null;
  displayedQuestions?: string[]; // 表示中の質問（初期5問 + 追加分）
};
