import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { loadAnalyzeState } from '@/lib/analyzeStorage';
import { loadActivityData } from '@/lib/activityStorage';
import type { ActivityData } from '@/types/activity';
import type { InterviewQuestionFormData } from '../types';


// ActivityData（活動整理フォーム）から読みやすいテキストサマリーを生成する。
// 壁打ちサマリーが取得できなかった場合のフォールバックとして使う。
function buildActivitySummary(data: ActivityData): string {
  const lines: string[] = [];

  // key: activityFormData > clubActivities
  for (const a of data.clubActivities ?? []) {
    lines.push(`${a.clubName}（${a.sport}）: ${a.description}`);
  }
  // key: activityFormData > volunteerActivities
  for (const a of data.volunteerActivities ?? []) {
    lines.push(`ボランティア（${a.activityContent}）: ${a.description}`);
  }
  // key: activityFormData > studyAbroadActivities
  for (const a of data.studyAbroadActivities ?? []) {
    lines.push(`留学（${a.destination}）: ${a.description}`);
  }
  // key: activityFormData > researchActivities
  for (const a of data.researchActivities ?? []) {
    lines.push(`探究「${a.theme}」: ${a.description}`);
  }
  // key: activityFormData > partTimeJobActivities
  for (const a of data.partTimeJobActivities ?? []) {
    lines.push(`アルバイト（${a.industry}）: ${a.jobContent}`);
  }
  // key: activityFormData > certificationActivities
  for (const a of data.certificationActivities ?? []) {
    lines.push(`資格: ${a.certificationName}（${a.level}）`);
  }
  // key: activityFormData > contestActivities
  for (const a of data.contestActivities ?? []) {
    lines.push(`コンテスト「${a.contestName}」: ${a.result}`);
  }

  return lines.join('\n');
}

export type InterviewQuestionInitialData = Partial<InterviewQuestionFormData>;

export function loadInterviewQuestionInitialData(): InterviewQuestionInitialData {
  const result: InterviewQuestionInitialData = {};

  // 基本情報（key: 'basicFormData'）→ 大学名・学部・学科（学科が空なら学部のみ）
  try {
    const basicInfo = loadBasicInfo();
    if (basicInfo) {
      const pref = basicInfo.preferences?.[0];
      if (pref?.university) result.universityName = pref.university;
      if (pref?.faculty) {
        const department = (pref.department ?? '').trim();
        result.facultyName = department ? `${pref.faculty} ${department}` : pref.faculty;
      }
    }
  } catch {
    // 取得失敗しても画面は壊れない
  }

  // 壁打ちサマリー（key: 'analyzeState'）→ 活動内容（優先）
  // SummaryResult.activitySummary は AI が整形済みのテキストなので最も使いやすい
  try {
    const analyzeState = loadAnalyzeState();
    if (analyzeState?.summary?.activitySummary) {
      result.activities = analyzeState.summary.activitySummary;
    }
  } catch {
    // 取得失敗しても画面は壊れない
  }

  // 活動整理フォーム（key: 'activityFormData'）→ 活動内容（analyzeState がない場合のフォールバック）
  if (!result.activities) {
    try {
      const activityData = loadActivityData();
      if (activityData) {
        const summary = buildActivitySummary(activityData);
        if (summary) result.activities = summary;
      }
    } catch {
      // 取得失敗しても画面は壊れない
    }
  }

  // 将来目標（futureGoals）は自動入力しない。
  // wallHittingResult.futureConnections を value にセットすると AI 生成文が
  // 編集可能テキストとして表示されてしまうため、placeholder 表示にとどめる。

  // 志望理由（reason）は既存データに直接対応するものがないため自動入力しない

  return result;
}
