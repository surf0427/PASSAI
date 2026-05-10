import type { StructureElement } from '@/lib/deepDiveQuestions';

const ALL_ELEMENTS: StructureElement[] = [
  'きっかけ',
  '課題',
  '行動',
  '学び',
  '将来目標',
  '大学との接続',
];

type Props = {
  strengthened: StructureElement[];
  missing: StructureElement[];
};

export function StructureMapping({ strengthened, missing }: Props) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-3">志望理由書の構造マッピング</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        {ALL_ELEMENTS.map((el) => {
          const isStrengthened = strengthened.includes(el);
          return (
            <div
              key={el}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium border ${
                isStrengthened
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : 'bg-yellow-50 border-yellow-200 text-yellow-700'
              }`}
            >
              <span className="text-base leading-none">
                {isStrengthened ? '✅' : '⚠'}
              </span>
              <span>{el}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-gray-400">
        <span>
          <span className="text-green-600 font-medium">✅</span>
          　今回の壁打ちで強化された要素
        </span>
        <span>
          <span className="text-yellow-600 font-medium">⚠</span>
          　まだ不足している可能性がある要素
        </span>
      </div>
    </div>
  );
}
