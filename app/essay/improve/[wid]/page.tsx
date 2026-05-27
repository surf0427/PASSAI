// 小論文 改善点選択 hub（STEP D 新規、責務分離 UX 修正で更新）。
//
// 役割:
//   workspace.reviews.at(-1)（最新の添削結果）から改善点を取り出し、
//   ユーザーが「どの改善点に取り組むか」を選ぶ画面。
//
// UX 修正後の方針（責務分離）:
//   - 同じ workspace 内で改善点 A → B → C を移動しても conflict にしない
//   - 各改善点の回答状態（✓ 回答済み / 未対応）を card に表示
//   - 「改善まとめを作成」CTA は **この hub の最下部に集約**
//     （個別の deep page には置かない）
//   - summary 生成後は「書き直しに進む」CTA を出して /rewrite へ誘導
//
// 表示構造:
//   - primary  : review.improvement を「最重要の改善点」として大きく表示
//   - secondary: review.weakPoints[0] を「次に改善すると良い点」として表示
//   - collapsed: review.weakPoints[1..] は <Accordion> で折りたたみ
//
// issueId 規約:
//   - review.improvement     → 'r{latestReviewIndex}-improvement'
//   - review.weakPoints[i]   → 'r{latestReviewIndex}-w{i}'

'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  loadEssayWorkspace,
  upsertEssayWorkspace,
} from '@/lib/essayWorkspaceStorage';
import { attachImprovementSummary } from '@/lib/essay/workspaceOps';
import {
  ESSAY_IMPROVE_SUMMARY_MODEL,
  ESSAY_IMPROVE_SUMMARY_PROMPT_VERSION,
  hashEssayImproveSummaryInput,
} from '@/lib/aiInputHash';
import {
  loadEssayImproveSummaryCache,
  saveEssayImproveSummaryCache,
} from '@/lib/essay/improveSummaryCache';
import { logAiCache } from '@/lib/aiCacheLog';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { DEEP_DIVE_TEMPLATE_VERSION } from '@/lib/essay/deepDiveQuestions';
import { Accordion } from '@/components/ui/Accordion';
import { EssayIssueCard } from '@/app/essay/components/EssayIssueCard';
import {
  BUTTON_BASE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
} from '@/components/ui/buttonStyles';
import type {
  EssayWorkspace,
  ImprovementSummary,
  ImprovementWork,
} from '@/types/essay';

// SSR-stable mount flag。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// 1 つの work が「回答済み」と見做せるか: answers のいずれかが non-empty。
function isWorkAnswered(work: ImprovementWork | undefined): boolean {
  if (!work) return false;
  return work.answers.some((a) => a.trim() !== '');
}

