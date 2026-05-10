// 履歴一覧画面で使う表示用の型（StoredInterviewRecord のサブセット）。
// InterviewHistoryCard / InterviewHistoryList が受け取る props の型として使う。
// 保存用の全フィールドは StoredInterviewRecord（interviewRecordStorage.ts）を参照。
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
