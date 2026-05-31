// マイページ MVP 用の read-only データ集約レイヤ。
//
// 役割:
//   既存 lib/*Storage.ts の loader 群を呼び、UI が必要とする派生値（合計件数 /
//   スコア delta / 日別グルーピング / 最近の活動）を 1 つの MypageData 型にまとめて返す。
//
// 厳守事項:
//   - localStorage への write 禁止（read only）
//   - localStorage key 名を直接読まない（必ず既存 storage helper 経由）
//   - 既存スキーマ・保存形式を変更しない
//   - Supabase / Auth / user_id を一切呼ばない
//   - daily limit (deepDiveUsage 等) を「履歴」として扱わない
//     （翌日に値が消える設計のため、時系列に流さない。今日の残数のみ表示用）
//
// Supabase 化するときは本ファイルだけを差し替える設計。
// 各 loader は SSR ガード済みなので、本ファイルの SSR ガードは entry 関数だけで足りる。
//
// 関連監査: マイページ MVP 棚卸し監査（A〜I）

import type { DiagnosisType } from '@/types/diagnosis';
import type { EssayWorkspace } from '@/types/essay';
import type { SelfAnalysisLog } from '@/types/selfAnalysisLog';
import type { SelfPR } from '@/types/selfPR';

import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { loadDiagnosisResult } from '@/lib/diagnosisStorage';
import {
  loadReviewHistory,
  type ReviewHistoryItem,
} from '@/lib/statement/review/statementStorage';
import { statementResultToScore } from '@/lib/statement/score/statementScore';
import { loadEssayWorkspaces } from '@/lib/essayWorkspaceStorage';
import {
  getInterviewRecords,
  type StoredInterviewRecord,
} from '@/lib/interviewRecordStorage';
import { loadSelfPRs } from '@/lib/selfPRStorage';
import { loadSelfAnalysisLogs } from '@/lib/selfAnalysisLogStorage';
import {
  loadAiMatchAdviceCache,
  loadAiMatchAdviceTimestamp,
  type AiMatchAdviceCache,
} from '@/lib/admissionMatchingStorage';
import {
  deepDiveLimit,
  selfAnalysisLimit,
  additionalQuestionsLimit,
  tutorLimit,
} from '@/lib/dailyLimit';
import {
  getTodayReviewCount,
  getRemainingStatementReviewCount,
} from '@/lib/statement/review/statementLimit';
import { getStatementPrepareLimitStatus } from '@/lib/statement/prepare/statementPrepareLimit';

// ── 公開型 ────────────────────────────────────────────────────────

export type ScorePoint = {
  createdAt: string; // ISO
  total: number; // 0〜100
};

export type EssayScorePoint = ScorePoint & {
  workspaceId: string;
};

export type ActivityDayPoint = {
  date: string; // YYYY-MM-DD
  count: number;
};

export type RecentActivityFeature =
  | 'statement'
  | 'essay'
  | 'interview'
  | 'selfAnalysis'
  | 'selfPR'
  | 'diagnosis'
  | 'matching';

export type RecentActivityItem = {
  date: string; // ISO（並べ替え・表示両用）
  feature: RecentActivityFeature;
  label: string; // UI 表示用ラベル
  // 既存 storage から派生できる範囲の補足情報。
  //   - statement / essay: "57点" のようなスコア
  //   - diagnosis: "タイプ N"
  //   - matching / interview / selfAnalysis / selfPR: 状態詞（"完了" / "練習" など）
  // 計算できない場合は undefined。UI 側で空フォールバックを担当。
  detail?: string;
};

// 月間ランキング 1 行。
//   - feature: RecentActivityFeature と同集合（紐づけ用）
//   - label: 表示用日本語ラベル
//   - count: 当月の活動件数
export type MonthlyRankingItem = {
  feature: RecentActivityFeature;
  label: string;
  count: number;
};

export type DailyLimitSnapshot = {
  count: number;
  remaining: number;
};

