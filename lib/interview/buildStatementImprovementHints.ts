// 面接フィードバック → 志望理由書改善ヒント への変換 builder。
//
// 責務:
//   - AI を呼ばない deterministic 変換
//   - localStorage / DB / fetch に触れない pure function
//   - 面接で出た「弱点・浅い点・矛盾・深掘りされた追加質問」を、
//     志望理由書の section ヒントへキーワードベースで紐づけ直す
//
// 設計意図:
//   厳密な分類は AI 化を後段に控える。本 builder は「面接で詰まる → 志望理由書のここを直す」
//   の導線を deterministic に張るための土台。100% 正確な分類は目的ではない。
//
// 関連: types/statementInterviewInsights.ts

import type {
  StatementImprovementHint,
  StatementImprovementTargetSection,
  StatementInterviewInsights,
} from '@/types/statementInterviewInsights';
import { inferStatementFocus } from '@/lib/interview/inferStatementFocus';

type IssueSource = 'weakness' | 'shallow' | 'contradiction' | 'followUp';

const MAX_HINTS = 5;
const ISSUE_DISPLAY_MAX_CHARS = 100;

// 入力ソース別に「なぜ志望理由書を直すか」の固定文言。
// 面接視点での 1 文に揃え、AI でない deterministic な説明に留める。
const REASON_BY_SOURCE: Record<IssueSource, string> = {
  weakness: '面接で弱点として指摘される可能性があります。',
  shallow: '面接で内容が浅いと評価される可能性があります。',
  contradiction: '面接で矛盾点として突っ込まれる可能性があります。',
  followUp: '面接でこの観点を深掘りされる可能性があります。',
};

// section 別の改善方向。代筆にならないよう、書き直し方向を観点として提示する。
const DIRECTION_BY_SECTION: Record<StatementImprovementTargetSection, string> = {
  motivation: '志望動機を、自分の経験と結びつけて具体的に書き直してください。',
  past_experience: '活動経験を「状況・行動・結果・学び」の構造で具体化してください。',
  problem_awareness: '課題意識を、なぜそれを問題と感じたかまで掘り下げて書いてください。',
  university_fit: '大学で学びたいテーマ・授業・研究分野を具体化してください。',
  future_goal: '将来像と大学での学びの接続を、具体的なステップで書いてください。',
  other: '該当箇所を見直して、より具体的に書き直してください。',
};

// section 推定は lib/interview/inferStatementFocus.ts に集約済み。
// 推定不可（null）のときは 'other' フォールバックを使うのが本 builder の責務。
function inferSection(issue: string): StatementImprovementTargetSection {
  return inferStatementFocus(issue) ?? 'other';
}

export function buildStatementImprovementHints(input: {
  weaknesses?: string[];
  shallowPoints?: string[];
  contradictionPoints?: string[];
  followUpQuestions?: string[];
}): StatementInterviewInsights {
  // 評価順序: 弱点 → 浅い点 → 矛盾 → 追加質問。
  // 重要度の高い面接所見ほど志望理由書改善に直結するため先に処理する。
  const sources: Array<{ items: readonly string[] | undefined; source: IssueSource }> = [
    { items: input.weaknesses, source: 'weakness' },
    { items: input.shallowPoints, source: 'shallow' },
    { items: input.contradictionPoints, source: 'contradiction' },
    { items: input.followUpQuestions, source: 'followUp' },
  ];

  const seen = new Set<string>();
  const hints: StatementImprovementHint[] = [];

  outer: for (const { items, source } of sources) {
    if (!Array.isArray(items)) continue;
    for (const raw of items) {
      if (typeof raw !== 'string') continue;
      const issue = normalizeIssue(raw);
      if (issue === '') continue;
      if (seen.has(issue)) continue;
      seen.add(issue);

      const section = inferSection(issue);
      hints.push({
        targetSection: section,
        issue,
        reasonFromInterview: REASON_BY_SOURCE[source],
        suggestedDirection: DIRECTION_BY_SECTION[section],
      });
      if (hints.length >= MAX_HINTS) break outer;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    hints,
  };
}

// ── 内部 helper ───────────────────────────────────────────────────

function normalizeIssue(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return '';
  if (collapsed.length <= ISSUE_DISPLAY_MAX_CHARS) return collapsed;
  return `${collapsed.slice(0, ISSUE_DISPLAY_MAX_CHARS - 1)}…`;
}
