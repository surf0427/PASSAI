// マイページ「AI面接 成長記録」用の集計ヘルパー（純関数）。
//
// 方針（厳守）:
//   - DB 変更・API 追加・新規 AI 実行なし。本人の completed AI 面接セッション + 既存 finalFeedback
//     （interview_ai_sessions / interview_ai_results）を client が read-through で取得し、
//     ここで「集計のみ」で成長記録を組み立てる純粋ロジック。
//   - 数値化は内部の「推定」にとどめ、UI には ⬇️要改善 / ➡️安定 / ⬆️成長中 のカテゴリだけ出す（仕様）。
//   - interviewTypes.ts は client-safe（'server-only' なし）なので import 可。
//   - feedback の levelEvaluation 5 軸（logical/concrete/consistency/originality/interviewReadiness）を
//     そのまま 5 つの比較項目（論理性 / 具体性 / 一貫性 / 主体性 / 面接完成度）に対応させる。
//
// 入力は app/mypage の card が listCompletedAiInterviews() で取得した行を射影したもの。

import type { InterviewFeedback, LevelEvaluation } from '@/types/interview';
import {
  INTERVIEW_TYPES,
  isInterviewType,
  type InterviewType,
} from './interviewTypes';

// ── 入力 ──────────────────────────────────────────────────────────

// completed セッション 1 件 ≒ finalFeedback 1 件。
export type InterviewGrowthEntry = {
  createdAt: string; // session.created_at（ISO / UTC）
  interviewType: string; // 生値（未知文字列もありうるので string）
  feedback: InterviewFeedback;
};

// ── 出力 ──────────────────────────────────────────────────────────

export type GrowthCategory = 'improving' | 'stable' | 'needsWork';

export type AxisTrend = {
  axis: keyof LevelEvaluation;
  label: string; // 論理性 / 具体性 / 一貫性 / 主体性 / 面接完成度
  category: GrowthCategory;
};

export type TypeBreakdownItem = {
  type: InterviewType;
  count: number;
};

export type InterviewRecommendation = {
  type: InterviewType;
  reason: string;
};

export type InterviewGrowthRecord = {
  // ① 総練習回数（completed セッション総数）。
  totalCount: number;
  // ② 連続練習日数（JST / created_at ベース）。
  streakDays: number;
  // ③ タイプ別練習回数（既知 5 タイプを固定順で。count 0 も含む）。
  typeBreakdown: TypeBreakdownItem[];
  // ④ 成長推移（初期 → 現在。比較可能な軸のみ。2 セッション未満なら空）。
  growthTrend: AxisTrend[];
  // ⑤ 最近の課題 TOP3（improvements 集計）。
  topIssues: string[];
  // ⑥ 最近の強み TOP3（strengths = goodPoints 集計）。
  topStrengths: string[];
  // ⑦ 次にやるべき練習（ルールベース）。
  recommendation: InterviewRecommendation | null;
};

// ── 定数 ──────────────────────────────────────────────────────────

// levelEvaluation の数値化規約: weak=1, normal=2, strong=3。
// ※ あくまで集計のための内部「推定」。UI には数値を出さない（カテゴリのみ）。
const LEVEL_SCORE: Record<string, number> = { weak: 1, normal: 2, strong: 3 };

// 5 軸 → 表示ラベル。順序が UI の表示順になる。
const AXES: { key: keyof LevelEvaluation; label: string }[] = [
  { key: 'logical', label: '論理性' },
  { key: 'concrete', label: '具体性' },
  { key: 'consistency', label: '一貫性' },
  { key: 'originality', label: '主体性' },
  { key: 'interviewReadiness', label: '面接完成度' },
];

// カテゴリ判定のしきい値（1〜3 スケールの差分）。
const IMPROVE_THRESHOLD = 0.3;
const WEAK_LEVEL = 1.8; // 横ばいでも現状が弱いときは「要改善」に倒す閾値。

// 次の練習レコメンドの理由（タイプ別。AI を新規実行せずルールで返す）。
const RECOMMEND_REASONS: Record<InterviewType, string> = {
  self_analysis: '自分の価値観や原体験を自分の言葉にする力を伸ばすためです。',
  statement: '志望理由を一貫した自分の言葉で説明する力を伸ばすためです。',
  essay: '客観的な根拠をもって説明する力を伸ばすためです。',
  free: '本番を想定した総合的な受け答えを確認するためです。',
  pressure: '厳しい質問にも落ち着いて対応する力を伸ばすためです。',
};

