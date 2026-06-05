// /essay/structure/[wid]/body page（Phase 2 STEP N 新規）。
//
// 2 カラム構成:
//   左カラム（read only 参照）: テーマ + ミニ思考欄 + sparring Q&A snapshot
//   右カラム（編集）: 本文 textarea + 添削 CTA
//
// 責務分離（重要、コメントで明示）:
//   - updateBody()          : 作業中本文の autosave
//   - appendInitialReview() : 添削成功時の正式 review append（初回 review）
//   - submitRewriteReview() : Phase 1 改善後 review append（このページでは呼ばない）
//   この 3 つを混ぜないこと。本ページは updateBody + appendInitialReview だけ使う。
//
// 添削成功時の更新順:
//   1. /api/essay-review fetch (cache hit or API call)
//   2. ReviewResult parse OK
//   3. appendInitialReview(ws, review, body) → reviews.push + body = body + I7 適用
//   4. upsertEssayWorkspace
//   5. saveEssayReviewCache (best-effort)
//   6. router.push(`/essay/result/${wid}`)
//
//   API 失敗時は何もせず error UI を出すだけ（reviews push しない）。
//
// dual-write しない（Phase 2 設計レビュー §7 で確定）:
//   essayPracticeReview への legacy 保存は /essay-practice 経由でのみ。Phase 2 経路は
//   essayWorkspaces 単独書き込み。

'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuotaDialog } from '@/components/billing/QuotaExceededDialog';
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

