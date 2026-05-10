import type { ButtonHTMLAttributes, ReactNode } from 'react';
import {
  BUTTON_BASE,
  BUTTON_VARIANT,
  BUTTON_SIZE,
  type ButtonVariant,
  type ButtonSize,
} from './buttonStyles';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
