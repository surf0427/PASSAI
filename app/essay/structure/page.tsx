// /essay/structure entry page（Phase 2 STEP K 新規）。
//
// 役割:
//   - 「整理して書き始める」button: クリック時に新規 workspace を作って
//     /essay/structure/[wid]/target へ遷移
//   - 「途中の小論文」一覧: reviews 0 件かつ structure 系フィールド入力済みの
//     workspace を表示し、クリックで未完 step へ resume
//
// 設計ポイント:
//   - mount-time mutation 禁止: useEffect で createInitialWorkspace を呼ばない
//   - ghost workspace 防止: button click 起点でのみ workspace 作成
//   - target は basicInfo.preferences[0] / examTypes[0] から prefill
//     （既存 /essay-practice と同 UX、ユーザーが既にあるデータを再入力させない）

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
  getStructureProgress,
  getStructureResumePath,
  getStructureResumeStep,
  getStructureStepLabel,
  isStructureInProgress,
} from '@/lib/essay/getStructureResumePath';
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

export default function EssayStructureEntryPage() {
  const router = useRouter();

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // 進行中 workspace 一覧（reviews 0 件 + structure フィールド入力済み）。
  // pre-mount は空配列を返して hydration mismatch を避ける。
  const inProgressList = useMemo(() => {
    if (!isMounted) return [];
    return loadEssayWorkspaces().filter(isStructureInProgress);
  }, [isMounted]);

  // 「整理して書き始める」button click ハンドラ。
  // mount-time ではなくユーザー操作起点で workspace を作る。
  function handleStartNew() {
    // basicInfo の preferences[0] / examTypes[0] を target prefill のソースに使う。
    // 既存 /essay-practice のステップ 0 と同パターン。
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
      // best-effort: 保存失敗時もユーザー操作を遮らない（fresh の id は確定済み）。
      // ただしリダイレクト先で読み込めなくなる可能性があるため warn だけ残す。
      console.warn('[essay STEP K] new workspace save failed', e);
    }

    router.push(`/essay/structure/${fresh.id}/target`);
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
        <h1 className="text-3xl font-bold text-gray-800 mb-3">整理して書く</h1>
        <p className="text-gray-600 text-sm leading-relaxed">
          志望校・テーマ・思考整理を順番に進めて、自分の言葉で書き始めます。
        </p>
        <p className="text-gray-500 text-xs mt-1">
          ※ AI は質問を投げかけるだけ。代わりに本文を書きません。
        </p>
      </div>

      <div className="mb-10 text-center">
        <button
          type="button"
          onClick={handleStartNew}
          className={`${BUTTON_BASE} ${BUTTON_VARIANT.primary} ${BUTTON_SIZE.md}`}
        >
          整理して書き始める →
        </button>
      </div>

      {/* 途中の小論文一覧 */}
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

// 進行中 workspace 1 件分のカード。view only、click で resume path へ。
function InProgressCard({ workspace }: { workspace: EssayWorkspace }) {
  const step = getStructureResumeStep(workspace);
  const stepLabel = getStructureStepLabel(step);
  const resumePath = getStructureResumePath(workspace);
  const progress = getStructureProgress(workspace);
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
