import type { ReactNode } from 'react';

// PASSAI shared/result — AiInlineThinking
//
// 「ボタン内 / 行内の小さな AI 処理中表示」を共通化するパーツ。
//
// 既存の AiThinkingState はフルカード型（外枠 + spinner + メッセージ + 推定秒数）で、
// admission-matching の「早期 return パネル」のような大きな表示に向く。
// 一方 self-analysis / essay-practice / self-pr などでは、
// 「ボタンの中の disabled 時に spinner + 文言を出す」「小さなインライン状態表示」
// といった軽量パターンが多く、AiThinkingState は重すぎる。
//
// このパーツはその軽量パターン専用。
//
// 設計方針:
//   - <span> の inline-flex。<button> や <p> の中にそのまま置ける
//   - 色は親から継承（text-current）。ボタンが text-white なら spinner も白に
//   - フォントサイズも親から継承（spinner は h-4 w-4 固定で文字に対して相対的に小さい）
//   - children に文言を取る（"AIが分析中..." のようなテキスト）。文言は呼び出し側が組む
//   - role="status" + aria-live="polite" でスクリーンリーダ通知
//
// 使い方:
//   <button disabled={loading}>
//     {loading
//       ? <AiInlineThinking>AIが分析中...（30秒ほどかかります）</AiInlineThinking>
//       : 'AIに分析させる'}
//   </button>

type Props = {
  /** spinner の右に出す文言（"AIが分析中..." など）。JSX も渡せる。 */
  children: ReactNode;
  /**
   * spinner サイズ。
   *   sm  : h-4 w-4（既定。ボタン text-base / text-sm の中で見栄えが良い）
   *   md  : h-5 w-5（h2 程度の見出しの中で使う場合）
   */
  size?: 'sm' | 'md';
  /** 追加クラス（例: text-gray-400 でテキストだけトーンを落としたい場合）。 */
  className?: string;
};

export function AiInlineThinking({
  children,
  size = 'sm',
  className = '',
}: Props) {
  const spinnerSize = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      role="status"
      aria-live="polite"
    >
      <svg
        className={`animate-spin ${spinnerSize} shrink-0`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {/* stroke / fill とも currentColor を使うので親の color を継承する */}
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v8H4z"
        />
      </svg>
      {children}
    </span>
  );
}
