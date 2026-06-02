// STEP-CHAT-HISTORY-01 / STEP-CHAT-SIDEBAR-01:
//   チャット履歴サイドバー（PC）/ ドロワー（Mobile）。
//
// 役割:
//   - thread 一覧表示（title + 最終更新日時）
//   - 現在 thread の選択 highlight
//   - 新しい相談ボタン
//   - 削除ボタン（hover 表示）
//   - 他端末でのみ残っている Supabase 履歴を末尾に locked 表示
//     （クリック復元は本 STEP の非ゴール）
//
// レイアウト:
//   PC（sm:） : 左 sidebar 280px・固定表示
//   Mobile    : 上部にトグル式の collapsible パネル
//
// 既存の TutorBubble / TutorInput と同じ視覚トーン（rounded-2xl・gray-200 border 等）に合わせる。

'use client';

import { useMemo, useState } from 'react';
import type { SupabaseTutorThread, TutorChatThread } from '@/types/tutorChat';

type Props = {
  threads: TutorChatThread[];
  currentThreadId: string | null;
  onSelect: (threadId: string) => void;
  onCreate: () => void;
  onDelete: (threadId: string) => void;
  /**
   * Supabase 側から取得した thread 一覧（取得失敗時は空配列）。
   * localStorage に対応 thread が無いものだけ「他端末の履歴」として表示する。
   */
  remoteThreads?: SupabaseTutorThread[];
  /**
   * STEP-CHAT-RESTORE-01: 「他端末の履歴」item クリック時に呼ばれる復元 handler。
   * 未指定の場合は item を disabled 表示にフォールバックする。
   */
  onRestoreRemote?: (remote: SupabaseTutorThread) => void;
  /** 現在復元中の remote.id（クリック中の二重発火防止）。 */
  restoringRemoteId?: string | null;
};

function formatUpdatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    const sameYear = d.getFullYear() === now.getFullYear();
    if (sameYear) {
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return '';
  }
}

// STEP-CHAT-RESTORE-01: remote thread から localStorage 側で使う thread id を派生する。
// - localThreadId があればそれをそのまま採用（永続化時の元 id を維持）。
// - 無ければ "remote-${supabase.id}" を生成（restore 後の上書きは page 側で実施）。
function deriveLocalThreadId(remote: SupabaseTutorThread): string {
  return remote.localThreadId ?? `remote-${remote.id}`;
}

export function TutorThreadSidebar({
  threads,
  currentThreadId,
  onSelect,
  onCreate,
  onDelete,
  remoteThreads = [],
  onRestoreRemote,
  restoringRemoteId = null,
}: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const currentThread = threads.find((t) => t.id === currentThreadId) ?? null;

  // localStorage に対応行がない remote thread のみ表示する。
  // 対応キーは deriveLocalThreadId(remote) ↔ localStorage thread.id。
  // localThreadId が null の remote も `remote-<id>` の派生 key で識別する。
  const remoteOnlyThreads = useMemo(() => {
    if (remoteThreads.length === 0) return [];
    const localIds = new Set(threads.map((t) => t.id));
    return remoteThreads
      .filter((r) => !localIds.has(deriveLocalThreadId(r)))
      .sort((a, b) => {
        const ax = a.lastMessageAt ?? a.updatedAt;
        const bx = b.lastMessageAt ?? b.updatedAt;
        return bx.localeCompare(ax);
      });
  }, [remoteThreads, threads]);

  function handleRestore(e: React.MouseEvent, remote: SupabaseTutorThread) {
    e.stopPropagation();
    if (!onRestoreRemote || restoringRemoteId !== null) return;
    onRestoreRemote(remote);
    setMobileOpen(false);
  }

  function handleDelete(e: React.MouseEvent, threadId: string) {
    e.stopPropagation();
    if (!window.confirm('このチャットを削除しますか？\nこの操作は元に戻せません。')) return;
    onDelete(threadId);
  }

  function handleSelect(threadId: string) {
    onSelect(threadId);
    setMobileOpen(false);
  }

  function handleCreate() {
    onCreate();
    setMobileOpen(false);
  }

  const list = (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-200">
        <button
          type="button"
          onClick={handleCreate}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 px-3 rounded-lg transition-colors"
        >
          ＋ 新しい相談
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {threads.length === 0 && (
          <p className="text-xs text-gray-400 px-2 py-3 text-center">
            まだチャットはありません
          </p>
        )}
        {threads.map((t) => {
          const active = t.id === currentThreadId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => handleSelect(t.id)}
              className={`group w-full text-left rounded-lg px-3 py-2 transition-colors ${
                active
                  ? 'bg-blue-50 ring-1 ring-blue-200'
                  : 'hover:bg-gray-100'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p
                  className={`text-sm leading-snug line-clamp-2 ${active ? 'text-blue-700 font-semibold' : 'text-gray-700'}`}
                >
                  {t.title}
                </p>
                <span
                  onClick={(e) => handleDelete(e, t.id)}
                  role="button"
                  tabIndex={-1}
                  aria-label="削除"
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs shrink-0 cursor-pointer"
                >
                  削除
                </span>
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {formatUpdatedAt(t.updatedAt)}
              </p>
            </button>
          );
        })}

        {remoteOnlyThreads.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-200">
            <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              他端末の履歴
            </p>
            {remoteOnlyThreads.map((r) => {
              const restoring = restoringRemoteId === r.id;
              const canRestore = Boolean(onRestoreRemote) && !restoring;
              return (
                <button
                  key={`remote-${r.id}`}
                  type="button"
                  onClick={canRestore ? (e) => handleRestore(e, r) : undefined}
                  disabled={!canRestore}
                  className={`group w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    canRestore
                      ? 'hover:bg-blue-50 cursor-pointer'
                      : 'cursor-not-allowed'
                  }`}
                  title={
                    canRestore
                      ? 'クリックでこの履歴を取り込んで再開'
                      : restoring
                        ? '復元中…'
                        : undefined
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={`text-sm leading-snug line-clamp-2 ${
                        canRestore ? 'text-gray-600' : 'text-gray-400'
                      }`}
                    >
                      {r.title}
                    </p>
                    <span
                      className={`text-[10px] shrink-0 mt-0.5 ${
                        restoring
                          ? 'text-gray-400'
                          : 'text-blue-600 opacity-0 group-hover:opacity-100'
                      }`}
                      aria-hidden
                    >
                      {restoring ? '復元中…' : '↓ 取り込む'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {formatUpdatedAt(r.lastMessageAt ?? r.updatedAt)}
                    <span className="ml-1">・他端末</span>
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* PC: 左 sidebar */}
      <aside className="hidden sm:flex w-64 border-r border-gray-200 bg-white sticky top-0 h-screen">
        {list}
      </aside>

      {/* Mobile: 上部 toggle */}
      <div className="sm:hidden border-b border-gray-200 bg-white">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-700"
        >
          <span className="truncate">
            {currentThread ? currentThread.title : '新しい相談'}
          </span>
          <span className="ml-2 text-xs text-gray-400 shrink-0">
            {mobileOpen ? '▲ 閉じる' : '▼ 履歴'}
          </span>
        </button>
        {mobileOpen && (
          <div className="border-t border-gray-200 max-h-[60vh] overflow-y-auto">
            {list}
          </div>
        )}
      </div>
    </>
  );
}
