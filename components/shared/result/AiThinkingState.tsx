// PASSAI shared/result — AiThinkingState
//
// AI 生成中の「読み込んでいます」表示を共通化するためのパーツ。
// 機能ごとに spinner / メッセージ / 推定秒数の出し方が違っていたのを
// 1 箇所に集約する。
//
// 設計方針:
//   - まずは既存スタイル（admission-matching の spinner ベース）を温存。
//     スピナー感を減らすデザイン（dots / skeleton）への切り替えは別 PR 候補。
//   - 外側の page 余白・h1 は呼び出し側で組む（このコンポーネントは結果カードのみ）。
//   - estimatedSeconds は optional。AI 機能ごとに「30秒ほどかかります」等の
//     ばらつきがあるため数値を受け取り、無ければ補助文を出さない。

type Props = {
  /** 中央の太字メッセージ。例: 「AIが診断しています...」 */
  message?: string;
  /** 補助文に出す推定秒数。指定時のみ「○秒ほどかかります」を表示。 */
  estimatedSeconds?: number;
  /** デフォルト白背景の box を外したい場合に false にする（呼び出し側で外枠を組むケース）。 */
  framed?: boolean;
};

export function AiThinkingState({
  message = 'AIが考えています...',
  estimatedSeconds,
  framed = true,
}: Props) {
  const inner = (
    <>
      <div className="flex justify-center mb-4">
        <svg
          className="animate-spin h-8 w-8 text-brand-600"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </div>
      <p className="text-gray-700 font-medium mb-1">{message}</p>
      {estimatedSeconds !== undefined && (
        <p className="text-gray-400 text-sm">{estimatedSeconds}秒ほどかかります</p>
      )}
    </>
  );

  if (!framed) {
    return <div className="text-center" role="status" aria-live="polite">{inner}</div>;
  }
  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-8 text-center"
      role="status"
      aria-live="polite"
    >
      {inner}
    </div>
  );
}
