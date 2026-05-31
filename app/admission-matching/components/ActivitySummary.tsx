// STEP6.9: app/admission-matching/page.tsx から抽出した feature-local UI。
//   admission-matching でのみ使用されているため shared には置かず feature 配下に配置している
//   (docs/principles/architecture_rules.md の配置基準に従う)。
//   ロジック・文言・className・表示順は page.tsx 内に同居していた時点から無変更。

import type { ActivityData } from '@/types/activity';

type ActivitySummaryProps = {
  activityData: ActivityData;
};

export function ActivitySummary({ activityData }: ActivitySummaryProps) {
  const rows: { label: string; items: string[] }[] = [];

  if (activityData.clubActivities.length > 0)
    rows.push({ label: '部活', items: activityData.clubActivities.map((a) => a.clubName) });
  if (activityData.volunteerActivities.length > 0)
    rows.push({ label: 'ボランティア', items: activityData.volunteerActivities.map((a) => a.activityContent) });
  if (activityData.studyAbroadActivities.length > 0)
    rows.push({ label: '留学', items: activityData.studyAbroadActivities.map((a) => a.destination) });
  if (activityData.researchActivities.length > 0)
    rows.push({ label: '探究', items: activityData.researchActivities.map((a) => a.theme) });
  if (activityData.partTimeJobActivities.length > 0)
    rows.push({ label: 'アルバイト', items: activityData.partTimeJobActivities.map((a) => a.industry) });
  if (activityData.certificationActivities.length > 0)
    rows.push({
      label: '資格',
      items: activityData.certificationActivities.map((a) =>
        a.level ? `${a.certificationName} ${a.level}` : a.certificationName,
      ),
    });
  if (activityData.contestActivities.length > 0)
    rows.push({ label: 'コンテスト', items: activityData.contestActivities.map((a) => a.contestName) });
  if (activityData.readingActivities.length > 0)
    rows.push({ label: '読書', items: activityData.readingActivities.map((a) => a.favoriteBook) });
  if (activityData.hobbyActivities.length > 0)
    rows.push({ label: '趣味', items: activityData.hobbyActivities.map((a) => a.hobbyContent) });
  if (activityData.otherActivities.length > 0)
    rows.push({ label: 'その他', items: activityData.otherActivities.map((a) => a.activityName) });

  if (rows.length === 0) {
    return <p className="text-sm text-yellow-600">⚠ 活動が登録されていません</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map(({ label, items }) => (
        <div key={label} className="flex gap-2 text-sm">
          <span className="shrink-0 text-gray-400 w-24">{label}</span>
          <span className="text-gray-700">{items.join('・')}</span>
        </div>
      ))}
    </div>
  );
}
