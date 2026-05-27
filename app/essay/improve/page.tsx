// 小論文 改善対象 workspace 一覧（hub からの「改善する」エントリ）。
//
// /essay/results との違い:
//   - /essay/results : 全 workspace を「結果閲覧」目的でリスト
//   - /essay/improve : reviews が 1 件以上ある workspace のみリスト、クリック先は
//                      改善ワーク開始の `/essay/improve/[wid]`
//
// 同じ EssayWorkspaceCard を href prop で再利用する（view only / 動作分岐なし）。

'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { loadEssayWorkspaces } from '@/lib/essayWorkspaceStorage';
import { EssayWorkspaceCard } from '@/app/essay/components/EssayWorkspaceCard';

// SSR-stable mount flag。既存ページと同形パターン。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function EssayImproveListPage() {
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // mount 後にだけ localStorage を読む（hydration mismatch 回避）。
  // 改善対象は「添削が 1 回以上ある workspace」だけ。reviews 空の workspace は
  // 改善点を提示できないため除外する。
  const workspaces = useMemo(() => {
    if (!isMounted) return [];
    return loadEssayWorkspaces().filter((w) => w.reviews.length > 0);
  }, [isMounted]);

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
        <h1 className="text-3xl font-bold text-gray-800 mb-3">改善する</h1>
        <p className="text-gray-600 text-sm">
          過去の添削結果から改善ポイントを選び、1 つずつ直して書き直します。
        </p>
      </div>

      {!isMounted ? (
        <div className="text-sm text-gray-500">読み込み中…</div>
      ) : workspaces.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-600 mb-3">
            添削済みの小論文がありません。
          </p>
          <p className="text-xs text-gray-500">
            先に小論文を書いて添削を受けると、改善ポイントから書き直すことができます。
          </p>
          <div className="mt-5">
            <Link
              href="/essay-practice"
              className="inline-flex items-center justify-center font-medium rounded-xl text-sm px-6 py-2.5 bg-brand-600 text-white hover:bg-brand-700 transition-colors"
            >
              小論文を書きに行く →
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {workspaces.map((ws) => (
            <EssayWorkspaceCard
              key={ws.id}
              workspace={ws}
              href={`/essay/improve/${ws.id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
