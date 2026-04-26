type Props = {
  label: string;
  summary: string;
  isEditing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onRemove: () => void;
  children: React.ReactNode;
};

export function ActivityCard({ label, summary, isEditing, onEdit, onDone, onRemove, children }: Props) {
  if (!isEditing) {
    return (
      <div className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium text-gray-700 truncate block">
            {summary || '（未入力）'}
          </span>
          <span className="text-xs text-gray-400">{label}</span>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="text-xs text-blue-600 border border-blue-300 rounded px-2 py-1 hover:bg-blue-50"
          >
            編集
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-red-500 border border-red-300 rounded px-2 py-1 hover:bg-red-50"
          >
            削除
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-blue-300 rounded-lg p-4 bg-white">
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm font-medium text-gray-600">{label}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDone}
            className="text-xs text-green-600 border border-green-300 rounded px-2 py-1 hover:bg-green-50 font-medium"
          >
            ✓ 完了
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-red-500 border border-red-300 rounded px-2 py-1 hover:bg-red-50"
          >
            削除
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
