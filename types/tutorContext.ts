// 受験チューターAI の「PASSAI 内 生徒情報」context builder の入力型。
//
// 役割:
//   - buildTutorStudentContext（lib/contextBuilders/tutorStudentContext.ts）の
//     入力 shape を定義する。
//   - 各 field は HTTP body 経由で client から渡る生データのため unknown | null で受け、
//     builder 内で defensive に shape guard する
//     （既存 lib/contextBuilders/tutor/types.ts と同じ方針）。
//
// 設計方針:
//   - any を使わない。canonical 型を再宣言せず、想定 shape はコメントで明記する。
//   - field が未入力（null / 不正値）でも builder は throw せず「未入力」として扱う。
//
// 関連:
//   - lib/contextBuilders/tutorStudentContext.ts (consumer)
//   - types/basicInfo.ts (BasicInfo)
//   - types/studentProfile.ts (StudentProfile)
//   - types/statement.ts (StatementResult)
//   - types/activity.ts (ActivityData)
//   - lib/essayPracticeStorage.ts (SavedReview)

export type TutorStudentContextInput = {
  // BasicInfo 想定。preferences[].{university, faculty} から志望校を要約する。
  basicInfo?: unknown | null;
  // StudentProfile / compact profile 想定。summary / strengths / weaknesses を読む。
  studentProfile?: unknown | null;
  // StatementResult（または ReviewHistoryItem）想定。直近レビューの weaknesses を読む。
  statementReviewLatest?: unknown | null;
  // ActivityData 想定。各カテゴリ配列の件数を要約する。
  activityData?: unknown | null;
  // SavedReview 想定。直近の小論文添削の weakPoints を読む。
  essayReviewLatest?: unknown | null;
  // StoredInterviewRecord 想定（直近の面接練習記録）。
  // feedback が無いとき improvementSummary / whatWentWrong を fallback に使う。
  interviewRecordLatest?: unknown | null;
  // InterviewFeedback 想定（直近の AI 面接フィードバック）。improvements を最優先で読む。
  interviewFeedbackLatest?: unknown | null;
  // マイページ集約状況の compact projection 想定（STEP-TUTOR-CONTEXT-MYPAGE-01 /
  // STEP-TUTOR-CONTEXT-GROWTH-01）。
  //   { counts: { statement, essay, interview, selfAnalysis, selfPR },
  //     recentFeatures: string[], monthlyTopFeatures: string[],
  //     growth: { statement: number | null, essay: number | null } }
  // growth は delta（最新 − 最古 の差分）のみ。絶対スコア(total)・日付・chart series・
  // 本文・applicantType は含めない（client 側で除外済み）。delta は builder で定性ラベルへ
  // 変換され、数値は studentContext 文字列には一切出さない。
  mypageSummary?: unknown | null;
};
