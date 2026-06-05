'use client';

import { useState } from 'react';
import type { ActivityData } from '@/types/activity';
import type { WallHittingResult } from '@/types/analysis';
import type { BasicInfo } from '@/types/basicInfo';
import { buildUniversityContextFromBasicInfo } from '@/lib/buildUniversityContext';
import {
  ANALYSIS_MODEL,
  ANALYSIS_PROMPT_VERSION,
  hashAnalysisInput,
} from '@/lib/aiInputHash';
import { loadWallHittingResult } from '@/lib/wallHittingStorage';
import {
  loadWallHittingInputHash,
  saveWallHittingInputHash,
} from '@/lib/wallHittingInputHashStorage';
import { logAiCache } from '@/lib/aiCacheLog';
import { validateAnalysisInput } from '@/lib/validation/validateAnalysisInput';
import { logAiValidation } from '@/lib/aiValidationLog';

// STEP5.2: input hash cache の対象 route。logAiCache の `route` field とも一致。
// server route.ts の ROUTE 定数と揃えてある（server は変更しないため別箇所で定義）。
const ROUTE = 'api/analysis';

// STEP-GATE-COMPLETE: caller 側で 402 quota-exceeded を捕まえるための optional hook。
// useQuotaDialog().handleResponse をそのまま渡せる形にしてある (戻り値 true で「処理停止」)。
// 渡さない場合 (legacy callers) は何もしない。
type UseWallHittingOptions = {
  onResponse?: (res: Response) => Promise<boolean>;
};

export function useWallHitting(
  activityData: ActivityData | null,
  basicInfo: BasicInfo | null = null,
  options?: UseWallHittingOptions,
) {
  const [result, setResult] = useState<WallHittingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    if (!activityData) return;

    // deterministic validation: 低品質入力を hash / cache / fetch 到達前に弾く。
    // fail 時は setError + return のみ。daily limit / ai usage / ai cache いずれも未消費。
    const validation = validateAnalysisInput(activityData);
    if (!validation.ok) {
      logAiValidation({
        type: 'validation_reject',
        route: 'analysis',
        code: validation.code,
      });
      setError(validation.message);
      return;
    }
    logAiValidation({ type: 'validation_pass', route: 'analysis' });

    // STEP5.2: 同一入力なら AI を呼ばずに保存済み結果を復元する。
    // universityContext は server route.ts と同じ buildUniversityContextFromBasicInfo()
    // で派生させる（server 側ロジックと揃えないと hash が一致しない）。
    // 出力 hash (StudentProfile.sourceHash) とは概念別レーン。
    const universityContext = buildUniversityContextFromBasicInfo(basicInfo);
    const inputHash = hashAnalysisInput({
      activityData,
      basicInfo,
      universityContext,
      model: ANALYSIS_MODEL,
      promptVersion: ANALYSIS_PROMPT_VERSION,
    });

    const cached = loadWallHittingInputHash();
    const savedResult = loadWallHittingResult();
    if (
      cached &&
      savedResult &&
      cached.inputHash === inputHash &&
      cached.model === ANALYSIS_MODEL &&
      cached.promptVersion === ANALYSIS_PROMPT_VERSION
    ) {
      // cache hit: AI を呼ばずに即復元する。loading は立てない（spinner flash を避ける）。
      logAiCache({ route: ROUTE, action: 'hit', inputHash });
      setError('');
      setResult(savedResult);
      return;
    }
    logAiCache({ route: ROUTE, action: 'miss', inputHash });

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

      // STEP-GATE-COMPLETE: caller (useQuotaDialog) が 402 を捕まえたら早期 return。
      // finally で loading 解除されるため state 整合性は保たれる。
      if (options?.onResponse && (await options.onResponse(res))) {
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? '分析に失敗しました。もう一度お試しください。');
        return;
      }
      // STEP5.2: 成功 response の入力 hash を保存。
      // wallHittingResult 本体の保存は self-analysis/page.tsx 側の既存 useEffect で行われる
      // （hook の責務外）。順序は hash 先 → setResult → page 側 save。
      // cache hit 判定で `savedResult` の存在も AND チェックしているため、hash だけ書き込まれて
      // result が無い中断状態も「miss」として安全に AI 再生成にフォールバックする。
      saveWallHittingInputHash({
        inputHash,
        model: ANALYSIS_MODEL,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        savedAt: new Date().toISOString(),
      });
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
