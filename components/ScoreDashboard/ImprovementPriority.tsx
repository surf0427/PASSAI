import type { ImprovementItem } from '@/lib/scoreRank';
import { Card } from '@/components/ui/Card';

type Props = {
  items: ImprovementItem[];
  topN?: number;
};

const PRIORITY_LABELS = ['優先度①', '優先度②', '優先度③', '優先度④', '優先度⑤'];

const ACCENT = [
  { container: 'bg-rose-50 border-rose-200', badge: 'bg-rose-600 text-white', gain: 'text-rose-700' },
  { container: 'bg-orange-50 border-orange-200', badge: 'bg-orange-600 text-white', gain: 'text-orange-700' },
  { container: 'bg-amber-50 border-amber-200', badge: 'bg-amber-600 text-white', gain: 'text-amber-700' },
] as const;

function accentAt(i: number) {
  return ACCENT[i] ?? ACCENT[ACCENT.length - 1];
}

export function ImprovementPriority({ items, topN = 3 }: Props) {
  const top = items.slice(0, topN);

  if (top.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-sm font-semibold text-emerald-700">
        ✓ すべての項目が満点です
      </div>
    );
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold text-slate-700 mb-1">改善優先度</h3>
      <p className="text-xs text-slate-500 mb-4">
        この順に直すと最も合格圏に近づきます
      </p>
      <ol className="space-y-2.5">
        {top.map((it, i) => {
          const a = accentAt(i);
          return (
            <li
              key={it.key}
              className={`flex items-center gap-3 border ${a.container} rounded-lg px-3 py-3 sm:px-4`}
            >
              <span className={`text-[11px] font-bold px-2 py-1 rounded shrink-0 ${a.badge}`}>
                {PRIORITY_LABELS[i] ?? `優先度${i + 1}`}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{it.label}</p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  現在 {it.currentScore} / 20 点
                </p>
              </div>
              <span className={`text-sm font-bold whitespace-nowrap tabular-nums ${a.gain}`}>
                +{it.potentialGain}点
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
