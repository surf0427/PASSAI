'use client';

// PASSAI shared — LoadingProgress
//
// AI 実行中の不安（止まって見える / 何が起きているか分からない）を軽減する loading box。
// 既存の AiThinkingState (`components/shared/result/AiThinkingState.tsx`) と並列の役割で、
// AiThinkingState からの差分は:
//   - 経過秒数を 1 秒ごとに更新表示する（startedAt からの diff を Math.floor で秒丸め）
//   - subMessages を 6 秒ごとに rotate して「今こういう処理をしている」雰囲気を伝える
//   - onCancel を渡せば「キャンセル」button を出す（呼び出し側で AbortController +
//     state reset の責務を持つ。本 component はイベント通知のみ。
//     STEP-UX-FIX-06-LOADING-PROGRESS 時点では client 側 AbortController が未整備のため、
//     どの caller も onCancel を渡していない。次 STEP で順次接続）
//
// 既存 AiThinkingState は他 caller (self-analysis/run / essay-practice 等) との互換維持の
// ため温存し、本 component は新規 caller / 移行を望む caller に限り採用する。
//
// 設計方針:
//   - fake progress bar / percentage は出さない（ユーザーへの誇張になる）
//   - elapsed seconds は Date.now() 由来。setInterval(1000ms) で更新。
//     startedAt 変更時 / unmount 時に cleanup。
//   - sub-message rotation は deterministic (Math.floor(elapsed / 6) % length)。
//     状態を持たないため hydration 影響なし。

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';

export type LoadingProgressProps = {
  /** loading 開始時刻 (Date.now())。経過秒数の起点。
   *  caller は loading=true に切り替えるタイミングで Date.now() を捕捉して保持する。 */
  startedAt: number;
  /** 中央の太字メッセージ。例:「AIが添削しています」。経過秒は本 component が追加する。 */
  label: string;
  /** 補助メッセージ群。6 秒ごとに rotate 表示。空 / undefined なら非表示。 */
  subMessages?: readonly string[];
  /** 「平均 N 秒」の補助文を出す。AiThinkingState と同じ意味論。 */
  estimatedSeconds?: number;
  /** cancel button。callback 渡し時のみ表示。
   *  callback は AbortController.abort() + state reset の責務を持つ。 */
  onCancel?: () => void;
  /** 白背景の box を外す場合 false。default true。 */
  framed?: boolean;
};

const ROTATION_INTERVAL_SECONDS = 6;

export function LoadingProgress({
  startedAt,
  label,
  subMessages,
  estimatedSeconds,
  onCancel,
  framed = true,
}: LoadingProgressProps) {
  // 初期値は lazy initializer で startedAt 由来の経過秒を 1 度だけ計算。
  // 以降は setInterval(1000ms) callback 内で setState する（callback 内なので
  // react-hooks/set-state-in-effect 違反にならない）。
  // 通常 caller (loading=true でマウント → false で unmount) の用途では startedAt は
  // mount 中に変化しないため、初期値で正しい経過秒が出る。仮に startedAt が変わっても、
  // 次の interval tick（最大 1 秒後）で正しい値に追従する。
  const [elapsedSeconds, setElapsedSeconds] = useState(() => secondsSince(startedAt));

  useEffect(() => {
    const id = setInterval(() => {
      setElapsedSeconds(secondsSince(startedAt));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const subMessage =
    subMessages && subMessages.length > 0
      ? subMessages[
          Math.floor(elapsedSeconds / ROTATION_INTERVAL_SECONDS) % subMessages.length
        ]
      : null;

  const inner = (
    <>
      <div className="flex justify-center mb-4">
        <svg
          className="animate-spin h-8 w-8 text-brand-600"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z"
          />
        </svg>
      </div>
      <p className="text-gray-700 font-medium mb-1 tabular-nums">
        {label}（{elapsedSeconds}秒）
      </p>
      {subMessage && (
        <p className="text-gray-500 text-sm mb-1">{subMessage}</p>
      )}
      {estimatedSeconds !== undefined && (
        <p className="text-gray-400 text-xs">
          平均 {estimatedSeconds} 秒。混雑時はもう少しかかります。
        </p>
      )}
      {onCancel && (
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            キャンセル
          </Button>
        </div>
      )}
    </>
  );

  if (!framed) {
    return (
      <div className="text-center" role="status" aria-live="polite">
        {inner}
      </div>
    );
  }
  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-8 text-center"
      role="status"
      aria-live="polite"
    >
      {inner}
    </div>
  );
}

function secondsSince(startedAt: number): number {
  const diffMs = Date.now() - startedAt;
  return Math.max(0, Math.floor(diffMs / 1000));
}
