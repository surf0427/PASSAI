import { type BasicFormData, EXAM_TYPE_LABELS } from '@/types/basicInfo';

type Props = {
  basicInfo: BasicFormData | null;
};

export default function BasicInfoCard({ basicInfo }: Props) {
  if (!basicInfo) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-700">
      <span><span className="text-gray-400 mr-1">名前</span>{basicInfo.name}</span>
      <span><span className="text-gray-400 mr-1">高校名</span>{basicInfo.highSchool}</span>
      <span><span className="text-gray-400 mr-1">学年</span>{basicInfo.grade}</span>
      <span><span className="text-gray-400 mr-1">文理</span>{basicInfo.stream}</span>
      {basicInfo.examType && (
        <span><span className="text-gray-400 mr-1">受験方式</span>{EXAM_TYPE_LABELS[basicInfo.examType]}</span>
      )}
      {basicInfo.preferences[0]?.university && (
        <span>
          <span className="text-gray-400 mr-1">第一志望</span>
          {basicInfo.preferences[0].university}
          {basicInfo.preferences[0].faculty && `・${basicInfo.preferences[0].faculty}`}
        </span>
      )}
    </div>
  );
}
