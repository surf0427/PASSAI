// 活動整理・基本情報・自己分析添削データから StudentAnalysis を導出する。
// wallHittingResult（AI壁打ち結果）があればそれを優先して使う。

import type { BasicFormData } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { SelfPR } from '@/types/selfPR';
import type { WallHittingResult } from '@/types/analysis';
import type { StudentAnalysis } from '@/types/matching';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// AI壁打ちの weaknesses テキストから特定の評価軸スコアを下方修正する。
function applyWeaknessAdjustments(
  weaknesses: string[],
  aoScores: { activity: number; inquiry: number; initiative: number; reason: number },
  recScores: { gpa: number; qualification: number; academic: number; reason: number },
): void {
  for (const w of weaknesses) {
    if (w.includes('探究') || w.includes('テーマ')) aoScores.inquiry = clamp(aoScores.inquiry - 1, 0, 5);
    if (w.includes('主体') || w.includes('自発') || w.includes('発案')) aoScores.initiative = clamp(aoScores.initiative - 1, 0, 5);
    if (w.includes('志望理由') || w.includes('一貫')) { aoScores.reason = clamp(aoScores.reason - 1, 0, 5); recScores.reason = clamp(recScores.reason - 1, 0, 5); }
    if (w.includes('評定') || w.includes('学力')) recScores.gpa = clamp(recScores.gpa - 1, 0, 5);
    if (w.includes('資格') || w.includes('検定')) recScores.qualification = clamp(recScores.qualification - 1, 0, 5);
  }
}

export function deriveStudentAnalysis(
  basicInfo: BasicFormData | null,
  activityData: ActivityData | null,
  selfPRs: SelfPR[],
  wallHittingResult?: WallHittingResult | null,
): StudentAnalysis {
  // 活動データがない場合はスコアを計算できない
  if (!activityData) {
    return {
      strengths: wallHittingResult?.strengths ?? [],
      weaknesses: wallHittingResult?.weaknesses ?? [],
      aoScoreProfile: null,
      recommendationScoreProfile: null,
    };
  }

  // ── 活動数カウント ────────────────────────────────────────────
  const clubCount        = activityData.clubActivities.length;
  const volunteerCount   = activityData.volunteerActivities.length;
  const researchCount    = activityData.researchActivities.length;
  const contestCount     = activityData.contestActivities.length;
  const certCount        = activityData.certificationActivities.length;
  const abroadCount      = activityData.studyAbroadActivities.length;

  const totalActivities = clubCount + volunteerCount + researchCount + contestCount + abroadCount + activityData.partTimeJobActivities.length;

  // ── AO スコア（ヒューリスティック） ─────────────────────────
  const aoScores = {
    activity:   clamp(totalActivities, 0, 5),
    inquiry:    clamp(researchCount * 2, 0, 5),
    initiative: clamp(1 + (clubCount > 0 ? 2 : 0) + (contestCount > 0 ? 1 : 0) + (volunteerCount > 0 ? 1 : 0), 0, 5),
    reason:     3,
  };

  // ── 推薦スコア（ヒューリスティック） ─────────────────────────
  const recScores = {
    gpa:           3,
    qualification: clamp(certCount * 2, 0, 5),
    academic:      clamp(contestCount + abroadCount + 1, 0, 5),
    reason:        3,
  };

  // ── AI壁打ち結果で弱点調整 ──────────────────────────────────
  if (wallHittingResult?.weaknesses) {
    applyWeaknessAdjustments(wallHittingResult.weaknesses, aoScores, recScores);
  }

  // ── 強み・弱みテキスト ─────────────────────────────────────────
  // AI壁打ち結果があればそちらを優先（より具体的）
  let strengths: string[];
  let weaknesses: string[];

  if (wallHittingResult) {
    strengths = wallHittingResult.strengths;
    weaknesses = wallHittingResult.weaknesses;
  } else {
    strengths = [];
    weaknesses = [];
    if (clubCount > 0)      strengths.push('部活動での継続的な経験がある');
    if (researchCount > 0)  strengths.push('探究活動への取り組みがある');
    if (contestCount > 0)   strengths.push('コンテスト参加による挑戦経験がある');
    if (abroadCount > 0)    strengths.push('留学・国際経験がある');
    if (volunteerCount > 0) strengths.push('ボランティア活動による貢献意識がある');
    if (certCount > 0)      strengths.push('資格取得による自己研鑽がある');
    const latestPR = selfPRs.findLast((pr) => pr.latestResult);
    if (latestPR) strengths.push('自己分析を言語化できている');
    if (aoScores.inquiry < 2)  weaknesses.push('探究テーマの深掘りが不足している');
    if (aoScores.activity < 2) weaknesses.push('課外活動の経験が少ない');
  }

  return {
    strengths,
    weaknesses,
    aoScoreProfile: aoScores,
    recommendationScoreProfile: recScores,
  };
}
