// STEP 27: 整理メモの 5 項目間の「つながり」を簡易判定する。AI を呼ばないルールベース。
// 判定単位は 4 ペア（経験→課題、課題→興味、興味→大学、大学→将来）。
// 信号：
//   - 片側が空 / 短すぎ                                       → high
//   - 共通する重要語（漢字2+ / カタカナ2+）が 0 件             → medium
//   - 後続テキストに「なぜ／だから／そのため／きっかけ」等の
//     接続表現が無い                                          → medium
// 上記いずれにも該当しなければ gap を出さない（ロジックは一旦 OK）。

import type { StatementPrepareWeakPointInput } from '@/lib/statement/prepare/detectStatementPrepareWeakPoints';

export type StatementPrepareLogicGapKey =
  | 'experienceToIssue'
  | 'issueToInterest'
  | 'interestToUniversity'
  | 'universityToFuture';

export type StatementPrepareLogicGapSeverity = 'low' | 'medium' | 'high';

export type StatementPrepareLogicGap = {
  key: StatementPrepareLogicGapKey;
  label: string;
  reason: string;
  suggestion: string;
  severity: StatementPrepareLogicGapSeverity;
};

type Pair = {
  key: StatementPrepareLogicGapKey;
  label: string;
  fromLabel: string;
  toLabel: string;
  pickFrom: (s: StatementPrepareWeakPointInput) => string;
  pickTo: (s: StatementPrepareWeakPointInput) => string;
};

const PAIRS: ReadonlyArray<Pair> = [
  {
    key: 'experienceToIssue',
    label: '経験 → 課題意識',
    fromLabel: '印象に残った経験',
    toLabel: '気づいた課題',
    pickFrom: (s) => s.impressiveExperience,
    pickTo: (s) => s.feltIssue,
  },
  {
    key: 'issueToInterest',
    label: '課題意識 → 分野への興味',
    fromLabel: '気づいた課題',
    toLabel: '分野・学部への興味',
    pickFrom: (s) => s.feltIssue,
    pickTo: (s) => s.interestInField,
  },
  {
    key: 'interestToUniversity',
    label: '分野への興味 → 大学で学びたいこと',
    fromLabel: '分野・学部への興味',
    toLabel: '大学で学びたいこと',
    pickFrom: (s) => s.interestInField,
    pickTo: (s) => s.universityLearning,
  },
  {
    key: 'universityToFuture',
    label: '大学で学びたいこと → 将来像',
    fromLabel: '大学で学びたいこと',
    toLabel: '将来やりたいこと',
    pickFrom: (s) => s.universityLearning,
    pickTo: (s) => s.futureApplication,
  },
];

const CONNECTOR_REGEX =
  /(なぜ|だから|そのため|そこで|きっかけ|ため|から|ので|つながる|つなげ|活かし|生かし|だからこそ|そして)/;

function extractSignificantTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  (text.match(/[一-鿿]{2,}/g) ?? []).forEach((t) => tokens.add(t));
  (text.match(/[゠-ヿー]{2,}/g) ?? []).forEach((t) => tokens.add(t));
  return tokens;
}

function hasIntersection(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

const MIN_LENGTH = 15;

export function detectStatementPrepareLogicGaps(
  summary: StatementPrepareWeakPointInput,
): StatementPrepareLogicGap[] {
  const gaps: StatementPrepareLogicGap[] = [];

  for (const pair of PAIRS) {
    const from = pair.pickFrom(summary).trim();
    const to = pair.pickTo(summary).trim();

    if (from.length === 0 || to.length === 0) {
      const missing = from.length === 0 ? pair.fromLabel : pair.toLabel;
      gaps.push({
        key: pair.key,
        label: pair.label,
        reason: `${missing}が空のため、つながりを判定できません。`,
        suggestion: '短くてもよいので、両方の項目を一行ずつ埋めてみましょう。',
        severity: 'high',
      });
      continue;
    }

    if (from.length < MIN_LENGTH || to.length < MIN_LENGTH) {
      gaps.push({
        key: pair.key,
        label: pair.label,
        reason: `${pair.fromLabel}か${pair.toLabel}の内容が短く、つながりが見えにくい状態です。`,
        suggestion:
          'どちらかをもう少し具体的に書き足すと、自然なつながりが浮かびやすくなります。',
        severity: 'high',
      });
      continue;
    }

    const shared = hasIntersection(
      extractSignificantTokens(from),
      extractSignificantTokens(to),
    );
    const hasConnector = CONNECTOR_REGEX.test(to);

    if (!shared && !hasConnector) {
      gaps.push({
        key: pair.key,
        label: pair.label,
        reason:
          '共通するキーワードも、「なぜ」「だから」などの接続表現も見当たりません。',
        suggestion: `${pair.fromLabel}で触れた具体名や考えを、${pair.toLabel}でも引き継いで言及するとつながりが強まります。`,
        severity: 'medium',
      });
    } else if (!shared) {
      gaps.push({
        key: pair.key,
        label: pair.label,
        reason: `${pair.fromLabel}と${pair.toLabel}の間で、共通するキーワードが見えにくい状態です。`,
        suggestion: `${pair.fromLabel}に登場する具体的な語句を、${pair.toLabel}にも織り交ぜてみましょう。`,
        severity: 'medium',
      });
    } else if (!hasConnector) {
      gaps.push({
        key: pair.key,
        label: pair.label,
        reason:
          '「なぜ」「だから」「そのため」など、因果を示す接続表現が弱い印象です。',
        suggestion: `${pair.fromLabel}から${pair.toLabel}へつなげる理由を、接続語を使って明示するとロジックが強まります。`,
        severity: 'medium',
      });
    }
  }

  return gaps;
}
