import type { ComparisonResult } from '@/lib/passLineComparison';
import { Card } from '@/components/ui/Card';

type Props = {
  items: ComparisonResult[];
};

export function TopGapList({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-sm font-semibold text-emerald-700">
        ✓ すべての項目が合格ライン目安に到達しています
      </div>
    );
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold text-slate-700 mb-1">
        最優先で直すべき項目
      </h3>
      <p className="text-xs text-slate-500 mb-4">差分が大きい順に並べています</p>
      <ol className="space-y-2.5">
        {items.map((it, i) => (
          <li
            key={it.id}
            className="flex items-center gap-3 border border-rose-100 bg-rose-50 rounded-lg px-3 py-3 sm:px-4"
          >
            <span className="w-6 h-6 rounded-full bg-rose-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
              {i + 1}
            </span>
            <span className="text-sm font-semibold text-slate-800 flex-1 min-w-0 truncate">
              {it.label}
            </span>
            <span className="text-sm font-bold text-rose-700 tabular-nums whitespace-nowrap">
              あと{it.diff}点
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
