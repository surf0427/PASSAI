import type { AnalyzeStep } from '@/types/analysis';

export type { AnalyzeStep };  // 既存の import を壊さないよう re-export

const STEPS: { key: AnalyzeStep; label: string }[] = [
  { key: 'confirm', label: '① 活動確認' },
  { key: 'answering', label: '② 深掘り回答' },
  { key: 'summary', label: '③ 活動まとめ' },
];

type Props = { current: AnalyzeStep };

export function StepIndicator({ current }: Props) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);

  return (
    <div className="flex items-center mb-10">
      {STEPS.map((step, i) => (
        <div key={step.key} className="flex items-center flex-1">
          <div
            className={`flex-1 text-center text-sm font-semibold py-2 px-1 rounded-lg transition-colors
              ${i <= currentIndex ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}
          >
            {step.label}
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`h-0.5 w-3 flex-shrink-0 mx-1 ${i < currentIndex ? 'bg-blue-600' : 'bg-gray-200'}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
