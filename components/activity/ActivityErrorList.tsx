type Props = {
  errors: string[];
};

export default function ActivityErrorList({ errors }: Props) {
  if (errors.length === 0) return null;

  return (
    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
      <p className="text-sm font-medium text-red-700 mb-2">以下の項目を確認してください</p>
      <ul className="list-disc list-inside space-y-1">
        {errors.map((error, i) => (
          <li key={i} className="text-sm text-red-600">{error}</li>
        ))}
      </ul>
    </div>
  );
}
