// 書き直し本文ページ（essay STEP G 新規）。
//
// 表示構造:
//   - 左カラム（参照素材、read only）:
//       テーマ + 大学情報 / 取り組む改善点 / 深掘り Q&A / AI 改善方針 / 元本文
//   - 右カラム（編集可能）:
//       書き直し textarea + 再添削 CTA + エラー
//
// textarea 初期値:
//   improvementInProgress.rewriteDraft ?? workspace.body （元本文コピー）
//   AI summary は absolutely 初期値にしない（ai_policy 厳守）。
//
// 再添削成功時のデータ更新順:
//   1. /api/essay-review を呼ぶ（既存 route 流用、contract 不変）
//   2. parse 成功で submitRewriteReview を呼ぶ（reviews.push + body 更新 + improvementInProgress = null
//      を atomic に行う）
//   3. upsertEssayWorkspace で保存
//   4. essayReviewInputHash cache 保存（best-effort）
//   5. /essay/improve/[wid]/compare へ遷移（STEP H で実装、現状 404 でも前進フロー）
//
// 失敗時:
//   - workspace は触らない（rollback safety）
//   - rewriteDraft は autosave 済みなので残る
//   - エラー表示してボタンで retry 可能
//
// guard:
//   - workspace 不在 / improvementInProgress 不在 / summary 不在 / sourceReview 不在
//     のいずれも crash せず、戻り導線つきの GuardScreen を返す。

