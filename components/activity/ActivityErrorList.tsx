import { AlertBox } from '@/components/ui/AlertBox';

type Props = {
  errors: string[];
};

export default function ActivityErrorList({ errors }: Props) {
  if (errors.length === 0) return null;

  return (
    <AlertBox variant="error" className="mb-6">
      <p className="text-sm font-medium text-red-700 mb-2">以下の項目を確認してください</p>
      <ul className="list-disc list-inside space-y-1">
        {errors.map((error, i) => (
          <li key={i} className="text-sm text-red-600">{error}</li>
        ))}
      </ul>
    </AlertBox>
  );
}
