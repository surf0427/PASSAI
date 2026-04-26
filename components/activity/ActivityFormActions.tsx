type Props = {
  onReset: () => void;
  isLoading?: boolean;
  isSuccess?: boolean;
};

export default function ActivityFormActions({ onReset, isLoading, isSuccess }: Props) {
  const submitLabel = isLoading ? '保存中...' : isSuccess ? '保存しました' : '保存する';
  const submitClass = isSuccess
    ? 'w-full bg-green-500 text-white font-medium py-3 px-6 rounded-md'
    : 'w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-6 rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <>
      <button
        type="submit"
        disabled={isLoading || isSuccess}
        className={submitClass}
      >
        {submitLabel}
      </button>

      <button
        type="button"
        onClick={onReset}
        disabled={isLoading}
        className="mt-3 w-full text-sm text-red-500 border border-red-200 rounded-md py-2 px-6 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        入力内容をリセットする
      </button>
    </>
  );
}
