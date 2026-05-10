import type { ReactNode } from 'react';

// PASSAI Design System v1 — Card primitive
//
// ベース仕様:
//   bg-white / rounded-2xl / ring-1 ring-slate-200 / shadow-card / transition-shadow
//
//   - rounded-2xl は Tailwind 既定 1rem（PASSAI scale の lg = card 標準）。
//   - border ではなく ring を使うのは、レイアウト幅に影響しない hairline で
//     LP の世界観に統一するため。
//
// variant:
//   - default:   通常カード
//   - highlight: おすすめ / プレミアム / 強調（accent ring）
//   - soft:      補足説明 / ヒント / 安心感（淡い青背景・shadow なし）
//
// padding:
//   - none / sm / md / lg
//   - md (= p-4 sm:p-6) は旧 Card の固定 padding と完全一致。
//
// 旧実装からの差分:
//   - border-gray-200 → ring-1 ring-slate-200 (hairline 化、レイアウト不変)
//   - shadow-sm → shadow-card (token 経由・視覚はほぼ同等)
//   - hover:shadow-md は default variant に維持（既存ページの interactive 感を残す）
//   - className / 子コンポーネント API は不変

export type CardVariant = 'default' | 'highlight' | 'soft';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const CARD_BASE = 'rounded-2xl transition-shadow';

const CARD_VARIANT: Record<CardVariant, string> = {
  default:   'bg-white ring-1 ring-slate-200 shadow-card hover:shadow-md',
  highlight: 'bg-white ring-2 ring-accent-500 shadow-card',
  soft:      'bg-blue-50 ring-1 ring-blue-100',
};

const CARD_PADDING: Record<CardPadding, string> = {
  none: '',
  sm:   'p-3 sm:p-4',
  md:   'p-4 sm:p-6',
  lg:   'p-6 sm:p-8',
};

type Props = {
  variant?: CardVariant;
  padding?: CardPadding;
  className?: string;
  children: ReactNode;
};

export function Card({
  variant = 'default',
  padding = 'md',
  className = '',
  children,
}: Props) {
  return (
    <div
      className={`${CARD_BASE} ${CARD_VARIANT[variant]} ${CARD_PADDING[padding]} ${className}`}
    >
      {children}
    </div>
  );
}

// CardHeader / CardTitle / CardDescription / CardContent は
// 既存呼び出し側の API を維持するためそのまま残す。
type SubProps = {
  className?: string;
  children: ReactNode;
};

export function CardHeader({ className = '', children }: SubProps) {
  return <div className={`mb-3 ${className}`}>{children}</div>;
}

export function CardTitle({ className = '', children }: SubProps) {
  return (
    <h3 className={`text-sm font-semibold text-slate-700 ${className}`}>
      {children}
    </h3>
  );
}

export function CardDescription({ className = '', children }: SubProps) {
  return (
    <p className={`text-xs text-slate-500 leading-relaxed mt-1 ${className}`}>
      {children}
    </p>
  );
}

export function CardContent({ className = '', children }: SubProps) {
  return <div className={className}>{children}</div>;
}
