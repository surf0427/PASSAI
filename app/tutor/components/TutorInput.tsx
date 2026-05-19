'use client';

// PASSAI 受験チューターAI のメッセージ入力欄（実装 STEP8）。
//
// 役割:
//   - 多行可能な textarea + 送信ボタン
//   - Enter で送信、Shift+Enter で改行
//   - IME 変換中の Enter は送信しない（日本語入力時の誤送信防止）
//   - 500 字を maxLength で natively 制限（server 側でも MAX_MESSAGE_LENGTH=500）
//   - loading / disabled で UX を抑える
//
// 含めない:
//   - 音声入力 / 画像添付（v1 スコープ外）
//   - 「もっと話す」ボタン（依存形成防止）

const MAX_LENGTH = 500;

type TutorInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export function TutorInput({ value, onChange, onSubmit, disabled, loading }: TutorInputProps) {
  const canSubmit = !disabled && !loading && value.trim() !== '';

  return (
    <div className="flex gap-2 items-end">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          // Shift+Enter は改行を許可
          if (e.shiftKey) return;
          // IME 変換中（日本語入力の確定前）は送信しない
          const native = e.nativeEvent as KeyboardEvent;
          if (native.isComposing || native.keyCode === 229) return;
          e.preventDefault();
          if (canSubmit) onSubmit();
        }}
        placeholder="いま気になってることを書いてください"
        disabled={disabled || loading}
        rows={1}
        maxLength={MAX_LENGTH}
        className="flex-1 resize-none border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 min-h-[44px] max-h-32"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors whitespace-nowrap"
      >
        {loading ? '送信中…' : '送る'}
      </button>
    </div>
  );
}
