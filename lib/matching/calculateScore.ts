// ── スコアリング層 (Scoring Layer) ───────────────────────────────
// このファイルは AI に依存しない deterministic な適合度計算を行う。
// 大学プロフィール × 生徒プロフィール → ScoreBreakdown を返す純関数のみ。
//
// 文章生成層（Claude を呼ぶ /app/api/matching/route.ts）とは責務を分けているので、
// このレイヤーは Edge / バックグラウンドジョブ / Supabase RPC など、
// AI を呼ばない場所からも独立して呼べる構造になっている。
//
// TODO: 将来 偏差値 / 評定 / 活動量 / 学科適性 を組み込んだ deterministic 判定を強化する場合、
//   1. 入力プロフィール型に新しいフィールドを追加
//   2. 重み (AO_WEIGHTS / RECOMMENDATION_WEIGHTS) を学科ごとに分岐
//   3. /api/matching/score として独立 API 化することを検討（クライアントから呼べるよう）
//
import type {
  AoScoreProfile,
  RecommendationScoreProfile,
  UniversityAoProfile,
  UniversityRecommendationProfile,
  University,
  StudentAnalysis,
  ScoreBreakdown,
  ScoreBreakdownItem,
} from '@/types/matching';

// ── AO の重み（主体性・活動が高評価） ──────────────────────────

const AO_WEIGHTS: Record<keyof AoScoreProfile, number> = {
  initiative: 1.5, // 主体性（最重要）
  activity:   1.3, // 活動レベル
  inquiry:    1.2, // 探究の深さ
  reason:     1.0, // 志望理由の一貫性
};

// ── 学校推薦型の重み（評定・学力が高評価） ─────────────────────

const RECOMMENDATION_WEIGHTS: Record<keyof RecommendationScoreProfile, number> = {
  gpa:           1.5, // 評定平均（最重要）
  academic:      1.3, // 学力
  qualification: 1.0, // 資格・検定
  reason:        1.0, // 志望理由
};

// ── 日本語ラベル ────────────────────────────────────────────────

const AO_LABELS: Record<keyof AoScoreProfile, string> = {
  activity:   '活動レベル',
  inquiry:    '探究の深さ',
  initiative: '主体性',
  reason:     '志望理由の一貫性',
};

const RECOMMENDATION_LABELS: Record<keyof RecommendationScoreProfile, string> = {
  gpa:           '評定平均',
  qualification: '資格・検定',
  academic:      '学力',
  reason:        '志望理由',
};

// ── 適合度の計算 ────────────────────────────────────────────────

/**
 * 1項目の適合度（0.0〜1.0）を計算する。
 * - 生徒が要求スコアを満たしていれば 1.0（過剰は減点しない）
 * - 不足している場合はギャップが大きいほど下がる（1段差=0.3減）
 */
function calcItemFit(student: number, required: number): number {
  if (student >= required) return 1.0;
  const gap = required - student;
  return Math.max(0, 1.0 - gap * 0.3);
}

// ── ScoreBreakdown の組み立て ───────────────────────────────────

type RawItem = {
  label: string;
  student: number;
  required: number;
  weight: number;
};

/**
 * 重み付き適合度から ScoreBreakdown を生成する。
 * 各項目の contribution は「全体100点のうち何点か」を示す。
 */
function buildBreakdown(rawItems: RawItem[]): ScoreBreakdown {
  const totalWeight = rawItems.reduce((sum, item) => sum + item.weight, 0);

  const items: ScoreBreakdownItem[] = rawItems.map((item) => {
    const fit = calcItemFit(item.student, item.required);
    const maxContribution = (item.weight / totalWeight) * 100;
    const contribution = Math.round(fit * maxContribution);
    return {
      label:        item.label,
      studentScore: item.student,
      required:     item.required,
      weight:       item.weight,
      contribution,
    };
  });

  const total = Math.min(100, items.reduce((sum, i) => sum + i.contribution, 0));

  return { items, total: Math.round(total) };
}

// ── 公開関数 ────────────────────────────────────────────────────

/**
 * 総合型（AO）のスコア内訳を計算する。
 */
export function calculateAoScoreBreakdown(
  studentProfile: AoScoreProfile,
  universityProfile: UniversityAoProfile,
): ScoreBreakdown {
  const rawItems = (Object.keys(AO_LABELS) as (keyof AoScoreProfile)[]).map((key) => ({
    label:    AO_LABELS[key],
    student:  studentProfile[key],
    required: universityProfile[key],
    weight:   AO_WEIGHTS[key],
  }));
  return buildBreakdown(rawItems);
}

/**
 * 学校推薦型のスコア内訳を計算する。
 */
export function calculateRecommendationScoreBreakdown(
  studentProfile: RecommendationScoreProfile,
  universityProfile: UniversityRecommendationProfile,
): ScoreBreakdown {
  const rawItems = (Object.keys(RECOMMENDATION_LABELS) as (keyof RecommendationScoreProfile)[]).map((key) => ({
    label:    RECOMMENDATION_LABELS[key],
    student:  studentProfile[key],
    required: universityProfile[key],
    weight:   RECOMMENDATION_WEIGHTS[key],
  }));
  return buildBreakdown(rawItems);
}

/**
 * 大学の admissionType に応じて ScoreBreakdown を返す。
 * 計算できない場合（プロフィールが null）は null を返す。
 */
export function calculateScoreBreakdown(
  university: University,
  analysis: StudentAnalysis,
): ScoreBreakdown | null {
  if (university.admissionType === '総合型') {
    if (!university.aoProfile || !analysis.aoScoreProfile) return null;
    return calculateAoScoreBreakdown(analysis.aoScoreProfile, university.aoProfile);
  }
  if (university.admissionType === '学校推薦型') {
    if (!university.recommendationProfile || !analysis.recommendationScoreProfile) return null;
    return calculateRecommendationScoreBreakdown(
      analysis.recommendationScoreProfile,
      university.recommendationProfile,
    );
  }
  return null;
}

/**
 * スコアの数値だけ返す（後方互換用）。
 */
export function calculateOverallMatchScore(
  university: University,
  analysis: StudentAnalysis,
): number {
  return calculateScoreBreakdown(university, analysis)?.total ?? 0;
}
