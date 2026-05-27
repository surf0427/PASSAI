// 小論文の workspace 一覧（STEP C 新規）。
// loadEssayWorkspaces() で取得し、updatedAt 降順（storage 側で sort 済み）に表示する。
//
// pre-mount は localStorage を読まず読み込み中表示で hydration mismatch を回避する
// （既存 essay-practice / statement/analysis と同形パターン）。
//
// view only: 改善 / rewrite / 削除 / 並び替え UI は持たない。

'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { loadEssayWorkspaces } from '@/lib/essayWorkspaceStorage';
import { EssayWorkspaceCard } from '@/app/essay/components/EssayWorkspaceCard';

// SSR-stable mount flag。既存ページと同形パターン。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function EssayResultsPage() {
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // mount 後にだけ localStorage を読む（hydration mismatch 回避）。
  // loadEssayWorkspaces は内部で SSR ガード済みだが、明示的に isMounted で
  // pre-mount を空配列に倒し、レンダリングを「読み込み中」状態にする。
  const workspaces = useMemo(
    () => (isMounted ? loadEssayWorkspaces() : []),
    [isMounted],
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href="/essay"
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← 小論文トップへ
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-3">
          小論文の結果
        </h1>
        <p className="text-gray-600 text-sm">
          過去の添削結果を新しい順に表示しています（最大 10 件）。
        </p>
      </div>

      {!isMounted ? (
        <div className="text-sm text-gray-500">読み込み中…</div>
      ) : workspaces.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-600">
            まだ小論文の結果がありません。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {workspaces.map((ws) => (
            <EssayWorkspaceCard key={ws.id} workspace={ws} />
          ))}
        </div>
      )}
    </div>
  );
}