export type MypageData = {
  header: {
    name?: string;
    grade?: string;
    applicantType: DiagnosisType | null;
  };
  summary: {
    // ① 総活動回数（志望理由書 + 小論文 reviews + 自己分析 + 面接）
    totalActivityCount: number;
    // ② 成長サマリー（per-feature only。全体スコア合成は作らない）
    statementLatest: { total: number; delta: number | null } | null;
    essayLatest: { total: number; delta: number | null } | null;
    // ④ 活動実績の件数
    statementCount: number;
    essayReviewCount: number;
    interviewCount: number;
    selfAnalysisCount: number;
    selfPRCount: number;
  };
  scoreTimeline: {
    // ③ 折れ線グラフ。古い順（昇順）で並べる。空配列は「データ不足」。
    statement: ScorePoint[];
    essay: EssayScorePoint[];
  };
  activityByDay: ActivityDayPoint[];
  recentActivities: RecentActivityItem[];
  // 今月の活動ランキング（件数降順 / 上位 3 / count > 0 のみ）。
  // 月境界は ISO の先頭 'YYYY-MM' で判定（タイムゾーン誤差は最大 ±1 日、MVP 許容）。
  monthlyRanking: MonthlyRankingItem[];
  // 累計活動日数（unique 日数）。activityByDay.length と同値だが、UI 側の意味的に切り出す。
  activeDayCount: number;
  // 今月の活動日数（unique 日数 / 当月のみ）。
  monthlyActiveDayCount: number;
  history: {
    statement: ReviewHistoryItem[];
    essay: EssayWorkspace[];
    interview: StoredInterviewRecord[];
    selfAnalysis: SelfAnalysisLog[];
    selfPR: SelfPR[];
    matching: { cache: AiMatchAdviceCache | null; timestamp: string | null };
  };
  todayUsage: {
    deepDive: DailyLimitSnapshot;
    selfAnalysis: DailyLimitSnapshot;
    additionalQuestions: DailyLimitSnapshot;
    tutor: DailyLimitSnapshot;
    statementReview: DailyLimitSnapshot;
    statementPrepare: DailyLimitSnapshot;
  };
};

// SSR や mount 前の安全フォールバック。UI 側が分岐なしで render できる shape。
export const EMPTY_MYPAGE_DATA: MypageData = {
  header: { applicantType: null },
  summary: {
    totalActivityCount: 0,
    statementLatest: null,
    essayLatest: null,
    statementCount: 0,
    essayReviewCount: 0,
    interviewCount: 0,
    selfAnalysisCount: 0,
    selfPRCount: 0,
  },
  scoreTimeline: { statement: [], essay: [] },
  activityByDay: [],
  recentActivities: [],
  monthlyRanking: [],
  activeDayCount: 0,
  monthlyActiveDayCount: 0,
  history: {
    statement: [],
    essay: [],
    interview: [],
    selfAnalysis: [],
    selfPR: [],
    matching: { cache: null, timestamp: null },
  },
  todayUsage: {
    deepDive: { count: 0, remaining: 0 },
    selfAnalysis: { count: 0, remaining: 0 },
    additionalQuestions: { count: 0, remaining: 0 },
    tutor: { count: 0, remaining: 0 },
    statementReview: { count: 0, remaining: 0 },
    statementPrepare: { count: 0, remaining: 0 },
  },
};

// ── 公開エントリ ──────────────────────────────────────────────────

