'use client';

import { useState, useSyncExternalStore } from 'react';
import type { StoredInterviewRecord } from '@/lib/interviewRecordStorage';
import { getInterviewRecords, deleteInterviewRecord } from '@/lib/interviewRecordStorage';
import { buildGrowthMemo } from '@/lib/interview/buildGrowthMemo';
import { InterviewGrowthMemo } from './InterviewGrowthMemo';
import { InterviewHistoryList } from './InterviewHistoryList';

// mount ゲート（SSR=false / mount後=true）。
// useState(() => getInterviewRecords()) は SSR で [] / client で実値となり既存的に
// mismatch があるが、新規 GrowthMemo は本フラグで完全に post-mount 描画にする。
// app/interview/page.tsx と同形パターン（set-state-in-effect lint を踏まない）。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export function InterviewHistoryClient() {
  // STEP10.2: buildGrowthMemo は StoredInterviewRecord[] を要求するため、state 型を
  // 実体（getInterviewRecords の返り値）に揃えて widen する。
  // 下流の <InterviewHistoryList records={InterviewRecord[]}> は構造的に upcast OK。
  const [records, setRecords] = useState<StoredInterviewRecord[]>(() => getInterviewRecords());

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  function handleDeleteRecord(id: string) {
    const confirmed = window.confirm('この練習記録を削除しますか？');
    if (!confirmed) return;
    const updated = deleteInterviewRecord(id);
    setRecords(updated);
  }

  // mount 前は memo を作らない（SSR / client first render どちらも null で一致 → mismatch 回避）。
  // buildGrowthMemo は records < 2 件で null を返すため、データ不足時も自動的に非描画。
  const growthMemo = isMounted ? buildGrowthMemo(records) : null;

  return (
    <>
      {growthMemo && <InterviewGrowthMemo memo={growthMemo} />}
      <InterviewHistoryList records={records} onDelete={handleDeleteRecord} />
    </>
  );
}
