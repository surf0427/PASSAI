import type { UnifiedInterviewRecord } from '@/types/interviewHistory';
import { InterviewHistoryCard } from './InterviewHistoryCard';
import { InterviewHistoryEmpty } from './InterviewHistoryEmpty';

type Props = {
  records: UnifiedInterviewRecord[];
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
