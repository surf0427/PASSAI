import type { LabelHTMLAttributes } from 'react';

const LABEL_BASE = 'block text-sm font-semibold text-gray-800 mb-2';

type Props = LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className = '', children, ...rest }: Props) {
  return (
    <label className={`${LABEL_BASE} ${className}`} {...rest}>
      {children}
    </label>
  );
}
