import type { BasicInfo } from '@/types/basicInfo';

// 全機能のページ上部に出す基本情報サマリー。
// loadBasicInfo() で取得した値を props で受け取る（このコンポーネント自身は localStorage を読まない）。
//
// 表示項目（仕様で統一）:
//   名前 / 学年 / 文理 / 受験方式 / 評定平均 / 第一志望（大学・学部・学科）
//
// 空文字・undefined・null どれでも落ちないフォールバックを各フィールドに用意してある。
type Props = {
  basicInfo: BasicInfo | null;
  // 「編集する」リンクを右上に表示するときの遷移先（マッチング確認ページなど用）。
  editHref?: string;
};

export default function BasicInfoSummary({ basicInfo, editHref }: Props) {
  if (!basicInfo) return null;

  const name = basicInfo.name?.trim() || '未入力';
  const grade = basicInfo.grade?.trim() || '未入力';
  const track = basicInfo.track || '未設定';

  const examTypesList = basicInfo.examTypes ?? [];
  const examTypes = examTypesList.length > 0 ? examTypesList.join('、') : '未選択';

  const overallGpa = (basicInfo.overallGpa ?? '').trim() || '未入力';

  const pref = basicInfo.preferences?.[0];
  let firstPreference = '未入力';
  if (pref?.university?.trim()) {
    const segments: string[] = [pref.university];
    if (pref.faculty?.trim()) segments.push(pref.faculty);
    const dept = (pref.department ?? '').trim();
    if (dept) segments.push(dept);
    firstPreference = segments.join('・');
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 text-sm text-gray-700">
      {editHref && (
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide">基本情報</h2>
          <a href={editHref} className="text-xs text-blue-600 hover:underline">編集する</a>
        </div>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        <span><span className="text-gray-400 mr-1">名前</span>{name}</span>
        <span><span className="text-gray-400 mr-1">学年</span>{grade}</span>
        <span><span className="text-gray-400 mr-1">文理</span>{track}</span>
        <span><span className="text-gray-400 mr-1">受験方式</span>{examTypes}</span>
        <span><span className="text-gray-400 mr-1">評定平均</span>{overallGpa}</span>
        <span><span className="text-gray-400 mr-1">第一志望</span>{firstPreference}</span>
      </div>
    </div>
  );
}