// SSR-stable mount flag。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function EssayStructureBodyPage() {
  // STEP-BILLING-07A: 402 quota-exceeded ハンドラ。
  const { handleResponse: handleQuotaResponse, dialog: quotaDialog } =
    useQuotaDialog();

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

  // ─── pre-mount / guards ────────────────────────────────────────────

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
        backHref="/essay/structure"
        backLabel="← 整理して書く トップへ"
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
        body="整理フローはまだ書いていない小論文のためのものです。改善する場合は結果ページから「改善する」を選んでください。"
      />
    );
  }

  if (!workspace.theme.text.trim()) {
    return (
      <GuardScreen
        backHref={`/essay/structure/${wid}/theme`}
        backLabel="← テーマ選択へ"
        title="先にテーマを選んでください"
        body="本文はテーマに対する回答です。テーマを選んでから戻ってきてください。"
      />
    );
  }

  const hasMini =
    workspace.mini.conclusion.trim() !== '' ||
    workspace.mini.reasonOne.trim() !== '' ||
    workspace.mini.reasonTwo.trim() !== '';
  if (!hasMini) {
    return (
      <GuardScreen
        backHref={`/essay/structure/${wid}/mini`}
        backLabel="← ミニ思考欄へ"
        title="先にミニ思考欄を埋めてください"
        body="本文を書く前に、結論と理由を整理しておきましょう。"
      />
    );
  }

  if (workspace.sparring === null) {
    return (
      <GuardScreen
        backHref={`/essay/structure/${wid}/sparring`}
        backLabel="← AI壁打ちへ"
        title="先にAI壁打ちを終えてください"
        body="壁打ち質問への回答が本文を書くときの素材になります。"
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

  // body の autosave。**updateBody のみ**を使う。appendInitialReview は使わない。
  // 責務: 「作業中本文の保存」のみ。reviews には触らない。
  function handleBodyChange(value: string) {
    if (!workspace) return;
    const updated = updateBody(workspace, value);
    try {
      upsertEssayWorkspace(updated);
    } catch (e) {
      // best-effort: autosave 失敗時もタイプは継続できる（次の onChange で再試行）。
      console.warn('[essay STEP N] body autosave failed', e);
    }
    setWorkspace(updated);
  }

  // 添削 CTA. API 成功後にだけ appendInitialReview を呼ぶ。
  async function handleSubmitReview() {
    if (!workspace) return;
    const body = workspace.body;

    if (!body.trim()) {
      setReviewError('本文を入力してください');
      return;
    }
    setReviewError('');

    // basicInfo を workspace.target で上書きして AI に渡す。
    // /essay-practice / Phase 1 rewrite と同パターン（inline、STEP P で extract 検討）。
    const baseInfo = loadBasicInfo();
    const basicInfoForAi: BasicInfo | null = buildBasicInfoForAi(
      baseInfo,
      workspace.target,
    );

    const inputHash = hashEssayReviewInput({
      theme: themeText,
      themeType: workspace.theme.type,
      conclusion: workspace.mini.conclusion,
      reasonOne: workspace.mini.reasonOne,
      reasonTwo: workspace.mini.reasonTwo,
      essayBody: body,
      basicInfo: basicInfoForAi,
      model: ESSAY_REVIEW_MODEL,
      promptVersion: ESSAY_REVIEW_PROMPT_VERSION,
    });

    // cache hit 経路。AI を呼ばず workspace mutation を進める。
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

    // cache miss: AI を呼ぶ。失敗時は workspace 触らない（rollback safety）。
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

      // STEP-BILLING-07A: 402 quota-exceeded はダイアログに委譲して早期 return。
      if (await handleQuotaResponse(res)) {
        return;
      }

      const data = await res.json();

      if (!res.ok) {
        setReviewError(
          data.message ??
            data.error ??
            'AIの処理に失敗しました。時間をおいてお試しください。',
        );
        // ★ API 失敗時に reviews push しない。workspace 不変。retry 可能。
        return;
      }

      const reviewResult = data as ReviewResult;
      finalizeReview(reviewResult, body);

      // cache 保存（best-effort）
      try {
        saveEssayReviewCache({
          inputHash,
          model: ESSAY_REVIEW_MODEL,
          promptVersion: ESSAY_REVIEW_PROMPT_VERSION,
          savedAt: new Date().toISOString(),
          review: reviewResult,
        });
      } catch (e) {
        console.warn('[essay STEP N] cache save failed', e);
      }
    } catch {
      setReviewError(
        '通信エラーが発生しました。インターネット接続を確認してください。',
      );
      // ★ catch でも reviews push しない。
    } finally {
      setReviewLoading(false);
    }
  }

  // 添削成功後の集中処理。API 成功 / cache hit 後にだけ呼ぶ。
  function finalizeReview(reviewResult: ReviewResult, body: string) {
    if (!workspace) return;
    const updated = appendInitialReview(workspace, reviewResult, body);
    try {
      upsertEssayWorkspace(updated);
    } catch (e) {
      console.warn('[essay STEP N] workspace save after review failed', e);
    }
    setWorkspace(updated);
    router.push(`/essay/result/${wid}`);
  }

  // ─── render ────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/essay/structure/${wid}/sparring`}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← AI壁打ちに戻る
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2 leading-snug">
          本文を書く
        </h1>
        <p className="text-xs text-gray-500">
          左の参照素材を見ながら、自分の言葉で書いてください。
          ※ AI は質問を出すだけ。本文は書きません。
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 左カラム: 参照素材（read only） */}
        <div className="space-y-4">
          {/* テーマ + 大学情報 */}
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-600 mb-1">テーマ</p>
            <p className="text-sm text-gray-800 leading-relaxed mb-3">
              {themeText}
            </p>
            <p className="text-xs text-gray-500">{targetLabel}</p>
          </section>

          {/* ミニ思考欄 */}
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-600 mb-2">
              ミニ思考欄
            </p>
            <div className="space-y-1 text-sm text-gray-800">
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

          {/* sparring Q&A snapshot */}
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-600 mb-3">
              AI壁打ち Q&amp;A
            </p>
            <div className="space-y-3">
              {workspace.sparring.questions.map((q, i) => {
                const a = workspace.sparring?.answers[i]?.trim() ?? '';
                return (
                  <div key={i}>
                    <p className="text-xs text-gray-500 mb-1">
                      Q{i + 1}. {q}
                    </p>
                    <p className="text-sm text-gray-800 leading-relaxed">
                      {a || (
                        <span className="text-gray-400">（未回答）</span>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* 右カラム: EssayBodyEditor （Phase 2 STEP O で primitive 化） */}
        <div>
          <EssayBodyEditor
            body={workspace.body}
            onChange={handleBodyChange}
            onSubmit={handleSubmitReview}
            loading={reviewLoading}
            error={reviewError}
            submitLabel="添削する"
            hint="左の参照素材を見ながら、自分の言葉で書いてください。"
            placeholder="左の参照素材を見ながら、ここに本文を書いてください"
          />
        </div>
      </div>

      {/* STEP-BILLING-07A: 402 quota-exceeded ダイアログ。 */}
      {quotaDialog}
    </div>
  );
}

// 表示専用 sub-component。
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
