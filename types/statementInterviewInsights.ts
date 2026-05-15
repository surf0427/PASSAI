// 面接フィードバック → 志望理由書改善 への変換層の型定義。
//
// 役割:
//   PASSAI の循環（活動 → 自己分析 → 志望理由書 → 面接 → 改善 → 再面接）の
//   「面接 → 改善」レーンを表現するための中間型。
//   面接で出た弱点・浅い点・矛盾・追加質問を、志望理由書のどのセクションを
//   どう書き直すかというヒントへ変換する。
//
// 関連:
//   lib/interview/buildStatementImprovementHints.ts（本型を生成する deterministic builder）

// 志望理由書の「どこを直すか」を粗く識別するセクション ID。
// 完全な構造解析ではなく「ヒントを志望理由書のどの観点に紐づけて見せるか」のため。
export type StatementImprovementTargetSection =
  | 'motivation'
  | 'past_experience'
  | 'problem_awareness'
  | 'university_fit'
  | 'future_goal'
  | 'other';

export type StatementImprovementHint = {
  targetSection: StatementImprovementTargetSection;
  // 面接で出てきた弱点・浅い点・矛盾の文（normalize 済み）
  issue: string;
  // 「なぜ志望理由書を直すべきか」を 1 文で示す（面接視点）
  reasonFromInterview: string;
  // section に応じた書き直し方向（代筆ではなく観点）
  suggestedDirection: string;
};

export type StatementInterviewInsights = {
  // 生成時刻（ISO）。「いつのフィードバックから派生したヒントか」を下流に明示する
  generatedAt: string;
  hints: StatementImprovementHint[];
};
