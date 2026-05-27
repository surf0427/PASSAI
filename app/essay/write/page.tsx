// /essay/write entry page（Phase 2 STEP O 新規）。
//
// 役割（フロー②「いきなり書く」エントリ）:
//   - 「新しく書き始める」button: クリックで新 workspace 作成 → /essay/write/[wid]/target へ
//   - 「途中の小論文」一覧: reviews 0 件 + mini 空 + sparring null + body 非空 の workspace
//
// 設計判断（structure entry と排他）:
//   isWriteInProgress フィルタで mini / sparring が無く body にコンテンツがあるものだけ表示。
//   構造的に structure entry と排他になるので同 workspace が両 entry に出ない。

'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  loadEssayWorkspaces,
  upsertEssayWorkspace,
} from '@/lib/essayWorkspaceStorage';
import { createInitialWorkspace } from '@/lib/essay/workspaceOps';
import {
  getWriteProgress,
  getWriteResumePath,
  getWriteResumeStep,
  getWriteStepLabel,
  isWriteInProgress,
} from '@/lib/essay/getWriteResumePath';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { formatReviewDate } from '@/lib/essayPracticeStorage';
import {
  BUTTON_BASE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
} from '@/components/ui/buttonStyles';
import type { EssayWorkspace } from '@/types/essay';

// SSR-stable mount flag。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function EssayWriteEntryPage() {
  const router = useRouter();

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  const inProgressList = useMemo(() => {
    if (!isMounted) return [];
    return loadEssayWorkspaces().filter(isWriteInProgress);
  }, [isMounted]);

  function handleStartNew() {
    // /essay/structure entry と同パターン: basicInfo prefill。
    const baseInfo = loadBasicInfo();
    const pref = baseInfo?.preferences?.[0];
    const examType = baseInfo?.examTypes?.[0];
    const initialTarget = {
      university: pref?.university?.trim() ?? '',
      faculty: pref?.faculty?.trim() ?? '',
      department: (pref?.department ?? '').trim(),
      examType: examType?.trim() ?? '',
    };

    const fresh = createInitialWorkspace({
      target: initialTarget,
      theme: { text: '', type: '', source: '', reason: '' },
      mini: { conclusion: '', reasonOne: '', reasonTwo: '' },
      body: '',
    });

    try {
      upsertEssayWorkspace(fresh);
    } catch (e) {
      console.warn('[essay STEP O] new write workspace save failed', e);
    }

    router.push(`/essay/write/${fresh.id}/target`);
  }

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
        <h1 className="text-3xl font-bold text-gray-800 mb-3">いきなり書く</h1>
        <p className="text-gray-600 text-sm leading-relaxed">
          テーマだけ決めて、いきなり本文を書き始めるシンプルなフローです。
        </p>
        <p className="text-gray-500 text-xs mt-1">
          ※ 思考整理から始めたい場合は「整理して書く」を選んでください。
        </p>
      </div>

      <div className="mb-10 text-center">
        <button
          type="button"
          onClick={handleStartNew}
          className={`${BUTTON_BASE} ${BUTTON_VARIANT.primary} ${BUTTON_SIZE.md}`}
        >
          新しく書き始める →
        </button>
      </div>

      {!isMounted ? (
        <div className="text-sm text-gray-500">読み込み中…</div>
      ) : inProgressList.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            途中の小論文（{inProgressList.length} 件）
          </h2>
          <div className="space-y-3">
            {inProgressList.map((ws) => (
              <InProgressCard key={ws.id} workspace={ws} />
            ))}
          </div>
          <p className="mt-4 text-xs text-gray-400">
            ※ クリックすると、止まっていた場所から再開します。
          </p>
        </section>
      ) : null}
    </div>
  );
}

function InProgressCard({ workspace }: { workspace: EssayWorkspace }) {
  const step = getWriteResumeStep(workspace);
  const stepLabel = getWriteStepLabel(step);
  const resumePath = getWriteResumePath(workspace);
  const progress = getWriteProgress(workspace);
  const targetLabel =
    [workspace.target.university, workspace.target.faculty]
      .filter((s) => s.trim() !== '')
      .join(' / ') || '志望校未設定';
  const themeText = workspace.theme.text || 'テーマ未設定';

  return (
    <Link
      href={resumePath}
      className="block bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm rounded-xl p-5 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-sm font-semibold text-gray-800 line-clamp-2">
          {themeText}
        </p>
        <span className="shrink-0 inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
          {stepLabel}
        </span>
      </div>
      {/* progress dots（Phase 2 STEP P 追加） */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-gray-500">
          {progress.completed} / {progress.total} 完了
        </span>
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: progress.total }).map((_, i) => (
            <span
              key={i}
              className={`block w-1.5 h-1.5 rounded-full ${
                i < progress.completed ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span>{targetLabel}</span>
        <span>·</span>
        <span>{formatReviewDate(workspace.updatedAt)}</span>
      </div>
    </Link>
  );
}