// 弱点軸 → 相性の良い練習タイプ（弱点ベースのレコメンド用）。
const AXIS_TO_TYPE: Record<keyof LevelEvaluation, InterviewType> = {
  logical: 'essay',
  concrete: 'self_analysis',
  consistency: 'statement',
  originality: 'self_analysis',
  interviewReadiness: 'free',
};

// ── public ────────────────────────────────────────────────────────

/**
 * completed セッション群から成長記録を組み立てる。
 *   - entries が 0 件なら null（card は空状態を出す）。
 *   - today（JST YYYY-MM-DD）は streak 計算用。省略時は現在時刻から算出。
 */
export function buildInterviewGrowthRecord(
  entries: InterviewGrowthEntry[],
  options?: { todayJstYmd?: string },
): InterviewGrowthRecord | null {
  if (entries.length === 0) return null;

  // created_at 昇順（初回 → 直近）。
  const sorted = [...entries].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );

  const totalCount = sorted.length;
  const streakDays = computeStreakDays(
    sorted,
    options?.todayJstYmd ?? todayJstYmd(),
  );
  const typeBreakdown = computeTypeBreakdown(sorted);
  const { growthTrend, currentScores } = computeGrowthTrend(sorted);
  const topIssues = aggregateTop(sorted.flatMap((e) => e.feedback.improvements), 3);
  const topStrengths = aggregateTop(sorted.flatMap((e) => e.feedback.goodPoints), 3);
  const recommendation = recommend(sorted, typeBreakdown, currentScores);

  return {
    totalCount,
    streakDays,
    typeBreakdown,
    growthTrend,
    topIssues,
    topStrengths,
    recommendation,
  };
}

// ── ② 連続練習日数 ────────────────────────────────────────────────

