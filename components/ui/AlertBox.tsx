import type { HTMLAttributes } from 'react';

export type AlertBoxVariant = 'info' | 'success' | 'warning' | 'error';

const ALERT_BASE = 'rounded-2xl border p-4 text-sm leading-relaxed';

const ALERT_VARIANT: Record<AlertBoxVariant, string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-900',
  success: 'bg-green-50 border-green-200 text-green-900',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-900',
  error: 'bg-red-50 border-red-200 text-red-900',
};

type Props = HTMLAttributes<HTMLDivElement> & {
  variant?: AlertBoxVariant;
};

export function AlertBox({
  variant = 'info',
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <div
      className={`${ALERT_BASE} ${ALERT_VARIANT[variant]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