export function loadMypageData(): MypageData {
  if (typeof window === 'undefined') return EMPTY_MYPAGE_DATA;

  // ── 1. 各 storage の生データを既存 helper 経由でだけ取る ────
  const basicInfo = loadBasicInfo();
  const diagnosis = loadDiagnosisResult();
  const statementHistory = loadReviewHistory(); // 降順（new → old）
  const essayWorkspaces = loadEssayWorkspaces(); // updatedAt 降順
  const interviewRecords = getInterviewRecords(); // 降順（new → old）
  const selfAnalysisLogs = loadSelfAnalysisLogs(); // 追加順（old → new）
  const selfPRs = loadSelfPRs(); // 追加順だが createdAt は optional
  const matchingCache = loadAiMatchAdviceCache();
  const matchingTimestamp = loadAiMatchAdviceTimestamp();

  // ── 2. 派生: スコア時系列（古 → 新で昇順に揃える） ──────
  const statementTimeline = buildStatementTimeline(statementHistory);
  const essayTimeline = buildEssayTimeline(essayWorkspaces);

  // ── 3. 派生: 成長サマリー delta（latest - first。1 件以下は null） ──
  const statementLatest = summarizeTimeline(statementTimeline);
  const essayLatest = summarizeEssayTimeline(essayTimeline);

  // ── 4. 派生: 件数 ──────────────────────────────────────────
  const statementCount = statementHistory.length;
  const essayReviewCount = essayWorkspaces.reduce(
    (acc, w) => acc + w.reviews.length,
    0,
  );
  const interviewCount = interviewRecords.length;
  const selfAnalysisCount = selfAnalysisLogs.length;
  const selfPRCount = selfPRs.length;

  // 総活動回数（user 仕様: 志望理由書 + 小論文 + 自己分析 + 面接 の 4 機能）
  const totalActivityCount =
    statementCount + essayReviewCount + interviewCount + selfAnalysisCount;

  // ── 5. 派生: 最近の活動 / 月次集計の共通入力を 1 度だけ計算 ──
  const sources: RecentSources = {
    statementHistory,
    essayWorkspaces,
    interviewRecords,
    selfAnalysisLogs,
    selfPRs,
    diagnosisCreatedAt: diagnosis?.createdAt ?? null,
    matchingTimestamp,
  };
  const allActivities = recentActivitiesAll(sources, diagnosis, matchingCache);
  const recentActivities = allActivities.slice(0, 5);

  // ── 6. 派生: 日別活動回数 ─────────────────────────────────
  const activityByDay = buildActivityByDay(allActivities);

  // ── 6.5. 派生: 月次サマリー（今月の活動ランキング + 今月の活動日数） ──
  // 月境界判定は ISO 文字列の 'YYYY-MM' 先頭 7 文字スライス。
  // タイムゾーン誤差は最大 ±1 日（UTC 解釈）— MVP 許容範囲。
  const thisMonthPrefix = currentMonthPrefix();
  const monthlyActivities = allActivities.filter((a) =>
    a.date.startsWith(thisMonthPrefix),
  );
  const monthlyRanking = buildMonthlyRanking(monthlyActivities);
  const monthlyActiveDayCount = activityByDay.filter((d) =>
    d.date.startsWith(thisMonthPrefix),
  ).length;
  const activeDayCount = activityByDay.length;

  // ── 7. 今日の使用量（履歴ではない。1 日分のスナップショット） ──
  const deepDiveUsage = deepDiveLimit.loadUsage();
  const selfAnalysisUsage = selfAnalysisLimit.loadUsage();
  const additionalQuestionsUsage = additionalQuestionsLimit.loadUsage();
  const tutorUsage = tutorLimit.loadUsage();
  const statementPrepareStatus = getStatementPrepareLimitStatus();

  return {
    header: {
      name: basicInfo?.name?.trim() ? basicInfo.name : undefined,
      grade: basicInfo?.grade?.trim() ? basicInfo.grade : undefined,
      applicantType: diagnosis?.resultType ?? null,
    },
    summary: {
      totalActivityCount,
      statementLatest,
      essayLatest,
      statementCount,
      essayReviewCount,
      interviewCount,
      selfAnalysisCount,
      selfPRCount,
    },
    scoreTimeline: {
      statement: statementTimeline,
      essay: essayTimeline,
    },
    activityByDay,
    recentActivities,
    monthlyRanking,
    activeDayCount,
    monthlyActiveDayCount,
    history: {
      statement: statementHistory,
      essay: essayWorkspaces,
      interview: interviewRecords,
      selfAnalysis: selfAnalysisLogs,
      selfPR: selfPRs,
      matching: { cache: matchingCache, timestamp: matchingTimestamp },
    },
    todayUsage: {
      deepDive: {
        count: deepDiveUsage.count,
        remaining: deepDiveLimit.getRemainingCount(deepDiveUsage),
      },
      selfAnalysis: {
        count: selfAnalysisUsage.count,
        remaining: selfAnalysisLimit.getRemainingCount(selfAnalysisUsage),
      },
      additionalQuestions: {
        count: additionalQuestionsUsage.count,
        remaining: additionalQuestionsLimit.getRemainingCount(additionalQuestionsUsage),
      },
      tutor: {
        count: tutorUsage.count,
        remaining: tutorLimit.getRemainingCount(tutorUsage),
      },
      statementReview: {
        count: getTodayReviewCount(),
        remaining: getRemainingStatementReviewCount(),
      },
      statementPrepare: {
        count: statementPrepareStatus.count,
        remaining: statementPrepareStatus.remaining,
      },
    },
  };
}