'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  loadEssayWorkspace,
  upsertEssayWorkspace,
} from '@/lib/essayWorkspaceStorage';
import {
  submitRewriteReview,
  updateRewriteDraft,
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
import { Textarea } from '@/components/ui/Textarea';
import {
  BUTTON_BASE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
} from '@/components/ui/buttonStyles';
import type { BasicInfo } from '@/types/basicInfo';
import type { ReviewResult } from '@/lib/essayPracticeStorage';
import type { EssayWorkspace } from '@/types/essay';

// SSR-stable mount flag。既存ページと同形パターン。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function EssayRewritePage() {
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

  // ─── pre-mount / guard ──────────────────────────────────────────────

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
        backHref="/essay/results"
        backLabel="← 一覧に戻る"
        title="見つかりませんでした"
        body="指定された結果は存在しないか、保存件数の上限を超えて退役した可能性があります。"
      />
    );
  }

  const inProgress = workspace.improvementInProgress;
  if (!inProgress) {
    return (
      <GuardScreen
        backHref={`/essay/improve/${wid}`}
        backLabel="← 改善点選択に戻る"
        title="改善ワークが見つかりません"
        body="先に改善点を選んで深掘り質問に答えてください。"
      />
    );
  }

  if (!inProgress.summary) {
    return (
      <GuardScreen
        backHref={`/essay/improve/${wid}`}
        backLabel="← 改善点一覧に戻る"
        title="AI 改善方針が未生成です"
        body="先に改善点一覧で「改善まとめを作成する」を実行してください。"
      />
    );
  }

  // UX 修正: works は複数 issue を集約。各 work の sourceReviewIndex は同一の最新 review
  // を指している前提（hub から flow するため）。validity は normalize で担保済み。
  const workEntries = Object.values(inProgress.works);
  if (workEntries.length === 0) {
    return (
      <GuardScreen
        backHref={`/essay/improve/${wid}`}
        backLabel="← 改善点一覧に戻る"
        title="改善ワークが見つかりません"
        body="先に改善点に取り組んでから書き直しに進んでください。"
      />
    );
  }

  // ─── derived ───────────────────────────────────────────────────────

  const themeText = workspace.theme.text || 'テーマ未設定';
  const targetLabel =
    [workspace.target.university, workspace.target.faculty]
      .filter((s) => s.trim() !== '')
      .join(' / ') || '志望校未設定';

  const originalBody = workspace.body;
  // textarea 初期値 = rewriteDraft ?? 元本文。AI summary は絶対に使わない（ai_policy）。
  const draftValue = inProgress.rewriteDraft ?? originalBody;

  // ─── handlers ──────────────────────────────────────────────────────

  function handleDraftChange(value: string) {
    if (!workspace) return;
    if (!workspace.improvementInProgress) return;
    const updated = updateRewriteDraft(workspace, value);
    try {
      upsertEssayWorkspace(updated);
    } catch (e) {
      // best-effort: autosave 失敗時もタイプは継続できる。次の onChange で再試行。
      console.warn('[essay STEP G] rewriteDraft autosave failed', e);
    }
    setWorkspace(updated);
  }

  async function handleSubmitReview() {
    if (!workspace) return;
    if (!workspace.improvementInProgress) return;

    // 提出本文は「現在 textarea に表示されている値」= draftValue。
    // rewriteDraft が null（未編集）でも draftValue は originalBody を指すので
    // submit 前に updateRewriteDraft を通して invariant を満たす。
    const submitBody = (workspace.improvementInProgress.rewriteDraft ??
      originalBody) as string;
    if (!submitBody.trim()) {
      setReviewError('本文を入力してください');
      return;
    }
    setReviewError('');

    // basicInfo を target で上書きして AI に渡す（既存 /essay-practice と同パターン）。
    const baseInfo = loadBasicInfo();
    const basicInfoForAi: BasicInfo | null = buildBasicInfoForAi(
      baseInfo,
      workspace.target,
    );

    // 既存 /api/essay-review の cache 入力と完全に揃える（同 body なら hit する）。
    const inputHash = hashEssayReviewInput({
      theme: themeText,
      themeType: workspace.theme.type,
      conclusion: workspace.mini.conclusion,
      reasonOne: workspace.mini.reasonOne,
      reasonTwo: workspace.mini.reasonTwo,
      essayBody: submitBody,
      basicInfo: basicInfoForAi,
      model: ESSAY_REVIEW_MODEL,
      promptVersion: ESSAY_REVIEW_PROMPT_VERSION,
    });

    // cache hit 経路。AI を呼ばずに workspace mutation を進める。
    const cached = loadEssayReviewCache();
    if (
      cached &&
      cached.inputHash === inputHash &&
      cached.model === ESSAY_REVIEW_MODEL &&
      cached.promptVersion === ESSAY_REVIEW_PROMPT_VERSION
    ) {
      logAiCache({ route: 'api/essay-review', action: 'hit', inputHash });
      finalizeReview(cached.review, submitBody);
      return;
    }
    logAiCache({ route: 'api/essay-review', action: 'miss', inputHash });

    // cache miss: AI を呼ぶ。失敗時は workspace を触らない（rollback safety）。
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
          essayBody: submitBody,
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
        return;
      }

      const reviewResult = data as ReviewResult;
      finalizeReview(reviewResult, submitBody);

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
        console.warn('[essay STEP G] cache save failed', e);
      }
    } catch {
      setReviewError('通信エラーが発生しました。インターネット接続を確認してください。');
    } finally {
      setReviewLoading(false);
    }
  }

  // submitRewriteReview は **API 成功後だけ** 呼ぶ。
  // この関数内で workspace の mutation と navigation を集中させる（誤呼び出し防止）。
  function finalizeReview(reviewResult: ReviewResult, submitBody: string) {
    if (!workspace) return;
    const inProgressNow = workspace.improvementInProgress;
    if (!inProgressNow) return;

    // rewriteDraft が null（未編集での submit）の場合は先に揃える。
    // 揃えてから submitRewriteReview に渡すことで guard を満たす。
    let ws = workspace;
    if (inProgressNow.rewriteDraft === null) {
      ws = updateRewriteDraft(ws, submitBody);
    }

    let updated: EssayWorkspace;
    try {
      updated = submitRewriteReview(ws, reviewResult);
    } catch (e) {
      // submitRewriteReview は guard 違反でのみ throw する。
      // 上の前処理で全 guard を満たすので通常は到達しない。
      // 想定外の異常時に UX を壊さないため握って error 表示に倒す。
      console.error('[essay STEP G] submitRewriteReview threw', e);
      setReviewError('再添削の結果保存に失敗しました。ページを再読み込みしてやり直してください。');
      return;
    }

    try {
      upsertEssayWorkspace(updated);
    } catch (e) {
      console.warn('[essay STEP G] workspace save after submit failed', e);
    }
    setWorkspace(updated);

    router.push(`/essay/improve/${wid}/compare`);
  }

  // ─── render ────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/essay/improve/${wid}`}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← 改善点一覧に戻る
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2 leading-snug">
          改善内容を踏まえて書き直す
        </h1>
        <p className="text-xs text-gray-500">
          左の参照素材を見ながら、自分の言葉で書き直してください。
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

          {/* 取り組む改善点（複数 works を集約表示） */}
          <section className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-blue-700 mb-3">
              取り組む改善点（{workEntries.length} 件）
            </p>
            <div className="space-y-3">
              {workEntries.map((work) => (
                <div
                  key={work.issueId}
                  className="bg-white/60 border border-blue-100 rounded-lg p-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-blue-700">
                      {work.issueId}
                    </span>
                    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-600 text-white">
                      {work.axis}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 leading-relaxed">
                    {work.issueText}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* 深掘り Q&A snapshot（全 works を順に表示） */}
          {workEntries.some((w) => w.deepQuestions.length > 0) && (
            <section className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-600 mb-3">
                深掘り Q&amp;A（{workEntries.length} 件分）
              </p>
              <div className="space-y-4">
                {workEntries.map((work) => (
                  <div key={work.issueId}>
                    <p className="text-[10px] font-semibold text-gray-500 mb-2">
                      {work.issueText}
                    </p>
                    <div className="space-y-2">
                      {work.deepQuestions.map((q, i) => {
                        const a = work.answers[i]?.trim() ?? '';
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
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* AI 改善方針（textarea 初期値には絶対に入れない） */}
          <section className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-blue-700 mb-3">
              AI 改善方針
            </p>
            <p className="text-sm text-gray-800 leading-relaxed mb-3">
              {inProgress.summary.summary}
            </p>
            {inProgress.summary.focusPoints.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-600 mb-1">
                  強化すべきポイント
                </p>
                <ul className="space-y-1">
                  {inProgress.summary.focusPoints.map((p, i) => (
                    <li
                      key={i}
                      className="text-sm text-gray-800 leading-relaxed"
                    >
                      ・{p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {inProgress.summary.suggestedDirections.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">
                  書き直しの方向性
                </p>
                <ul className="space-y-1">
                  {inProgress.summary.suggestedDirections.map((p, i) => (
                    <li
                      key={i}
                      className="text-sm text-gray-800 leading-relaxed"
                    >
                      ・{p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* 元本文（read only 参照） */}
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-600 mb-2">元本文</p>
            {originalBody.trim() ? (
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {originalBody}
              </p>
            ) : (
              <p className="text-sm text-gray-500 italic">
                元本文は保存されていません。
              </p>
            )}
          </section>
        </div>

        {/* 右カラム: 書き直し textarea + CTA */}
        <div>
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-600 mb-2">
              書き直し本文
            </p>
            <p className="text-xs text-gray-500 mb-3">
              ※ 元本文がコピーされています。改善方針を踏まえて自分の言葉で書き直してください。
            </p>
            <Textarea
              value={draftValue}
              onChange={(e) => handleDraftChange(e.target.value)}
              rows={20}
              placeholder="改善方針を踏まえて、自分の言葉で本文を書き直してください"
            />
          </section>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={handleSubmitReview}
              disabled={reviewLoading}
              className={`${BUTTON_BASE} ${BUTTON_VARIANT.primary} ${BUTTON_SIZE.md}`}
            >
              {reviewLoading ? '再添削中…' : '書き直した本文で再添削する'}
            </button>
            {reviewError && (
              <p className="mt-3 text-xs text-red-600">{reviewError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 表示専用 sub-component ─────────────────────────────────────────

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
