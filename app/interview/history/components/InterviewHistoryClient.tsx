'use client';

import { useState } from 'react';
import type { InterviewRecord } from '@/types/interview';
import { getInterviewRecords, deleteInterviewRecord } from '@/lib/interviewRecordStorage';
import { InterviewHistoryList } from './InterviewHistoryList';

export function InterviewHistoryClient() {
  const [records, setRecords] = useState<InterviewRecord[]>(() => getInterviewRecords());

  function handleDeleteRecord(id: string) {
    const confirmed = window.confirm('この練習記録を削除しますか？');
    if (!confirmed) return;
    const updated = deleteInterviewRecord(id);
    setRecords(updated);
  }

  return <InterviewHistoryList records={records} onDelete={handleDeleteRecord} />;
}
