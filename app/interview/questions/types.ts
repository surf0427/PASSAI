import type { GeneratedQuestion } from './utils/generateInterviewQuestions';
import type { TwoLayerInterviewQuestions } from '@/types/interviewQuestions';

export type InterviewQuestionFormData = {
  universityName: string;
  facultyName: string;
  examType: string;
  reason: string;
  activities: string;
  futureGoals: string;
};

// AI 生成（two_layer）と既存 deterministic 生成（legacy）を 1 つの state で表現する。
// 既存 UI を破壊しないため legacy を残し、AI 成功時のみ two_layer に切り替える。
// Form / Preview 双方の props 型として使う。
export type InterviewQuestionsViewState =
  | { mode: 'idle' }
  | { mode: 'legacy'; questions: GeneratedQuestion[] }
  | { mode: 'two_layer'; questions: TwoLayerInterviewQuestions };