function computeStreakDays(
  entries: InterviewGrowthEntry[],
  today: string,
): number {
  const practiced = new Set<string>();
  for (const e of entries) {
    const ymd = toJstYmd(e.createdAt);
    if (ymd) practiced.add(ymd);
  }
  if (practiced.size === 0) return 0;

  // 今日まだ練習していなくても streak は折らない（昨日からカウント開始する猶予）。
  let cursor = practiced.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (practiced.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// ── ③ タイプ別練習回数 ────────────────────────────────────────────

function computeTypeBreakdown(
  entries: InterviewGrowthEntry[],
): TypeBreakdownItem[] {
  const counts = new Map<InterviewType, number>();
  for (const t of INTERVIEW_TYPES) counts.set(t, 0);
  for (const e of entries) {
    if (isInterviewType(e.interviewType)) {
      counts.set(e.interviewType, (counts.get(e.interviewType) ?? 0) + 1);
    }
  }
  return INTERVIEW_TYPES.map((type) => ({ type, count: counts.get(type) ?? 0 }));
}

// ── ④ 成長推移（初期 → 現在） ─────────────────────────────────────

// 1 セッションの 1 軸スコア = perQuestionFeedback 全問の levelEvaluation[axis] 平均。
// 有効値が 0 件なら null（その軸はそのセッションでは未計上）。
function sessionAxisScore(
  feedback: InterviewFeedback,
  axis: keyof LevelEvaluation,
): number | null {
  const per = feedback.perQuestionFeedback;
  if (!Array.isArray(per) || per.length === 0) return null;
  let sum = 0;
  let count = 0;
  for (const q of per) {
    const score = LEVEL_SCORE[q?.levelEvaluation?.[axis] as string];
    if (typeof score === 'number') {
      sum += score;
      count += 1;
    }
  }
  return count === 0 ? null : sum / count;
}

function computeGrowthTrend(entries: InterviewGrowthEntry[]): {
  growthTrend: AxisTrend[];
  currentScores: Partial<Record<keyof LevelEvaluation, number>>;
} {
  const growthTrend: AxisTrend[] = [];
  const currentScores: Partial<Record<keyof LevelEvaluation, number>> = {};

  for (const { key, label } of AXES) {
    // 昇順のまま有効なセッションスコアだけ抜き出す（初回 → 直近の順を保つ）。
    const points: number[] = [];
    for (const e of entries) {
      const s = sessionAxisScore(e.feedback, key);
      if (s !== null) points.push(s);
    }
    if (points.length === 0) continue;
    currentScores[key] = points[points.length - 1];

    // 推移は 2 セッション以上ないと出さない（初期 → 現在の比較が成立しない）。
    if (points.length < 2) continue;
    const first = points[0];
    const last = points[points.length - 1];
    const delta = last - first;

    let category: GrowthCategory;
    if (delta >= IMPROVE_THRESHOLD) {
      category = 'improving';
    } else if (delta <= -IMPROVE_THRESHOLD) {
      category = 'needsWork';
    } else {
      // 横ばい: 現状が弱ければ要改善、十分なら安定。
      category = last < WEAK_LEVEL ? 'needsWork' : 'stable';
    }
    growthTrend.push({ axis: key, label, category });
  }

  return { growthTrend, currentScores };
}

// ── ⑤⑥ 課題 / 強みの集計（同内容を統合して頻度上位） ──────────────

// 正規化キー: 前後空白除去 + 末尾句読点除去 + 連続空白圧縮。完全一致に近いものを統合する。
function normalizeKey(s: string): string {
  return s
    .trim()
    .replace(/[。、．，.,\s]+$/u, '')
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

function aggregateTop(items: unknown[], limit: number): string[] {
  // 出現頻度で集計。同点は初出順を保つ（Map の挿入順）。
  const groups = new Map<string, { text: string; count: number; order: number }>();
  let order = 0;
  for (const raw of items) {
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (!text) continue;
    const key = normalizeKey(text);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { text, count: 1, order: order++ });
    }
  }
  return Array.from(groups.values())
    .sort((a, b) => (b.count - a.count) || (a.order - b.order))
    .slice(0, limit)
    .map((g) => g.text);
}

// ── ⑦ 次にやるべき練習（ルールベース） ────────────────────────────

function recommend(
  entries: InterviewGrowthEntry[],
  typeBreakdown: TypeBreakdownItem[],
  currentScores: Partial<Record<keyof LevelEvaluation, number>>,
): InterviewRecommendation | null {
  if (entries.length === 0) return null;

  // 一番弱い軸（現状スコア最小）→ 相性の良いタイプ。
  let weakestType: InterviewType | null = null;
  let weakestScore = Infinity;
  for (const { key } of AXES) {
    const s = currentScores[key];
    if (typeof s === 'number' && s < weakestScore) {
      weakestScore = s;
      weakestType = AXIS_TO_TYPE[key];
    }
  }

  // 優先 1: まだ受けていないタイプ。弱点と相性が良いタイプが未受験ならそれを優先。
  const never = typeBreakdown.filter((t) => t.count === 0).map((t) => t.type);
  if (never.length > 0) {
    const pick =
      weakestType && never.includes(weakestType) ? weakestType : never[0];
    return { type: pick, reason: RECOMMEND_REASONS[pick] };
  }

  // 優先 2: すべて受験済み → 最近受けていないタイプ（最終練習日が最も古い）。
  const lastByType = new Map<InterviewType, string>();
  for (const e of entries) {
    if (!isInterviewType(e.interviewType)) continue;
    const prev = lastByType.get(e.interviewType);
    if (!prev || e.createdAt > prev) lastByType.set(e.interviewType, e.createdAt);
  }
  let oldestType: InterviewType = INTERVIEW_TYPES[0];
  let oldest = lastByType.get(oldestType) ?? '';
  for (const type of INTERVIEW_TYPES) {
    const last = lastByType.get(type) ?? '';
    if (last < oldest) {
      oldest = last;
      oldestType = type;
    }
  }
  return { type: oldestType, reason: RECOMMEND_REASONS[oldestType] };
}

// ── 日付ユーティリティ（JST） ─────────────────────────────────────

// ISO（UTC）→ JST の YYYY-MM-DD。parse 失敗は null。
function toJstYmd(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function todayJstYmd(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// YYYY-MM-DD に n 日加算（UTC 基準で日付演算）。
function addDays(ymd: string, n: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}
