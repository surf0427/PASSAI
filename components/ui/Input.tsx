import { forwardRef, type InputHTMLAttributes } from 'react';

const INPUT_BASE =
  'w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500';

type Props = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, Props>(
  function Input({ className = '', type = 'text', ...rest }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={`${INPUT_BASE} ${className}`}
        {...rest}
      />
    );
  },
);
