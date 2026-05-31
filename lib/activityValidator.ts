import type { ActivityData } from '@/types/activity';

export function validateActivityForm(activityData: ActivityData): string[] {
  const errs: string[] = [];

  activityData.clubActivities.forEach((a, i) => {
    const n = i + 1;
    if (!a.clubName.trim()) errs.push(`部活動${n}: 部活名を入力してください`);
  });
  activityData.volunteerActivities.forEach((a, i) => {
    const n = i + 1;
    if (!a.activityContent.trim()) errs.push(`ボランティア${n}: 活動内容を入力してください`);
  });
  activityData.studyAbroadActivities.forEach((a, i) => {
    const n = i + 1;
    if (!a.destination.trim()) errs.push(`留学${n}: 留学先を入力してください`);
  });
  activityData.researchActivities.forEach((a, i) => {
    const n = i + 1;
    if (!a.theme.trim()) errs.push(`探究${n}: テーマを入力してください`);
  });
  activityData.partTimeJobActivities.forEach((a, i) => {
    const n = i + 1;
    if (!a.industry.trim()) errs.push(`アルバイト${n}: 業種を入力してください`);
  });
  activityData.certificationActivities.forEach((a, i) => {
    const n = i + 1;
    if (!a.certificationName.trim()) errs.push(`資格${n}: 資格名を入力してください`);
    if (!a.level.trim()) errs.push(`資格${n}: レベル/スコアを入力してください`);
    if (!a.purpose.trim()) errs.push(`資格${n}: 取得目的を入力してください`);
  });
  activityData.contestActivities.forEach((a, i) => {
    const n = i + 1;
    if (!a.contestName.trim()) errs.push(`コンテスト${n}: コンテスト名を入力してください`);
  });
  activityData.readingActivities.forEach((a, i) => {
    const n = i + 1;
    if (!a.favoriteBook.trim()) errs.push(`読書${n}: 印象に残った本を入力してください`);
  });
  activityData.hobbyActivities.forEach((a, i) => {
    const n = i + 1;
    if (!a.hobbyContent.trim()) errs.push(`趣味${n}: 内容を入力してください`);
  });
  activityData.otherActivities.forEach((a, i) => {
    const n = i + 1;
    if (!a.activityName.trim()) errs.push(`その他${n}: 活動名を入力してください`);
  });

  return errs;
}
