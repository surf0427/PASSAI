import type { InterviewRecord } from '@/types/interview';
import { InterviewHistoryCard } from './InterviewHistoryCard';
import { InterviewHistoryEmpty } from './InterviewHistoryEmpty';

type Props = {
  records: InterviewRecord[];
  onDelete: (id: string) => void;
};

export function InterviewHistoryList({ records, onDelete }: Props) {
  if (records.length === 0) {
    return <InterviewHistoryEmpty />;
  }

  return (
    <div className="grid gap-4">
      {records.map((record) => (
        <InterviewHistoryCard key={record.id} record={record} onDelete={onDelete} />
      ))}
    </div>
  );
}
