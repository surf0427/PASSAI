// 改善前後の breakdown 1 軸を比較表示する行（STEP H 新規）。
// /essay/improve/[wid]/compare で 5 軸並べて使う。
//
// 色設計:
//   - delta > 0 (改善): blue 強調（成長実感）
//   - delta < 0 (悪化): amber 控えめ（悪化を煽らない）
//   - delta === 0 (変化なし): gray
//
// 動作分岐は持たない（呼び出し側で row 単位の data を作る）。

type Props = {
  label: string;
  prevScore: number;
  currScore: number;
  delta: number;
};

export function BreakdownDiffRow({ label, prevScore, currScore, delta }: Props) {
  // delta の符号で見た目を分岐（mode 文字列ではなく数値から直接 derive）。
  const improved = delta > 0;
  const worsened = delta < 0;

  const containerClass = improved
    ? 'bg-blue-50 border border-blue-200'
    : worsened
      ? 'bg-amber-50 border border-amber-200'
      : 'bg-white border border-gray-200';

  const deltaText =
    delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`; // delta < 0 はそのまま負号
  const deltaClass = improved
    ? 'text-blue-700 font-bold'
    : worsened
      ? 'text-amber-700 font-semibold'
      : 'text-gray-500';

  return (
    <div className={`${containerClass} rounded-lg p-3 flex items-center justify-between gap-3`}>
      <p className="text-sm font-semibold text-gray-800">{label}</p>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-gray-500">{prevScore}</span>
        <span className="text-gray-400" aria-hidden>
          →
        </span>
        <span className="text-gray-800 font-semibold">{currScore}</span>
        <span className={`min-w-[3rem] text-right ${deltaClass}`}>
          {deltaText}
        </span>
      </div>
    </div>
  );
}
