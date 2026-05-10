// フォーム送信時に API / localStorage へ渡す中間データ型。
// questionsAsked / myAnswers は UI の QuestionAnswerItem[] から生成される旧形式文字列。
// 新規コードでは QuestionAnswerItem[] を直接扱い、
// 送信直前にのみこの型へ変換すること。
//
// QuestionAnswerItem は中立レイヤー（types/interview.ts）に移管済み。
// 当ファイルは record 機能のフォーム固有型のみを置く。
export type InterviewRecordFormData = {
  // 基本情報
  practiceDate: string;
  partner: string;
  universityName: string;
  facultyName: string;
  examType: string;
  // 旧形式文字列（保存・API送信の互換用）。
  // UI は QuestionAnswerItem[] で管理し、送信時にこの形式へ変換する。
  questionsAsked: string;
  myAnswers: string;
  whatWentWrong: string;
  feedbackReceived: string;
  selfNoted: string;
};
