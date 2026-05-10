import type { ComparisonResult } from '@/lib/passLineComparison';
import { EVAL_MAX_SCORE } from '@/lib/scoreRank';
import { Card } from '@/components/ui/Card';
import { ComparisonStatusBadge } from './ComparisonStatusBadge';

type Props = {
  result: ComparisonResult;
};

export function ComparisonBarCard({ result }: Props) {
  const { label, currentScore, targetScore, diff, status, comment } = result;
  const currentPct = clampPct((currentScore / EVAL_MAX_SCORE) * 100);
  const targetPct = clampPct((targetScore / EVAL_MAX_SCORE) * 100);

  return (
    <Card className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-slate-700">{label}</h3>
        <ComparisonStatusBadge status={status} />
      </div>

      <div className="space-y-2 mb-3">
        <BarRow
          rowLabel="あなた"
          score={currentScore}
          percentage={currentPct}
          barClass="bg-blue-400"
          rowLabelClass="text-blue-700"
        />
        <BarRow
          rowLabel="目安"
          score={targetScore}
          percentage={targetPct}
          barClass="bg-slate-300"
          rowLabelClass="text-slate-500"
        />
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-slate-500">差分</span>
        <span
          className={`text-xs font-bold tabular-nums ${
            diff === 0 ? 'text-emerald-600' : 'text-amber-700'
          }`}
        >
          {diff === 0 ? '達成' : `あと${diff}点`}
        </span>
      </div>

      {comment && (
        <p className="text-xs text-slate-600 leading-relaxed mt-auto pt-3 border-t border-gray-100">
          {comment}
        </p>
      )}
    </Card>
  );
}

function clampPct(p: number): number {
  return Math.max(0, Math.min(100, p));
}

function BarRow({
  rowLabel,
  score,
  percentage,
  barClass,
  rowLabelClass,
}: {
  rowLabel: string;
  score: number;
  percentage: number;
  barClass: string;
  rowLabelClass: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`text-[11px] font-semibold w-12 shrink-0 ${rowLabelClass}`}>
        {rowLabel}
      </span>
      <div
        className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={EVAL_MAX_SCORE}
        aria-label={rowLabel}
      >
        <div
          className={`h-full ${barClass} rounded-full`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs text-slate-700 tabular-nums w-12 text-right">
        <span className="font-bold">{score}</span>
        <span className="text-slate-400">/{EVAL_MAX_SCORE}</span>
      </span>
    </div>
  );
}
