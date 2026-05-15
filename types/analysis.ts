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

// /api/summarize の生成モード。
//   - 'light': 回答量が少ない初心者向け。素材整理 + 不足箇所の柔らかい指摘
//   - 'deep' : 回答量が十分なケース。抽象化・共通点抽出・価値観整理
// 判定は lib/summarizeMode.ts:decideSummarizeMode で answers / deepAnswers から都度算出する。
// PersistedAnalyzeState には永続化しない（derived state）。
export type SummarizeMode = 'light' | 'deep';

// localStorage に保存する壁打ちセッションの状態
export type PersistedAnalyzeState = {
  step: AnalyzeStep;
  answers: string[];
  analysis: WallHittingResult | null;
  summary: SummaryResult | null;
  displayedQuestions?: string[]; // 表示中の質問（初期5問 + 追加分）
};
