'use client';

// 共通の確認ダイアログ。native window.confirm を置換する用途。
//
// 設計方針:
//   - 最小実装。portal / animation library / global state を使わない。
//     呼び出し側に isOpen / onConfirm / onCancel を保持する state を持たせ、
//     {isOpen && <ConfirmDialog ... />} で render する形を取る。
//   - 既存 Button (variant=danger / secondary / primary) を再利用し、新トークン
//     を追加しない。
//   - mobile では button を縦並びにし、cancel を下に配置（誤タップで destructive
//     を踏まない順序）。sm 以上では横並び右寄せ。
//   - backdrop click で onCancel。Esc / focus trap までは実装しない（過剰実装回避）。

import { Button } from '@/components/ui/Button';

export type ConfirmDialogVariant = 'destructive' | 'default';

export type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        <h2 className="text-base font-bold text-slate-900 mb-2">{title}</h2>
        {description && (
          <p className="text-sm text-slate-600 leading-relaxed mb-5 whitespace-pre-line">
            {description}
          </p>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
          <Button
            variant="secondary"
            onClick={onCancel}
            className="sm:w-auto w-full"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'danger' : 'primary'}
            onClick={onConfirm}
            className="sm:w-auto w-full"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
