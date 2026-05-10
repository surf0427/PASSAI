import { PASS_LINE_TOTAL, getTotalDiff } from '@/lib/passLineComparison';

type Props = {
  currentTotal: number;
};

export function ComparisonSummary({ currentTotal }: Props) {
  const diff = getTotalDiff(currentTotal);
  const reached = diff === 0;

  return (
    <div className="bg-gradient-to-br from-blue-50 via-white to-indigo-50 border border-blue-100 rounded-2xl p-5 sm:p-8">
      <p className="text-xs font-semibold text-blue-700 mb-4 tracking-wider">
        合格ライン目安との差分
      </p>

      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-5">
        <SummaryCell label="現在" value={currentTotal} tone="current" />
        <SummaryCell label="合格ライン目安" value={PASS_LINE_TOTAL} tone="target" />
        <SummaryCell
          label="あと"
          value={reached ? null : diff}
          reachedMark={reached}
          tone="diff"
        />
      </div>

      <p
        className={`text-sm font-semibold leading-relaxed ${
          reached ? 'text-emerald-700' : 'text-blue-700'
        }`}
      >
        {reached
          ? '合格ライン目安に到達しています。さらに具体性と独自性を磨きましょう。'
          : `合格ライン目安まで、あと${diff}点です。`}
      </p>
    </div>
  );
}

type CellTone = 'current' | 'target' | 'diff';

const TONE_CLASS: Record<CellTone, string> = {
  current: 'text-slate-900',
  target: 'text-slate-700',
  diff: 'text-blue-700',
};

function SummaryCell({
  label,
  value,
  tone,
  reachedMark = false,
}: {
  label: string;
  value: number | null;
  tone: CellTone;
  reachedMark?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] text-slate-500 mb-1 leading-tight">{label}</p>
      <p
        className={`text-2xl sm:text-4xl font-bold tabular-nums leading-none ${
          reachedMark ? 'text-emerald-600' : TONE_CLASS[tone]
        }`}
      >
        {reachedMark || value === null ? (
          <span aria-label="達成">✓</span>
        ) : (
          <>
            {value}
            <span className="text-xs sm:text-sm text-slate-400 font-semibold ml-1">
              点
            </span>
          </>
        )}
      </p>
    </div>
  );
}