// ── 派生ヘルパー ──────────────────────────────────────────────────

function buildStatementTimeline(history: ReviewHistoryItem[]): ScorePoint[] {
  // statementReviewHistory は降順（new → old）保存。昇順に並べ替える。
  //
  // shape guard:
  //   localStorage はシステム境界なので malformed entry（createdAt 欠落 /
  //   result.evaluations 不在）が混入する余地がある。statement 系は既存の
  //   statementScoreSource.ts:getStatementScoreDelta が Array.isArray ガードを
  //   入れている defensive 規約に追従し、ここでも entry 単位で除外する。
  //   essayWorkspaces 側は normalize で epoch fallback が入っているためガード不要。
  return history
    .filter(
      (item) =>
        typeof item.createdAt === 'string' &&
        item.result &&
        Array.isArray(item.result.evaluations),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((item) => ({
      createdAt: item.createdAt,
      total: statementResultToScore(item.result).total,
    }));
}

function buildEssayTimeline(workspaces: EssayWorkspace[]): EssayScorePoint[] {
  // 全 workspace の reviews を flatten。LRU で古い workspace が drop していても
  // 残っている workspace の reviews だけで時系列を構築する（許容）。
  const points: EssayScorePoint[] = [];
  for (const ws of workspaces) {
    for (const r of ws.reviews) {
      points.push({
        createdAt: r.createdAt,
        total: r.totalScore,
        workspaceId: ws.id,
      });
    }
  }
  return points.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function summarizeTimeline(
  points: ScorePoint[],
): { total: number; delta: number | null } | null {
  if (points.length === 0) return null;
  const latest = points[points.length - 1].total;
  const first = points[0].total;
  // 1 件しか無いと delta は意味を持たない（null = 表示は "—"）
  const delta = points.length >= 2 ? latest - first : null;
  return { total: latest, delta };
}

function summarizeEssayTimeline(
  points: EssayScorePoint[],
): { total: number; delta: number | null } | null {
  return summarizeTimeline(points);
}

// ── 最近の活動 / 日別集計 ─────────────────────────────────────────

type RecentSources = {
  statementHistory: ReviewHistoryItem[];
  essayWorkspaces: EssayWorkspace[];
  interviewRecords: StoredInterviewRecord[];
  selfAnalysisLogs: SelfAnalysisLog[];
  selfPRs: SelfPR[];
  diagnosisCreatedAt: string | null;
  matchingTimestamp: string | null;
};

// 全活動を 1 つの配列に正規化（日別集計と最近活動の共通入力）。
// createdAt が無いエントリ（旧 SelfPR 等）は除外する。
//
// detail は「既存 storage から取れる値」のみで埋める:
//   - statement: statementResultToScore(item.result).total を "57点" 形式で
//   - essay:     review.totalScore を "62点" 形式で
//   - diagnosis: result.resultType を "タイプ N" 形式で
//   - interview: feedbackJson の有無で "AI評価あり" / "練習記録"
//   - selfAnalysis: "完了"（数値スコアは無いため）
//   - selfPR:    title があれば title、無ければ undefined（label を素のまま使う）
//   - matching:  resultType に応じ "AI診断" / "簡易診断"
function recentActivitiesAll(
  src: RecentSources,
  diagnosis: ReturnType<typeof loadDiagnosisResult>,
  matchingCache: ReturnType<typeof loadAiMatchAdviceCache>,
): RecentActivityItem[] {
  const items: RecentActivityItem[] = [];

  for (const s of src.statementHistory) {
    // buildStatementTimeline と同一の shape guard（malformed entry を除外）。
    if (
      typeof s.createdAt === 'string' &&
      s.result &&
      Array.isArray(s.result.evaluations)
    ) {
      const total = statementResultToScore(s.result).total;
      items.push({
        date: s.createdAt,
        feature: 'statement',
        label: '志望理由書添削',
        detail: `${total}点`,
      });
    }
  }

  for (const ws of src.essayWorkspaces) {
    for (const r of ws.reviews) {
      if (r.createdAt) {
        items.push({
          date: r.createdAt,
          feature: 'essay',
          label: '小論文添削',
          detail: `${r.totalScore}点`,
        });
      }
    }
  }

  for (const r of src.interviewRecords) {
    if (r.createdAt) {
      items.push({
        date: r.createdAt,
        feature: 'interview',
        label: '面接練習',
        detail: r.feedbackJson ? 'AI評価あり' : '練習記録',
      });
    }
  }

  for (const l of src.selfAnalysisLogs) {
    if (l.createdAt) {
      items.push({
        date: l.createdAt,
        feature: 'selfAnalysis',
        label: '自己分析',
        detail: '完了',
      });
    }
  }

  // SelfPR の createdAt は optional。undefined は除外（updatedAt に倒さない —
  // 編集時刻と作成時刻を混同しないため）。
  // title が空文字でないときだけ detail として使う。
  for (const pr of src.selfPRs) {
    if (pr.createdAt) {
      const title = pr.title?.trim();
      items.push({
        date: pr.createdAt,
        feature: 'selfPR',
        label: '自己PR作成',
        detail: title ? title : undefined,
      });
    }
  }

  if (src.diagnosisCreatedAt && diagnosis) {
    items.push({
      date: src.diagnosisCreatedAt,
      feature: 'diagnosis',
      label: '受験タイプ診断',
      detail: `タイプ ${diagnosis.resultType}`,
    });
  }

  if (src.matchingTimestamp) {
    const level = matchingCache?.matchingLevel;
    items.push({
      date: src.matchingTimestamp,
      feature: 'matching',
      label: '志望校マッチング',
      detail: level === 'full' ? 'AI診断' : level === 'basic' ? '簡易診断' : undefined,
    });
  }

  return items.sort((a, b) => b.date.localeCompare(a.date));
}

// 今月の活動ランキング:
//   feature ごとに件数を合計 → 件数 desc → 同数なら feature 列挙順を保つ → 上位 3 件
//   count 0 の機能は表示しない（"未着手の機能を 0 位として並べない" UX 判断）。
function buildMonthlyRanking(
  monthlyItems: RecentActivityItem[],
): MonthlyRankingItem[] {
  if (monthlyItems.length === 0) return [];

  // feature → { label, count }。最初に出現した label を採用（label は feature 単位で一貫）。
  const counts = new Map<RecentActivityFeature, MonthlyRankingItem>();
  for (const item of monthlyItems) {
    const existing = counts.get(item.feature);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(item.feature, {
        feature: item.feature,
        label: featureToRankingLabel(item.feature),
        count: 1,
      });
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

// ランキング表示用ラベル。RecentActivityItem.label とは別軸（"〜添削" を機能名に丸める）。
function featureToRankingLabel(feature: RecentActivityFeature): string {
  switch (feature) {
    case 'statement':
      return '志望理由書';
    case 'essay':
      return '小論文';
    case 'interview':
      return '面接練習';
    case 'selfAnalysis':
      return '自己分析';
    case 'selfPR':
      return '自己PR';
    case 'diagnosis':
      return '受験タイプ診断';
    case 'matching':
      return '志望校マッチング';
    default:
      return '活動';
  }
}

// 'YYYY-MM' の先頭 7 文字（UTC 解釈）。
// 月境界の判定が±1 日ズレる可能性があるが、月間集計の精度として MVP 許容。
function currentMonthPrefix(): string {
  return new Date().toISOString().slice(0, 7);
}

function buildActivityByDay(items: RecentActivityItem[]): ActivityDayPoint[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const day = toYmd(item.date);
    if (!day) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ISO 文字列から YYYY-MM-DD を取り出す。parse 失敗時は null。
function toYmd(iso: string): string | null {
  // 最低限 'YYYY-MM-DD' 形が含まれていれば先頭 10 文字をそのまま使う。
  // Date 経由にするとタイムゾーン解釈で日が 1 つズレるリスクがあるため、
  // ISO 文字列の先頭をそのまま採用する（localStorage に入る ISO は UTC）。
  // 表示用の精度（日単位）として十分。
  if (iso.length >= 10 && iso[4] === '-' && iso[7] === '-') {
    return iso.slice(0, 10);
  }
  return null;
}
