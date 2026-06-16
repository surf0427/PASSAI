'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { StoredInterviewRecord } from '@/lib/interviewRecordStorage';
import { getInterviewRecords, deleteInterviewRecord } from '@/lib/interviewRecordStorage';
import { buildGrowthMemo } from '@/lib/interview/buildGrowthMemo';
import { useCurrentUserId } from '@/app/components/AuthProvider';
import {
  getAiInterviewHistory,
  mergeInterviewHistory,
} from '@/lib/repository/interviewAiRepository';
import type { UnifiedInterviewRecord } from '@/types/interviewHistory';
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
  // 対人記録（localStorage canonical）。GrowthMemo / 削除はこの human 記録に対してのみ行う。
  const [humanRecords, setHumanRecords] = useState<StoredInterviewRecord[]>(() =>
    getInterviewRecords(),
  );
  // AI 面接履歴（Supabase read-through, completed のみ）。post-mount で非同期取得する。
  const [aiRecords, setAiRecords] = useState<UnifiedInterviewRecord[]>([]);

  const userId = useCurrentUserId();

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // STEP-INTERVIEW-AI-PR8: AI 面接履歴の read-through。
  //   - userId 未確定（未ログイン）なら取得しない（描画側で空に倒す。effect 内同期 setState を避ける）。
  //   - setState は async（.then / .catch）内のみ。never throw（repository が best-effort）。
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getAiInterviewHistory(userId)
      .then((items) => {
        if (!cancelled) setAiRecords(items);
      })
      .catch(() => {
        if (!cancelled) setAiRecords([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // 削除は対人記録（localStorage）にのみ適用する。AI 履歴は Card 側で削除ボタンを出さない。
  function handleDeleteRecord(id: string) {
    const confirmed = window.confirm('この練習記録を削除しますか？');
    if (!confirmed) return;
    const updated = deleteInterviewRecord(id);
    setHumanRecords(updated);
  }

  // mount 前は memo を作らない（SSR / client first render どちらも null で一致 → mismatch 回避）。
  // GrowthMemo は対人記録（StoredInterviewRecord）のみを入力とする（型・既存挙動を変えない）。
  const growthMemo = isMounted ? buildGrowthMemo(humanRecords) : null;

  // 未ログイン時は AI 履歴を表示しない（effect で reset せず描画側で空に倒す）。
  const effectiveAiRecords = userId ? aiRecords : [];

  // 2 ソース結合（対人 + AI）。practiceDate 降順。source 付与済み。
  const merged = mergeInterviewHistory(humanRecords, effectiveAiRecords);

  return (
    <>
      {growthMemo && <InterviewGrowthMemo memo={growthMemo} />}
      <InterviewHistoryList records={merged} onDelete={handleDeleteRecord} />
    </>
  );
}
