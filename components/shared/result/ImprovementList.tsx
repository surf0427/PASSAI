// PASSAI shared/result — ImprovementList
//
// AI 結果でよく出る「prefix 付きの改善ヒント / 観点リスト」を共通化する。
// 機能ごとに ✓ / △ / → / ⚠ などのプレフィックスとカラーがまちまちだったのを
// variant で吸収する。
//
// 現状の出現箇所:
//   - admission-matching の MatchingCard 内の「合っている点」「課題」「やれば評価上がる」
//   - 自己分析・志望理由書フィードバック・面接フィードバックでも今後使う想定
//
// 設計方針:
//   - 1 コンポーネント 1 責務：ul + li の prefix リスト出力のみ。
//     見出し・ラッパー（gray-bg のサマリーボックス等）は呼び出し側で組む。
//   - variant で色とプレフィックスを切り替える：
//       success（合っている点）  : ✓ / text-green-700
//       warning（課題・補強）    : △ / text-orange-700
//       info（次にやること）     : → / prefix=brand / body=gray
//       neutral（中立な観点）    : ・ / text-gray-700
//   - prefix プロパティで上書き可（例: ⚠ や 🔥 を使いたい場合）。

export type ImprovementListVariant = 'success' | 'warning' | 'info' | 'neutral';

const VARIANT_PREFIX: Record<ImprovementListVariant, string> = {
  success: '✓',
  warning: '△',
  info: '→',
  neutral: '・',
};

// prefix の色を「body と同色（inherit）」にするか、明示色を持たせるかは variant ごとに違う。
// admission-matching 既存実装を踏襲：success/warning は body と同色、info のみ
// prefix だけが brand-500 で「次のアクション」の方向性を示す。
const VARIANT_PREFIX_CLASS: Record<ImprovementListVariant, string | null> = {
  success: null, // body と同色（inherit）
  warning: null,
  info: 'text-brand-500',
  neutral: null,
};

const VARIANT_TEXT_CLASS: Record<ImprovementListVariant, string> = {
  success: 'text-green-700',
  warning: 'text-orange-700',
  info: 'text-gray-700',
  neutral: 'text-gray-700',
};

type Props = {
  items: string[];
  variant: ImprovementListVariant;
  /** プレフィックス記号を上書き。未指定なら variant 既定（✓ / △ / → / ・）。 */
  prefix?: string;
  /** 各項目の縦間隔。density="tight"（既定）= space-y-1, "relaxed" = space-y-1.5 */
  density?: 'tight' | 'relaxed';
};

export function ImprovementList({
  items,
  variant,
  prefix,
  density = 'tight',
}: Props) {
  const symbol = prefix ?? VARIANT_PREFIX[variant];
  const space = density === 'relaxed' ? 'space-y-1.5' : 'space-y-1';

  return (
    <ul className={space}>
      {items.map((item, i) => (
        <li
          key={i}
          className={`text-sm ${VARIANT_TEXT_CLASS[variant]} flex gap-2`}
        >
          <span
            className={`shrink-0${
              VARIANT_PREFIX_CLASS[variant] ? ' ' + VARIANT_PREFIX_CLASS[variant] : ''
            }`}
          >
            {symbol}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
