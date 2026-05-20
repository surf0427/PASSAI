import { EVAL_MAX_SCORE } from '@/lib/scoreRank';
import { Card } from '@/components/ui/Card';

type Props = {
  label: string;
  score: number;
  description: string;
  // 任意の合格ライン目安マーカー。指定時のみ bar 上に薄い縦線を描画する。
  // compare の dual-bar 表現は取り込まず、「現在地」のうえに目安を控えめに重ねるだけにする。
  targetScore?: number;
};

function toneFor(percentage: number): string {
  if (percentage >= 80) return 'bg-emerald-500';
  if (percentage >= 60) return 'bg-blue-500';
  if (percentage >= 40) return 'bg-amber-500';
  return 'bg-rose-500';
}

function clampPct(p: number): number {
  return Math.max(0, Math.min(100, p));
}

export function ScoreBarCard({ label, score, description, targetScore }: Props) {
  const percentage = clampPct((score / EVAL_MAX_SCORE) * 100);
  const targetPct =
    typeof targetScore === 'number'
      ? clampPct((targetScore / EVAL_MAX_SCORE) * 100)
      : null;
  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-700">{label}</h3>
        <span className="text-xs tabular-nums text-slate-500">
          <span className="text-base font-bold text-slate-900">{score}</span>
          <span className="ml-0.5">/ {EVAL_MAX_SCORE}</span>
        </span>
      </div>
      <div
        className="relative h-2 bg-gray-100 rounded-full overflow-hidden mb-3"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={EVAL_MAX_SCORE}
      >
        <div
          className={`h-full ${toneFor(percentage)} rounded-full`}
          style={{ width: `${percentage}%` }}
        />
        {targetPct !== null && (
          <span
            className="absolute top-0 bottom-0 w-px bg-slate-700/70"
            style={{ left: `${targetPct}%` }}
            aria-label={`目安 ${targetScore}点`}
          />
        )}
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
    </Card>
  );
}
