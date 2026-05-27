// 小論文 workspace 1 件の view-only 詳細ページ（STEP C 新規）。
//
// 表示順序:
//   1. ヘッダ（テーマ + 大学情報 + 戻る link）
//   2. ミニ思考欄（空でなければ）
//   3. 現在の本文（workspace.body）
//   4. 添削履歴（reviews を append-only 時系列・古い順に表示）
//
// view only: 改善 / rewrite / compare 動線は持たない（STEP D 以降で導入）。
//
// 不正な wid → workspace が見つからない場合は Not Found UI を返す。
// pre-mount は読み込み中表示で hydration mismatch を回避する。

'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { loadEssayWorkspace } from '@/lib/essayWorkspaceStorage';
import { EssayReviewCard } from '@/app/essay/components/EssayReviewCard';

// SSR-stable mount flag。既存ページと同形パターン。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function EssayResultDetailPage() {
  const params = useParams<{ wid: string }>();
  const wid = params?.wid ?? '';

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  const workspace = useMemo(
    () => (isMounted && wid ? loadEssayWorkspace(wid) : null),
    [isMounted, wid],
  );

  // pre-mount: 読み込み中。SSR / hydration safe。
  if (!isMounted) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-sm text-gray-500">読み込み中…</div>
      </div>
    );
  }

  // wid が不正 or workspace が削除されている / LRU で退役済み。
  if (!workspace) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="mb-6">
          <Link
            href="/essay/results"
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            ← 一覧に戻る
          </Link>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <h1 className="text-lg font-semibold text-gray-800 mb-2">
            見つかりませんでした
          </h1>
          <p className="text-sm text-gray-600">
            指定された結果は存在しないか、保存件数の上限を超えて退役した可能性があります。
          </p>
        </div>
      </div>
    );
  }

  const targetLabel =
    [
      workspace.target.university,
      workspace.target.faculty,
      workspace.target.department,
    ]
      .filter((s) => s.trim() !== '')
      .join(' / ') || '志望校未設定';

  const themeText = workspace.theme.text || 'テーマ未設定';
  const hasMini =
    workspace.mini.conclusion.trim() !== '' ||
    workspace.mini.reasonOne.trim() !== '' ||
    workspace.mini.reasonTwo.trim() !== '';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href="/essay/results"
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← 一覧に戻る
        </Link>
      </div>

      {/* ヘッダ */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-3 leading-snug">
          {themeText}
        </h1>
        <p className="text-xs text-gray-500">{targetLabel}</p>
      </div>

      {/* ミニ思考欄（空なら描画しない） */}
      {hasMini && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            ミニ思考欄
          </h2>
          <div className="space-y-2 text-sm text-gray-800">
            {workspace.mini.conclusion && (
              <p>
                <span className="text-gray-400 mr-2">結論</span>
                {workspace.mini.conclusion}
              </p>
            )}
            {workspace.mini.reasonOne && (
              <p>
                <span className="text-gray-400 mr-2">理由①</span>
                {workspace.mini.reasonOne}
              </p>
            )}
            {workspace.mini.reasonTwo && (
              <p>
                <span className="text-gray-400 mr-2">理由②</span>
                {workspace.mini.reasonTwo}
              </p>
            )}
          </div>
        </section>
      )}

      {/* 現在の本文（latest review snapshot と一致＝ invariant I3） */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">現在の本文</h2>
        {workspace.body ? (
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
            {workspace.body}
          </p>
        ) : (
          <p className="text-sm text-gray-500 italic">
            本文は保存されていません。
          </p>
        )}
      </section>

      {/* 添削履歴（append-only 時系列） */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          添削履歴（古い順、{workspace.reviews.length} 件）
        </h2>
        {workspace.reviews.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-5 text-sm text-gray-500">
            添削履歴はまだありません。
          </div>
        ) : (
          <div className="space-y-4">
            {workspace.reviews.map((review, index) => (
              <EssayReviewCard
                key={`${review.createdAt}-${index}`}
                review={review}
                index={index}
              />
            ))}
          </div>
        )}
      </section>

      {/* 責務分離 UX 修正: ①②③ は View / Analyze 専用、改善実行は ④（/essay/improve）
          側に集約する方針に合わせ、結果ページからの「改善する」CTA は撤去。
          代わりに hub 戻り CTA を置き、「書く → 評価を見る → 一旦終了」を自然に流す。 */}
      <div className="mt-8 text-center">
        <Link
          href="/essay"
          className="inline-flex items-center justify-center font-medium rounded-xl text-sm px-6 py-2.5 bg-brand-600 text-white hover:bg-brand-700 transition-colors"
        >
          保存して小論文機能一覧へ戻る
        </Link>
      </div>
    </div>
  );
}
