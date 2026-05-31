// 自己分析 step 1（活動確認）で読み込んだ活動データの件数バッジ表示。
// STEP-PAGE-02 で app/self-analysis/run/page.tsx の inline 定義から切り出し。
//
// 役割:
//   pure props rendering。activityData を受け取り、種別ごとに件数チップを並べるだけ。
//   state / useEffect / fetch / router / localStorage を一切持たない。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard

'use client';

import type { ActivityData } from '@/types/activity';

export function ActivityDataPreview({ activityData }: { activityData: ActivityData }) {
  const counts = [
    { label: '部活動', count: activityData.clubActivities.length },
    { label: 'ボランティア', count: activityData.volunteerActivities.length },
    { label: '留学', count: activityData.studyAbroadActivities.length },
    { label: '探究', count: activityData.researchActivities.length },
    { label: 'アルバイト', count: activityData.partTimeJobActivities.length },
    { label: '資格', count: activityData.certificationActivities.length },
    { label: 'コンテスト', count: activityData.contestActivities.length },
    { label: '読書', count: activityData.readingActivities.length },
    { label: '趣味', count: activityData.hobbyActivities.length },
    { label: 'その他', count: activityData.otherActivities.length },
  ].filter((c) => c.count > 0);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
      <h2 className="text-sm font-bold text-gray-600 mb-3">読み込んだ活動データ</h2>
      {counts.length === 0 ? (
        <p className="text-gray-400 text-sm">活動データが空です</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {counts.map((c) => (
            <span
              key={c.label}
              className="bg-white border border-gray-200 rounded-full px-3 py-1 text-sm text-gray-700"
            >
              {c.label} {c.count}件
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
