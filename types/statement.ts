export type EvaluationScore = {
  label: string;
  score: number; // 0〜20
};

export type StatementResult = {
  overallScore: number;
  evaluations: EvaluationScore[];
  strengths: string[];
  weaknesses: string[];
  actions: string[];
  partialRevision: string;
  checklist: string[];
};
