import type { ReactNode } from 'react';

// ActivitySection 群（部活動 / ボランティア / 留学 / 探究 / バイト / 資格 /
// コンテスト / 読書 / 趣味）の accordion 外枠を共通化する shell。
// state（open / activities / editingIndex）は呼び出し側に残し、
// shell は header row + trigger button + chevron + content wrapper の
// レンダリングだけを担当する。Accordion.tsx とは文脈が異なる
// （trigger 外 sibling に「＋追加」button が立つ / count badge と error badge を持つ
// / contentId 必須）ため、別 primitive として切り出している。
type Props = {
  title: string;
  count?: number;
  hasError?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  contentId: string;
  rightSlot?: ReactNode;
  children: ReactNode;
};

export function ActivitySectionShell({
  title,
  count,
  hasError,
  isOpen,
  onToggle,
  contentId,
  rightSlot,
  children,
}: Props) {
  return (
    <section className="mb-4 border border-gray-200 rounded-xl bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={contentId}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span className="text-sm font-semibold text-gray-700">{title}</span>
          {count !== undefined && count > 0 && (
            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full shrink-0">
              {count}件
            </span>
          )}
          {hasError && (
            <span className="text-xs font-medium text-red-500 bg-red-50 px-2 py-0.5 rounded-full shrink-0">
              要確認
            </span>
          )}
          <svg
            className={`ml-auto w-4 h-4 text-gray-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {rightSlot}
      </div>

      {isOpen && (
        <div id={contentId} className="border-t border-gray-100 px-4 pt-3 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}
