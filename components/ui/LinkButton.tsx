import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  BUTTON_BASE,
  BUTTON_VARIANT,
  BUTTON_SIZE,
  type ButtonSize,
} from './buttonStyles';

// LinkButton はナビゲーション用なので、Button の variant のうち
// 「ボタンに見せるべき」もののみ受け付ける
// （ghost / danger は遷移用途として意味的に不適切なため除外）。
// accent は LP の主役 CTA など「強い遷移ボタン」用。
type LinkButtonVariant = 'primary' | 'accent' | 'secondary' | 'outline';

type Props = {
  href: string;
  children: ReactNode;
  variant?: LinkButtonVariant;
  size?: ButtonSize;
  className?: string;
};

export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
}: Props) {
  return (
    <Link
      href={href}
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
    >
      {children}
    </Link>
  );
}