export default function EssayImproveHubPage() {
  const params = useParams<{ wid: string }>();
  const router = useRouter();
  const wid = params?.wid ?? '';

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  const mountedWorkspace = useMemo<EssayWorkspace | null>(
    () => (isMounted && wid ? loadEssayWorkspace(wid) : null),
    [isMounted, wid],
  );
  const [postUserWorkspace, setWorkspace] = useState<EssayWorkspace | null>(null);
  const workspace: EssayWorkspace | null = postUserWorkspace ?? mountedWorkspace;

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string>('');

  // pre-mount: 読み込み中。
  if (!isMounted) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-sm text-gray-500">読み込み中…</div>
      </div>
    );
  }

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

  const latestReviewIndex = workspace.reviews.length - 1;
  const latestReview = workspace.reviews.at(-1) ?? null;

  if (!latestReview) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="mb-6">
          <Link
            href={`/essay/result/${wid}`}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            ← 詳細に戻る
          </Link>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-600">改善できる添削結果がありません。</p>
        </div>
      </div>
    );
  }

  // ─── derived ────────────────────────────────────────────────────────

  const themeText = workspace.theme.text || 'テーマ未設定';
  const targetLabel =
    [workspace.target.university, workspace.target.faculty]
      .filter((s) => s.trim() !== '')
      .join(' / ') || '志望校未設定';

  const improvementIssueId = `r${latestReviewIndex}-improvement`;
  const weakPointIssueId = (i: number) => `r${latestReviewIndex}-w${i}`;
  const hrefFor = (issueId: string) =>
    `/essay/improve/${wid}/deep/${issueId}`;

  const primaryWeakPoint = latestReview.weakPoints[0] ?? null;
  const otherWeakPoints = latestReview.weakPoints.slice(1);

  // 回答済み判定: improvementInProgress.works[issueId] が存在 & non-empty answer あり。
  const works = workspace.improvementInProgress?.works ?? {};
  const answeredWorks = Object.values(works).filter(isWorkAnswered);
  const answeredCount = answeredWorks.length;
  const currentSummary: ImprovementSummary | null =
    workspace.improvementInProgress?.summary ?? null;

  // ─── summary 生成 handler ──────────────────────────────────────────

  async function handleGenerateSummary() {
    if (!workspace) return;
    setSummaryError('');

    const session = workspace.improvementInProgress;
    if (!session) {
      setSummaryError('回答済みの改善点がありません。先に深掘りに回答してください。');
      return;
    }
    const targetWorks = Object.values(session.works).filter(isWorkAnswered);
    if (targetWorks.length === 0) {
      setSummaryError('回答済みの改善点がありません。先に深掘りに回答してください。');
      return;
    }

    // API payload (multi-issue 契約)
    const worksPayload = targetWorks.map((w) => ({
      issueText: w.issueText,
      axis: w.axis,
      deepQuestions: w.deepQuestions,
      answers: w.answers,
    }));

    const basicInfoForAi = loadBasicInfo();
    const themeTextNow = workspace.theme.text;
    const miniSnapshot = workspace.mini;
    const essayBodySnapshot = workspace.body;

    const inputHash = hashEssayImproveSummaryInput({
      works: worksPayload,
      essayBodySnapshot,
      themeText: themeTextNow,
      mini: miniSnapshot,
      basicInfo: basicInfoForAi,
      templateVersion: DEEP_DIVE_TEMPLATE_VERSION,
      model: ESSAY_IMPROVE_SUMMARY_MODEL,
      promptVersion: ESSAY_IMPROVE_SUMMARY_PROMPT_VERSION,
    });

    const cached = loadEssayImproveSummaryCache();
    if (
      cached &&
      cached.inputHash === inputHash &&
      cached.model === ESSAY_IMPROVE_SUMMARY_MODEL &&
      cached.promptVersion === ESSAY_IMPROVE_SUMMARY_PROMPT_VERSION
    ) {
      logAiCache({
        route: 'api/essay-improve-summary',
        action: 'hit',
        inputHash,
      });
      const attached = attachImprovementSummary(workspace, cached.summary);
      try {
        upsertEssayWorkspace(attached);
      } catch (e) {
        console.warn('[essay UX修正] summary cache hit save failed', e);
      }
      setWorkspace(attached);
      return;
    }
    logAiCache({ route: 'api/essay-improve-summary', action: 'miss', inputHash });

    setSummaryLoading(true);
    try {
      const res = await fetch('/api/essay-improve-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          works: worksPayload,
          currentEssayBody: essayBodySnapshot,
          theme: themeTextNow,
          mini: miniSnapshot,
          basicInfo: basicInfoForAi,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSummaryError(
          data.message ??
            data.error ??
            'AIの処理に失敗しました。時間をおいてお試しください。',
        );
        return;
      }

      const summary = data as ImprovementSummary;
      const attached = attachImprovementSummary(workspace, summary);
      try {
        upsertEssayWorkspace(attached);
      } catch (e) {
        console.warn('[essay UX修正] summary attach save failed', e);
      }
      setWorkspace(attached);

      try {
        saveEssayImproveSummaryCache({
          inputHash,
          model: ESSAY_IMPROVE_SUMMARY_MODEL,
          promptVersion: ESSAY_IMPROVE_SUMMARY_PROMPT_VERSION,
          savedAt: new Date().toISOString(),
          summary,
        });
      } catch (e) {
        console.warn('[essay UX修正] summary cache save failed', e);
      }
    } catch {
      setSummaryError(
        '通信エラーが発生しました。インターネット接続を確認してください。',
      );
    } finally {
      setSummaryLoading(false);
    }
  }

  function handleGoToRewrite() {
    router.push(`/essay/improve/${wid}/rewrite`);
  }

  // ─── render ────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/essay/result/${wid}`}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← 詳細に戻る
        </Link>
      </div>

      {/* ヘッダ */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-3 leading-snug">
          改善したいポイントを選びましょう
        </h1>
        <p className="text-xs text-gray-500 mb-1">{themeText}</p>
        <p className="text-xs text-gray-500">
          {targetLabel} · 最新スコア {latestReview.totalScore} 点 ·
          回答済み {answeredCount} 件
        </p>
      </div>

      {/* primary: improvement */}
      {latestReview.improvement && (
        <div className="mb-4">
          <EssayIssueCard
            variant="primary"
            badge="最重要の改善点"
            issueText={latestReview.improvement}
            href={hrefFor(improvementIssueId)}
            isAnswered={isWorkAnswered(works[improvementIssueId])}
          />
        </div>
      )}

      {/* secondary: weakPoints[0] */}
      {primaryWeakPoint && (
        <div className="mb-4">
          <EssayIssueCard
            variant="secondary"
            badge="次に改善すると良い点"
            issueText={primaryWeakPoint}
            href={hrefFor(weakPointIssueId(0))}
            isAnswered={isWorkAnswered(works[weakPointIssueId(0)])}
          />
        </div>
      )}

      {/* collapsed: weakPoints[1..] */}
      {otherWeakPoints.length > 0 && (
        <div className="mb-4">
          <Accordion title={`他の改善点（${otherWeakPoints.length} 件）`}>
            <div className="space-y-3 px-5 py-4">
              {otherWeakPoints.map((text, i) => {
                const id = weakPointIssueId(i + 1);
                return (
                  <EssayIssueCard
                    key={id}
                    variant="secondary"
                    issueText={text}
                    href={hrefFor(id)}
                    isAnswered={isWorkAnswered(works[id])}
                  />
                );
              })}
            </div>
          </Accordion>
        </div>
      )}

      {!latestReview.improvement &&
        !primaryWeakPoint &&
        otherWeakPoints.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
            <p className="text-sm text-gray-600">
              改善点が見つかりませんでした。新しい添削を行ってください。
            </p>
          </div>
        )}

      <p className="mt-8 text-xs text-gray-400 text-center">
        ※ 取り組みたい改善点を選んで深掘りに回答してください。一覧に戻ってきて別の改善点を進めることもできます。
      </p>

      {/* 改善まとめ生成 CTA（ページ最下部に集約） */}
      <section className="mt-10 border-t border-gray-200 pt-6">
        {currentSummary && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
            <p className="text-xs font-semibold text-blue-700 mb-2">
              現在の AI 改善方針（{answeredCount} 件の改善点から統合）
            </p>
            <p className="text-sm text-gray-800 leading-relaxed">
              {currentSummary.summary}
            </p>
          </div>
        )}

        <div className="text-center">
          <button
            type="button"
            onClick={handleGenerateSummary}
            disabled={summaryLoading || answeredCount === 0}
            className={`${BUTTON_BASE} ${BUTTON_VARIANT.primary} ${BUTTON_SIZE.md}`}
            title={
              answeredCount === 0
                ? '改善点に回答してから利用できます'
                : undefined
            }
          >
            {summaryLoading
              ? '生成中…'
              : currentSummary
                ? '改善まとめを作り直す'
                : '改善まとめを作成する'}
          </button>
          {answeredCount === 0 && (
            <p className="mt-2 text-xs text-gray-400">
              ※ 改善点に 1 つ以上回答すると有効になります。
            </p>
          )}
          {summaryError && (
            <p className="mt-3 text-xs text-red-600">{summaryError}</p>
          )}
        </div>

        {currentSummary && (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={handleGoToRewrite}
              className={`${BUTTON_BASE} ${BUTTON_VARIANT.primary} ${BUTTON_SIZE.md}`}
            >
              改善内容を踏まえて書き直す →
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
