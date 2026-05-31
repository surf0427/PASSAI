import type { ActivityData } from '@/types/activity';

export function formatActivityData(activityData: ActivityData): string {
  const lines: string[] = [];

  activityData.clubActivities.forEach((a, i) => {
    lines.push(`【部活動${i + 1}】`);
    if (a.clubName) lines.push(`部活名: ${a.clubName}`);
    if (a.sport) lines.push(`種目: ${a.sport}`);
    if (a.period.from || a.period.to) lines.push(`期間: ${a.period.from}〜${a.period.to}`);
    if (a.description) lines.push(`印象に残っていること: ${a.description}`);
    if (a.achievement) lines.push(`うまくいったこと: ${a.achievement}`);
    if (a.challenge) lines.push(`失敗・苦労したこと: ${a.challenge}`);
  });

  activityData.volunteerActivities.forEach((a, i) => {
    lines.push(`【ボランティア${i + 1}】`);
    if (a.activityContent) lines.push(`活動内容: ${a.activityContent}`);
    if (a.target) lines.push(`対象: ${a.target}`);
    if (a.description) lines.push(`印象に残っていること: ${a.description}`);
    if (a.achievement) lines.push(`うまくいったこと: ${a.achievement}`);
    if (a.challenge) lines.push(`失敗・苦労したこと: ${a.challenge}`);
  });

  activityData.studyAbroadActivities.forEach((a, i) => {
    lines.push(`【留学${i + 1}】`);
    if (a.destination) lines.push(`留学先: ${a.destination}`);
    if (a.programContent) lines.push(`プログラム内容: ${a.programContent}`);
    if (a.language) lines.push(`使用言語: ${a.language}`);
    if (a.period.from || a.period.to) lines.push(`期間: ${a.period.from}〜${a.period.to}`);
    if (a.description) lines.push(`印象に残っていること: ${a.description}`);
    if (a.achievement) lines.push(`うまくいったこと: ${a.achievement}`);
    if (a.challenge) lines.push(`失敗・苦労したこと: ${a.challenge}`);
  });

  activityData.researchActivities.forEach((a, i) => {
    lines.push(`【探究${i + 1}】`);
    if (a.theme) lines.push(`テーマ: ${a.theme}`);
    if (a.trigger) lines.push(`きっかけ: ${a.trigger}`);
    if (a.methodology) lines.push(`調査方法: ${a.methodology}`);
    if (a.description) lines.push(`印象に残っていること: ${a.description}`);
    if (a.achievement) lines.push(`うまくいったこと: ${a.achievement}`);
    if (a.challenge) lines.push(`失敗・苦労したこと: ${a.challenge}`);
  });

  activityData.partTimeJobActivities.forEach((a, i) => {
    lines.push(`【アルバイト${i + 1}】`);
    if (a.industry) lines.push(`業種: ${a.industry}`);
    if (a.jobContent) lines.push(`業務内容: ${a.jobContent}`);
    if (a.workFrequency) lines.push(`勤務頻度: ${a.workFrequency}`);
    if (a.period.from || a.period.to) lines.push(`期間: ${a.period.from}〜${a.period.to}`);
    if (a.description) lines.push(`印象に残っていること: ${a.description}`);
    if (a.achievement) lines.push(`うまくいったこと: ${a.achievement}`);
    if (a.challenge) lines.push(`失敗・苦労したこと: ${a.challenge}`);
  });

  activityData.certificationActivities.forEach((a, i) => {
    lines.push(`【資格${i + 1}】`);
    if (a.certificationName) lines.push(`資格名: ${a.certificationName}`);
    if (a.level) lines.push(`レベル/スコア: ${a.level}`);
    if (a.acquiredDate) lines.push(`取得時期: ${a.acquiredDate}`);
    if (a.purpose) lines.push(`取得目的: ${a.purpose}`);
    if (a.reflection) lines.push(`うまくいったこと: ${a.reflection}`);
    if (a.difficulty) lines.push(`失敗・苦労したこと: ${a.difficulty}`);
  });

  activityData.contestActivities.forEach((a, i) => {
    lines.push(`【コンテスト${i + 1}】`);
    if (a.contestName) lines.push(`コンテスト名: ${a.contestName}`);
    if (a.field) lines.push(`分野: ${a.field}`);
    if (a.description) lines.push(`印象に残っていること: ${a.description}`);
    if (a.achievement) lines.push(`うまくいったこと: ${a.achievement}`);
    if (a.challenge) lines.push(`失敗・苦労したこと: ${a.challenge}`);
  });

  activityData.readingActivities.forEach((a, i) => {
    lines.push(`【読書${i + 1}】`);
    if (a.genre) lines.push(`ジャンル: ${a.genre}`);
    if (a.favoriteBook) lines.push(`印象に残った本: ${a.favoriteBook}`);
    if (a.mindChange) lines.push(`印象に残っていること: ${a.mindChange}`);
    if (a.reflection) lines.push(`うまくいったこと: ${a.reflection}`);
  });

  activityData.hobbyActivities.forEach((a, i) => {
    lines.push(`【趣味${i + 1}】`);
    if (a.hobbyContent) lines.push(`内容: ${a.hobbyContent}`);
    if (a.frequency) lines.push(`頻度: ${a.frequency}`);
    if (a.reason) lines.push(`印象に残っていること: ${a.reason}`);
    if (a.acquiredSkills) lines.push(`うまくいったこと: ${a.acquiredSkills}`);
    if (a.innovation) lines.push(`失敗・苦労したこと: ${a.innovation}`);
  });

  activityData.otherActivities.forEach((a, i) => {
    lines.push(`【その他${i + 1}】`);
    if (a.activityName) lines.push(`活動名: ${a.activityName}`);
    if (a.period.from || a.period.to) lines.push(`期間: ${a.period.from}〜${a.period.to}`);
    if (a.description) lines.push(`活動内容: ${a.description}`);
    if (a.achievement) lines.push(`うまくいったこと: ${a.achievement}`);
    if (a.challenge) lines.push(`失敗・苦労したこと: ${a.challenge}`);
  });

  return lines.join('\n');
}
