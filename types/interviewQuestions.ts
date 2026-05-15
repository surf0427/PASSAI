// 面接質問生成の 2 層出力（一般質問 / 個別深掘り）型定義。
//
// 役割:
//   将来の /api/interview-questions（未実装）が返す JSON 形式を、
//   client / route 双方が型整合をとるための単一ソース。
//
// 段階移行:
//   既存 app/interview/questions/utils/generateInterviewQuestions.ts の
//   GeneratedQuestion 型は当面残す（deterministic フォールバック用）。
//   本ファイルの型は新規の 2 層 AI 出力にのみ使う。
//
// 関連: lib/interview/buildInterviewQuestionMaterials.ts(素材builder)

export type InterviewQuestionCategory =
  | 'motivation'
  | 'activity'
  | 'self_analysis'
  | 'university_fit'
  | 'future_goal'
  | 'consistency_check'
  | 'authenticity_check';

export type PersonalizedQuestionSourceHint =
  | 'statement'
  | 'activity'
  | 'self_analysis'
  | 'university_db'
  | 'admission_policy'
  | 'selection_steps';

export type BaseInterviewQuestion = {
  category: InterviewQuestionCategory;
  question: string;
  answerTip: string;
};

export type GeneralInterviewQuestion = BaseInterviewQuestion & {
  type: 'general';
};

export type PersonalizedInterviewQuestion = BaseInterviewQuestion & {
  type: 'personalized';
  sourceHint?: PersonalizedQuestionSourceHint;
  intent?: string;
};

export type TwoLayerInterviewQuestions = {
  general: GeneralInterviewQuestion[];
  personalized: PersonalizedInterviewQuestion[];
};
