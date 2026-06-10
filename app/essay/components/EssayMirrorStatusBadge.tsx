'use client';

// 小論文 Supabase mirror の保存状態を最低限 UI 表示するバッジ（dual-write 配線の一部）。
//
// 役割:
//   essayWorkspaceRepository の debounce mirror が publish する状態（essayMirrorStatus）を
//   subscribe し、画面右下に控えめに表示する。要件「保存失敗時は console.error だけでなく
//   UI 上でも最低限わかるように」を満たす。
//
// 表示方針（UX を壊さない）:
//   - 'error'  … 端末には保存済みで、クラウド同期だけ失敗している状態。控えめな amber 表示で
//                「クラウド保存に失敗（端末には保存済み）」を出す。手動操作は要求しない
//                （次の保存 / 再ログイン backfill で自動再送される）。
//   - 'saving' … ごく控えめな「保存中…」。
//   - 'saved'  … 数秒だけ「クラウドに保存しました」。その後自動的に消える。
//   - 'idle' / 'no-env' … 非表示（Supabase 未設定の dev でユーザーを驚かせない）。
//
// 配置:
//   app/essay/layout.tsx で 1 度だけマウントし、全 essay ページで共有する。

import { useEffect, useState } from 'react';
import {
  getEssayMirrorStatus,
  subscribeEssayMirrorStatus,
  type EssayMirrorStatus,
} from '@/lib/essay/essayMirrorStatus';

export function EssayMirrorStatusBadge() {
  const [status, setStatus] = useState<EssayMirrorStatus>('idle');

  useEffect(() => {
    // マウント時点の現在値に同期してから購読する（取りこぼし防止）。
    setStatus(getEssayMirrorStatus());
    return subscribeEssayMirrorStatus(setStatus);
  }, []);

  // 'saved' は数秒だけ見せて自動的に idle 表示へ畳む。
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (status !== 'saved') {
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 2500);
    return () => clearTimeout(t);
  }, [status]);

  if (status === 'idle' || status === 'no-env') return null;
  if (status === 'saved' && !showSaved) return null;

  const config: Record<
    'saving' | 'saved' | 'error',
    { text: string; cls: string }
  > = {
    saving: {
      text: 'クラウドに保存中…',
      cls: 'bg-slate-100 text-slate-600 border-slate-200',
    },
    saved: {
      text: 'クラウドに保存しました',
      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    error: {
      text: 'クラウド保存に失敗（この端末には保存済み）',
      cls: 'bg-amber-50 text-amber-800 border-amber-300',
    },
  };

  const view = config[status as 'saving' | 'saved' | 'error'];
  if (!view) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-50 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm ${view.cls}`}
    >
      {view.text}
    </div>
  );
}
