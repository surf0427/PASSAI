import type { ApplicantType } from './applicantType';

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
  // 受験生側の「型（傾向）」。AI が未推定なら undefined。
  // 推定経路の実装は別 STEP（STEP B 以降）。型のみ optional で先行追加。
  applicantType?: ApplicantType;
};

// /api/summarize の出力。「自己分析の簡潔な要約」のみを返す。
// 自己PR下書き / 面接で話す要点は feature 側（self-pr / interview）の責務であり、
// 各 feature は StudentProfile から自前で派生する。
export type SummaryResult = {
  activitySummary: string;
  strengths: string;
  appealPoints: string;
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
  // 各質問に対する任意の「追加深掘りメモ」。answers と index 一対一対応。
  // optional にして旧保存データ（このキーを持たない JSON）との互換を保つ。
  // working memory として扱い、StudentProfile / SummaryResult / WallHittingResult には流さない。
  deepAnswers?: string[];
  // 任意の自由メモ（全体単位・1 フィールド）。質問では拾いきれない気づき・違和感を書く欄。
  // optional にして旧保存データ互換を維持。working memory として扱い、
  // /api/summarize にのみ流す。StudentProfile / Context Builder / downstream feature には絶対に流さない。
  // 上限は lib/summarizeNormalize.ts:FREE_MEMO_MAX_CHARS。
  freeMemo?: string;
};
