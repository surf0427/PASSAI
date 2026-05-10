import type { ImprovementSuggestion } from '@/lib/improvementSuggestions';
import { EVAL_MAX_SCORE } from '@/lib/scoreRank';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';
import { AlertBox } from '@/components/ui/AlertBox';

type Props = {
  suggestion: ImprovementSuggestion;
  rank: number;
};

export function ImprovementCard({ suggestion, rank }: Props) {
  const { label, currentScore, targetScore, diff, comment, reasoning, route } =
    suggestion;
  const currentPct = clampPct((currentScore / EVAL_MAX_SCORE) * 100);
  const targetPct = clampPct((targetScore / EVAL_MAX_SCORE) * 100);

  return (
    <Card>
      <header className="flex items-center gap-3 mb-5">
        <span className="w-9 h-9 rounded-full bg-rose-600 text-white text-base font-bold flex items-center justify-center shrink-0 tabular-nums">
          {rank}
        </span>
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 flex-1 min-w-0 truncate">
          {label}
        </h2>
        <span className="text-sm sm:text-base font-bold text-rose-700 tabular-nums whitespace-nowrap">
          あと{diff}点
        </span>
      </header>

      <div className="space-y-2 mb-5">
        <BarRow
          rowLabel="現在"
          rowLabelClass="text-blue-700"
          score={currentScore}
          percentage={currentPct}
          barClass="bg-blue-400"
        />
        <BarRow
          rowLabel="目安"
          rowLabelClass="text-slate-500"
          score={targetScore}
          percentage={targetPct}
          barClass="bg-slate-300"
        />
      </div>

      <AlertBox variant="info" className="mb-3">
        <p className="text-[11px] font-bold text-blue-700 mb-2 tracking-wider">
          改善の方向性
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">{comment}</p>
      </AlertBox>

      <details className="group bg-slate-50 border border-slate-200 rounded-xl mb-5">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-xs font-bold text-slate-700 px-4 py-3 flex items-center justify-between">
          <span>なぜ重要なのか？</span>
          <span className="text-slate-400 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <p className="text-xs text-slate-600 leading-relaxed px-4 pb-4">
          {reasoning}
        </p>
      </details>

      <LinkButton href={route} variant="primary" size="md" className="w-full">
        改善を始める →
      </LinkButton>
    </Card>
  );
}

function clampPct(p: number): number {
  return Math.max(0, Math.min(100, p));
}

function BarRow({
  rowLabel,
  rowLabelClass,
  score,
  percentage,
  barClass,
}: {
  rowLabel: string;
  rowLabelClass: string;
  score: number;
  percentage: number;
  barClass: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`text-[11px] font-semibold w-10 shrink-0 ${rowLabelClass}`}>
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
