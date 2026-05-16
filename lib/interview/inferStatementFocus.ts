// 面接フィードバックの「issue 文字列」から、志望理由書のどの section を
// 直すべきかを keyword ベースで推定する pure function。
//
// 役割:
//   STEP7.1 (buildStatementImprovementHints) と STEP10.3 (InterviewGrowthMemo) が
//   それぞれ独立に持っていた keyword 辞書を 1 箇所に集約する。
//   keyword の更新を片方だけ忘れる drift を防ぐ。
//
// 設計方針:
//   - AI を呼ばない deterministic 変換（受験生視点で誤推定があっても軽症な領域）
//   - localStorage / fetch / DB に触れない pure function
//   - 配列の先頭から評価し、最初にヒットした section を返す
//   - どの keyword にもヒットしなければ null（呼び出し側で 'other' フォールバック等を決める）
//
// keyword 優先順位:
//   1. university_fit を先頭に置く（「大学で学びたい」のような複合語で
//      motivation の「学び」とも反応しうる際に university_fit を優先したい）
//   2. future_goal / past_experience / problem_awareness / motivation の順
//
// 関連:
//   types/statementInterviewInsights.ts (StatementImprovementTargetSection)
//   lib/interview/buildStatementImprovementHints.ts (consumer。null → 'other' フォールバック)
//   app/interview/history/components/InterviewGrowthMemo.tsx (consumer。null → 素の /statement/edit)

import type { StatementImprovementTargetSection } from '@/types/statementInterviewInsights';

// patterns は string[]（`.some(p => text.includes(p))`）で評価する。
// 正規表現 alternation と等価だが、個別 keyword を grep しやすい配列形式を採用。
const SECTION_KEYWORDS: ReadonlyArray<{
  section: StatementImprovementTargetSection;
  patterns: readonly string[];
}> = [
  {
    section: 'university_fit',
    patterns: ['大学', '学部', '学科', 'カリキュラム', '授業', '研究', 'ゼミ', '教授', '専攻'],
  },
  {
    section: 'future_goal',
    patterns: ['将来', '目標', '進路', '就職', 'キャリア', '卒業後', '10年後'],
  },
  {
    section: 'past_experience',
    patterns: ['活動', '経験', '体験', '役割', '成果', '実績', 'エピソード'],
  },
  {
    section: 'problem_awareness',
    patterns: ['問題', '課題', '社会', '困っ', '気づ', '疑問', '違和感'],
  },
  {
    section: 'motivation',
    patterns: ['なぜ', '動機', 'きっかけ', '志望', '興味', '関心', '魅力'],
  },
];

export function inferStatementFocus(
  text: string,
): StatementImprovementTargetSection | null {
  if (typeof text !== 'string') return null;
  if (text === '') return null;
  for (const { section, patterns } of SECTION_KEYWORDS) {
    if (patterns.some((p) => text.includes(p))) return section;
  }
  return null;
}
