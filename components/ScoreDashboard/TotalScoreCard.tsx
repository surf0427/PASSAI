import { PASS_LINE_SCORE, getPointsToPassLine } from '@/lib/scoreRank';

type Props = {
  score: number;
};

export function TotalScoreCard({ score }: Props) {
  const passGap = getPointsToPassLine(score);
  return (
    <div className="bg-gradient-to-br from-blue-50 via-white to-indigo-50 border border-blue-100 rounded-2xl p-6 sm:p-8 h-full">
      <p className="text-xs font-semibold text-blue-700 mb-3 tracking-wider">完成度スコア</p>
      <div className="flex items-baseline gap-2">
        <span className="text-6xl sm:text-7xl font-bold text-slate-900 tabular-nums leading-none">
          {score}
        </span>
        <span className="text-xl font-semibold text-slate-400">/ 100</span>
      </div>
      {passGap > 0 ? (
        <p className="mt-4 text-sm text-slate-600">
          合格圏（{PASS_LINE_SCORE}点）まで{' '}
          <span className="font-bold text-blue-700">あと{passGap}点</span>
        </p>
      ) : (
        <p className="mt-4 text-sm font-semibold text-emerald-700">
          ✓ 合格圏に到達しています
        </p>
      )}
    </div>
  );
}
