'use client';

import { useState } from 'react';
import type { ActivityData } from '@/types/activity';
import type { WallHittingResult } from '@/types/analysis';
import type { BasicInfo } from '@/types/basicInfo';

export function useWallHitting(
  activityData: ActivityData | null,
  basicInfo: BasicInfo | null = null,
) {
  const [result, setResult] = useState<WallHittingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    if (!activityData) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // basicInfo を一緒に送る。API 側で UniversityContext に変換される。
        // TODO: 将来は client 側で大学DB検索済みの universityContext を直接送るオプションも追加できる。
        body: JSON.stringify({ activityData, basicInfo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? '分析に失敗しました。もう一度お試しください。');
        return;
      }
      setResult(data.result as WallHittingResult);
    } catch {
      setError('通信エラーが発生しました。インターネット接続を確認してください。');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResult(null);
    setError('');
  }

  return { result, loading, error, run, reset };
}
