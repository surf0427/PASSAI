// /essay/write/[wid]/body page（Phase 2 STEP O 新規）。
//
// write フローの本文ページ。左カラムは theme + target のみ（mini / sparring はない）。
// 右カラムは EssayBodyEditor を使う。
//
// 添削成功時の更新順（structure/body と同型）:
//   1. /api/essay-review fetch (cache hit or API call)
//   2. parse OK で appendInitialReview
//   3. upsertEssayWorkspace
//   4. router.push(`/essay/result/${wid}`)
//
// dual-write しない（Phase 2 設計レビュー §7 準拠）。

'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  loadEssayWorkspace,
  upsertEssayWorkspace,
} from '@/lib/essayWorkspaceStorage';
import {
  appendInitialReview,
  updateBody,
} from '@/lib/essay/workspaceOps';
import {
  loadEssayReviewCache,
  saveEssayReviewCache,
} from '@/lib/essayReviewCache';
import {
  ESSAY_REVIEW_MODEL,
  ESSAY_REVIEW_PROMPT_VERSION,
  hashEssayReviewInput,
} from '@/lib/aiInputHash';
import { logAiCache } from '@/lib/aiCacheLog';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { buildBasicInfoForAi } from '@/lib/essay/buildBasicInfoForAi';
import { EssayBodyEditor } from '@/app/essay/components/EssayBodyEditor';
import type { BasicInfo } from '@/types/basicInfo';
import type { ReviewResult } from '@/lib/essayPracticeStorage';
import type { EssayWorkspace } from '@/types/essay';

const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function EssayWriteBodyPage() {
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

  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');

  if (!isMounted) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-sm text-gray-500">読み込み中…</div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <GuardScreen
        backHref="/essay/write"
        backLabel="← いきなり書く トップへ"
        title="見つかりませんでした"
        body="指定された下書きは存在しないか、保存件数の上限を超えて退役した可能性があります。"
      />
    );
  }

  if (workspace.reviews.length > 0) {
    return (
      <GuardScreen
        backHref={`/essay/result/${wid}`}
        backLabel="← 結果ページへ"
        title="この小論文はすでに添削済みです"
        body="改善する場合は結果ページから「改善する」を選んでください。"
      />
    );
  }

  if (!workspace.theme.text.trim()) {
    return (
      <GuardScreen
        backHref={`/essay/write/${wid}/theme`}
        backLabel="← テーマ選択へ"
        title="先にテーマを選んでください"
        body="本文はテーマに対する回答です。テーマを選んでから戻ってきてください。"
      />
    );
  }

  // ─── derived ───────────────────────────────────────────────────────

  const themeText = workspace.theme.text;
  const targetLabel =
    [workspace.target.university, workspace.target.faculty]
      .filter((s) => s.trim() !== '')
      .join(' / ') || '志望校未設定';

  // ─── handlers ──────────────────────────────────────────────────────

  function handleBodyChange(value: string) {
    if (!workspace) return;
    const updated = updateBody(workspace, value);
    try {
      upsertEssayWorkspace(updated);
    } catch (e) {
      console.warn('[essay STEP O] write body autosave failed', e);
    }
    setWorkspace(updated);
  }

  async function handleSubmitReview() {
    if (!workspace) return;
    const body = workspace.body;

    if (!body.trim()) {
      setReviewError('本文を入力してください');
      return;
    }
    setReviewError('');

    const baseInfo = loadBasicInfo();
    const basicInfoForAi: BasicInfo | null = buildBasicInfoForAi(
      baseInfo,
      workspace.target,
    );

    const inputHash = hashEssayReviewInput({
      theme: themeText,
      themeType: workspace.theme.type,
      // mini は write フローでは存在しないので空文字で hash 化（key 安定のため省略しない）。
      conclusion: workspace.mini.conclusion,
      reasonOne: workspace.mini.reasonOne,
      reasonTwo: workspace.mini.reasonTwo,
      essayBody: body,
      basicInfo: basicInfoForAi,
      model: ESSAY_REVIEW_MODEL,
      promptVersion: ESSAY_REVIEW_PROMPT_VERSION,
    });

    const cached = loadEssayReviewCache();
    if (
      cached &&
      cached.inputHash === inputHash &&
      cached.model === ESSAY_REVIEW_MODEL &&
      cached.promptVersion === ESSAY_REVIEW_PROMPT_VERSION
    ) {
      logAiCache({ route: 'api/essay-review', action: 'hit', inputHash });
      finalizeReview(cached.review, body);
      return;
    }
    logAiCache({ route: 'api/essay-review', action: 'miss', inputHash });

    setReviewLoading(true);
    try {
      const res = await fetch('/api/essay-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: themeText,
          themeType: workspace.theme.type,
          conclusion: workspace.mini.conclusion,
          reasonOne: workspace.mini.reasonOne,
          reasonTwo: workspace.mini.reasonTwo,
          essayBody: body,
          basicInfo: basicInfoForAi,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setReviewError(
          data.message ??
            data.error ??
            'AIの処理に失敗しました。時間をおいてお試しください。',
        );
        // API 失敗時は reviews push しない（workspace 不変、retry 可能）。
        return;
      }

      const reviewResult = data as ReviewResult;
      finalizeReview(reviewResult, body);

      try {
        saveEssayReviewCache({
          inputHash,
          model: ESSAY_REVIEW_MODEL,
          promptVersion: ESSAY_REVIEW_PROMPT_VERSION,
          savedAt: new Date().toISOString(),
          review: reviewResult,
        });
      } catch (e) {
        console.warn('[essay STEP O] write cache save failed', e);
      }
    } catch {
      setReviewError(
        '通信エラーが発生しました。インターネット接続を確認してください。',
      );
    } finally {
      setReviewLoading(false);
    }
  }

  function finalizeReview(reviewResult: ReviewResult, body: string) {
    if (!workspace) return;
    const updated = appendInitialReview(workspace, reviewResult, body);
    try {
      upsertEssayWorkspace(updated);
    } catch (e) {
      console.warn('[essay STEP O] write workspace save after review failed', e);
    }
    setWorkspace(updated);
    router.push(`/essay/result/${wid}`);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/essay/write/${wid}/theme`}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← テーマ選択に戻る
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2 leading-snug">
          本文を書く
        </h1>
        <p className="text-xs text-gray-500">
          テーマに対して、自分の言葉で本文を書いてください。
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 左カラム: theme + target のみ（mini / sparring なし） */}
        <div className="space-y-4">
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-600 mb-1">テーマ</p>
            <p className="text-sm text-gray-800 leading-relaxed mb-3">
              {themeText}
            </p>
            <p className="text-xs text-gray-500">{targetLabel}</p>
          </section>
        </div>

        {/* 右カラム: EssayBodyEditor */}
        <div>
          <EssayBodyEditor
            body={workspace.body}
            onChange={handleBodyChange}
            onSubmit={handleSubmitReview}
            loading={reviewLoading}
            error={reviewError}
            submitLabel="添削する"
            hint="テーマに対して、自分の言葉で本文を書いてください。"
          />
        </div>
      </div>
    </div>
  );
}

function GuardScreen({
  backHref,
  backLabel,
  title,
  body,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  body: string;
}) {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href={backHref}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          {backLabel}
        </Link>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-800 mb-2">{title}</h1>
        <p className="text-sm text-gray-600">{body}</p>
      </div>
    </div>
  );
}
