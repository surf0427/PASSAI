// ダークモード端末でも文字・背景色を明示して読みやすくする
// textareaClass / textareaErrorClass はテンプレートリテラルを使わず静的文字列で展開する
// （Tailwind JIT がテンプレートリテラル内の変数展開クラスを見落とすことがあるため）

export const inputClass =
  'w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-400 dark:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400';

export const inputErrorClass =
  'w-full border border-red-400 rounded-md px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-400';

export const textareaClass =
  'w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-400 dark:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none min-h-[80px]';

export const textareaErrorClass =
  'w-full border border-red-400 rounded-md px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none min-h-[80px]';

export const labelClass = 'block text-sm font-medium text-slate-700 dark:text-slate-700 mb-1';
export const fieldClass = 'mb-3';
