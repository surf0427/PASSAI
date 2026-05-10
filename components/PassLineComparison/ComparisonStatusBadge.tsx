import type { ComparisonStatus } from '@/lib/passLineComparison';

type Props = {
  status: ComparisonStatus;
};

const STATUS_CONFIG: Record<
  ComparisonStatus,
  { label: string; bg: string; text: string }
> = {
  achieved: {
    label: '達成',
    bg: 'bg-emerald-100',
    text: 'text-emerald-700',
  },
  almost: {
    label: 'あと少し',
    bg: 'bg-blue-100',
    text: 'text-blue-700',
  },
  needsImprovement: {
    label: '要改善',
    bg: 'bg-amber-100',
    text: 'text-amber-800',
  },
};

export function ComparisonStatusBadge({ status }: Props) {
  const c = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center text-[11px] font-bold px-2 py-1 rounded ${c.bg} ${c.text}`}
    >
      {c.label}
    </span>
  );
}
