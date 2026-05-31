// STEP 25: /statement/prepare で「これまでに整理した材料」として表示するカードを組み立てる。
// 入力データには触れず、表示用のフラットな配列に整形するだけ（純関数）。
// データソース：
//   - lib/activityStorage.ts (loadActivityData)        → ActivityData | null
//   - lib/analyzeStorage.ts  (loadAnalyzeState)        → PersistedAnalyzeState | null

import type { ActivityData } from '@/types/activity';
import type { PersistedAnalyzeState } from '@/types/analysis';

export type StatementPrepareMaterialSource = '活動整理' | '自己分析';

export type StatementPrepareMaterial = {
  id: string;
  source: StatementPrepareMaterialSource;
  category: string;            // 「部活動 / 軽音楽部」「AI壁打ち：強み」など
  body: string;                // 中身の要約テキスト
  reflection?: string;         // 学び（任意）
  futureConnection?: string;   // 将来とのつながり（任意）
};

// 空文字列を弾いて " — " で結合。0 件なら空文字。
function joinNonEmpty(parts: ReadonlyArray<string | undefined | null>): string {
  return parts.map((s) => (s ?? '').trim()).filter((s) => s.length > 0).join(' — ');
}

function pushIfBody(
  out: StatementPrepareMaterial[],
  base: Omit<StatementPrepareMaterial, 'body' | 'reflection' | 'futureConnection'> & {
    body: string;
    reflection?: string;
    futureConnection?: string;
  },
): void {
  // body も学びも将来も全部空ならカード自体出さない（情報量ゼロ）。
  if (
    base.body.length === 0 &&
    !(base.reflection ?? '').trim() &&
    !(base.futureConnection ?? '').trim()
  ) {
    return;
  }
  out.push({
    ...base,
    reflection: (base.reflection ?? '').trim() || undefined,
    futureConnection: (base.futureConnection ?? '').trim() || undefined,
  });
}

export function buildStatementPrepareMaterials(
  activity: ActivityData | null,
  analyze: PersistedAnalyzeState | null,
): StatementPrepareMaterial[] {
  const out: StatementPrepareMaterial[] = [];

  if (activity) {
    activity.clubActivities.forEach((a, i) =>
      pushIfBody(out, {
        id: `club-${i}`,
        source: '活動整理',
        category: `部活動 / ${a.clubName || '名称未設定'}`,
        body: joinNonEmpty([a.sport, a.role, a.description, a.achievement]),
        reflection: a.reflection,
        futureConnection: a.futureConnection,
      }),
    );
    activity.volunteerActivities.forEach((a, i) =>
      pushIfBody(out, {
        id: `volunteer-${i}`,
        source: '活動整理',
        category: `ボランティア / ${a.activityContent || '名称未設定'}`,
        body: joinNonEmpty([a.target, a.purpose, a.description, a.achievement]),
        reflection: a.reflection,
        futureConnection: a.futureConnection,
      }),
    );
    activity.studyAbroadActivities.forEach((a, i) =>
      pushIfBody(out, {
        id: `studyAbroad-${i}`,
        source: '活動整理',
        category: `留学 / ${a.destination || '留学先未設定'}`,
        body: joinNonEmpty([a.programContent, a.language, a.description, a.achievement]),
        reflection: a.reflection,
        futureConnection: a.futureConnection,
      }),
    );
    activity.researchActivities.forEach((a, i) =>
      pushIfBody(out, {
        id: `research-${i}`,
        source: '活動整理',
        category: `探究 / ${a.theme || 'テーマ未設定'}`,
        body: joinNonEmpty([a.trigger, a.methodology, a.output, a.achievement]),
        reflection: a.reflection,
        futureConnection: a.futureConnection,
      }),
    );
    activity.partTimeJobActivities.forEach((a, i) =>
      pushIfBody(out, {
        id: `partTimeJob-${i}`,
        source: '活動整理',
        category: `アルバイト / ${a.industry || '業種未設定'}`,
        body: joinNonEmpty([a.jobContent, a.description, a.achievement]),
        reflection: a.reflection,
        futureConnection: a.futureConnection,
      }),
    );
    activity.certificationActivities.forEach((a, i) =>
      pushIfBody(out, {
        id: `certification-${i}`,
        source: '活動整理',
        category: `資格 / ${a.certificationName || '名称未設定'}`,
        body: joinNonEmpty([a.level, a.purpose, a.studyMethod]),
        reflection: a.reflection,
        futureConnection: a.futureConnection,
      }),
    );
    activity.contestActivities.forEach((a, i) =>
      pushIfBody(out, {
        id: `contest-${i}`,
        source: '活動整理',
        category: `コンテスト / ${a.contestName || '名称未設定'}`,
        body: joinNonEmpty([a.field, a.result, a.description, a.achievement]),
        reflection: a.reflection,
        futureConnection: a.futureConnection,
      }),
    );
    activity.readingActivities.forEach((a, i) =>
      pushIfBody(out, {
        id: `reading-${i}`,
        source: '活動整理',
        category: `読書 / ${a.favoriteBook || '書名未設定'}`,
        body: joinNonEmpty([a.genre, a.reason, a.mindChange]),
        reflection: a.reflection,
      }),
    );
    activity.hobbyActivities.forEach((a, i) =>
      pushIfBody(out, {
        id: `hobby-${i}`,
        source: '活動整理',
        category: `趣味 / ${a.hobbyContent || '内容未設定'}`,
        body: joinNonEmpty([a.reason, a.innovation, a.acquiredSkills]),
      }),
    );
    activity.otherActivities.forEach((a, i) =>
      pushIfBody(out, {
        id: `other-${i}`,
        source: '活動整理',
        category: `その他 / ${a.activityName || '名称未設定'}`,
        body: joinNonEmpty([a.role, a.description, a.achievement]),
        reflection: a.reflection,
        futureConnection: a.futureConnection,
      }),
    );
  }

  if (analyze?.analysis) {
    const analysis = analyze.analysis;
    if (analysis.summary.trim()) {
      pushIfBody(out, {
        id: 'analyze-summary',
        source: '自己分析',
        category: 'AI壁打ち：まとめ',
        body: analysis.summary,
      });
    }
    if (analysis.strengths.length > 0) {
      pushIfBody(out, {
        id: 'analyze-strengths',
        source: '自己分析',
        category: 'AI壁打ち：強み',
        body: analysis.strengths.join(' / '),
      });
    }
    if (analysis.futureConnections.length > 0) {
      pushIfBody(out, {
        id: 'analyze-futures',
        source: '自己分析',
        category: 'AI壁打ち：将来とのつながり',
        body: analysis.futureConnections.join(' / '),
      });
    }
  }

  if (analyze?.summary) {
    const sum = analyze.summary;
    if (sum.activitySummary.trim()) {
      pushIfBody(out, {
        id: 'analyze-activitysum',
        source: '自己分析',
        category: 'AI壁打ち：活動の要約',
        body: sum.activitySummary,
      });
    }
    if (sum.appealPoints.trim()) {
      pushIfBody(out, {
        id: 'analyze-appeal',
        source: '自己分析',
        category: 'AI壁打ち：アピールポイント',
        body: sum.appealPoints,
      });
    }
  }

  return out;
}
