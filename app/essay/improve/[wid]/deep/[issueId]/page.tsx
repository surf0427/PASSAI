// 改善ワーク深掘り画面（STEP E 新規 → STEP-ESSAY-DEEPQ-AI-01 で AI 質問化）。
//
// UX 修正後の方針:
//   - session 粒度は workspace（≒ essay）単位。issue 切替で conflict にしない
//   - 同 workspace 内の別 issue は ImprovementInProgress.works[issueId] に
//     並行して保存される
//   - 改善まとめ生成は **hub ページ側**（/essay/improve/[wid]）に集約。
//     deep page では生成 CTA を持たない
//   - 完了後は「改善点一覧へ戻る」CTA を出して hub への自然な誘導
//
// 深掘り質問の出どころ（STEP-ESSAY-DEEPQ-AI-01）:
//   従来は lib/essay/deepDiveQuestions.ts の axis 別固定テンプレ（本文に紐付かない
//   抽象質問）だった。実機で「ユーザー本文と無関係な深掘り質問」になる問題があったため、
//   /api/essay-deep-questions を mount 時に呼び、本文・テーマ・改善対象・直前の AI
//   フィードバックに紐付いた具体質問を生成する。
//   - 既存 work（resume）があれば snapshot（deepQuestions）を再利用し再生成しない
//   - API 失敗 / quota 超過時は固定テンプレに silent fallback して機能を止めない
//
// lazy start パターン（Phase 1 deep page と同型）:
//   - mount 直後は workspace の works[issueId] を作らない
//   - 最初の textarea 入力で startImprovementWork が works[issueId] を追加
//     （このとき AI 生成質問が deepQuestions として snapshot される）
//   - 別 issue の work は触らずに残す（並行保存）

'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuotaDialog } from '@/components/billing/QuotaExceededDialog';
import {
  loadEssayWorkspace,
  upsertEssayWorkspace,
} from '@/lib/essayWorkspaceStorage';
import {
  startImprovementWork,
  updateImprovementAnswers,
} from '@/lib/essay/workspaceOps';
import {
  DEEP_DIVE_TEMPLATE_VERSION,
  getDeepDiveQuestions,
  inferAxis,
} from '@/lib/essay/deepDiveQuestions';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { parseIssueId, type ParsedIssueId } from '@/lib/essay/issueId';
import { Textarea } from '@/components/ui/Textarea';
import {
  BUTTON_BASE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
} from '@/components/ui/buttonStyles';
import type { BreakdownAxis, EssayWorkspace, ReviewEntry } from '@/types/essay';

// SSR-stable mount flag。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

function pickIssueText(review: ReviewEntry, parsed: ParsedIssueId): string {
  if (parsed.kind === 'improvement') return review.improvement ?? '';
  return review.weakPoints[parsed.weakPointIndex] ?? '';
}

export default function EssayDeepDivePage() {
  const params = useParams<{ wid: string; issueId: string }>();
  const wid = params?.wid ?? '';
  const issueId = params?.issueId ?? '';

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  const workspace = useMemo<EssayWorkspace | null>(
    () => (isMounted && wid ? loadEssayWorkspace(wid) : null),
    [isMounted, wid],
  );

  // pre-mount。
  if (!isMounted) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
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

  const parsed = parseIssueId(issueId);
  if (!parsed) {
    return (
      <GuardScreen
        backHref={`/essay/improve/${wid}`}
        backLabel="← 改善点一覧へ戻る"
        title="改善点が特定できませんでした"
        body="URL の改善点 ID 形式が不正です。改善点一覧から開き直してください。"
      />
    );
  }

  const review = workspace.reviews[parsed.reviewIndex] ?? null;
  if (!review) {
    return (
      <GuardScreen
        backHref={`/essay/improve/${wid}`}
        backLabel="← 改善点一覧へ戻る"
        title="改善点が見つかりませんでした"
        body="指定された添削結果は存在しません。最新の添削から改善点を選び直してください。"
      />
    );
  }

  const issueText = pickIssueText(review, parsed);
  if (!issueText.trim()) {
    return (
      <GuardScreen
        backHref={`/essay/improve/${wid}`}
        backLabel="← 改善点一覧へ戻る"
        title="改善点の内容が取り出せませんでした"
        body="この改善点には本文が含まれていません。別の改善点を選んでください。"
      />
    );
  }

  // 全ガード通過後に form 本体を別 component で描画する。
  // AI 質問 fetch / answers autosave 用の hook は本 component に閉じ込める
  // （親側で条件付き hook 呼び出しにならないようにするため）。
  return (
    <DeepDiveForm
      key={issueId}
      wid={wid}
      issueId={issueId}
      reviewIndex={parsed.reviewIndex}
      issueText={issueText}
      review={review}
      initialWorkspace={workspace}
    />
  );
}

function DeepDiveForm({
  wid,
  issueId,
  reviewIndex,
  issueText,
  review,
  initialWorkspace,
}: {
  wid: string;
  issueId: string;
  reviewIndex: number;
  issueText: string;
  review: ReviewEntry;
  initialWorkspace: EssayWorkspace;
}) {
  const { handleResponse: handleQuotaResponse, dialog: quotaDialog } =
    useQuotaDialog();
  const [workspace, setWorkspace] = useState<EssayWorkspace>(initialWorkspace);

  const existingWork = workspace.improvementInProgress?.works[issueId] ?? null;
  const axis: BreakdownAxis = existingWork ? existingWork.axis : inferAxis(issueText);

  // 深掘り質問の source:
  //   - existingWork あり（resume） → snapshot を使い、AI を再生成しない
  //   - なし → mount 時に /api/essay-deep-questions で生成。失敗時は固定テンプレ fallback
  const [aiQuestions, setAiQuestions] = useState<string[] | null>(
    existingWork ? existingWork.deepQuestions : null,
  );
  const [questionsLoading, setQuestionsLoading] = useState(!existingWork);
  const [usedFallback, setUsedFallback] = useState(false);
  const fetchStartedRef = useRef(false);

  useEffect(() => {
    // resume（既存 work あり）は snapshot を使うので fetch 不要。
    if (existingWork) return;
    // StrictMode の二重実行・再 render での多重 fetch を防ぐ。
    if (fetchStartedRef.current) return;
    fetchStartedRef.current = true;

    let cancelled = false;

    const fallbackToTemplate = () => {
      if (cancelled) return;
      setAiQuestions(getDeepDiveQuestions(axis));
      setUsedFallback(true);
    };

    // 出力収束（同一 workspace で似た質問に偏る）対策: 他の改善点で既に生成済みの
    // 深掘り質問を集めて重複回避の参考として渡す。決定論的処理（乱数なし）。
    const otherWorks = workspace.improvementInProgress?.works ?? {};
    const existingQuestions = Object.entries(otherWorks)
      .filter(([id]) => id !== issueId)
      .flatMap(([, w]) => w.deepQuestions ?? []);

    (async () => {
      try {
        const res = await fetch('/api/essay-deep-questions', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            essayBody: workspace.body,
            theme: workspace.theme.text,
            issueText,
            axis,
            mini: workspace.mini,
            previousFeedback: {
              improvement: review.improvement,
              goodPoints: review.goodPoints,
              weakPoints: review.weakPoints,
              verdict: review.verdict,
            },
            basicInfo: loadBasicInfo(),
            existingQuestions,
          }),
        });

        // 402 quota 超過は dialog に委譲。質問はテンプレ fallback で機能継続。
        if (await handleQuotaResponse(res)) {
          fallbackToTemplate();
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (
          !res.ok ||
          !Array.isArray(data.questions) ||
          data.questions.length === 0
        ) {
          fallbackToTemplate();
          return;
        }
        if (!cancelled) setAiQuestions(data.questions as string[]);
      } catch {
        fallbackToTemplate();
      } finally {
        if (!cancelled) setQuestionsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // mount 時に 1 回だけ実行する（issueId はルートで一意・remount される）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const questions: string[] = existingWork
    ? existingWork.deepQuestions
    : aiQuestions ?? [];
  const answers: string[] = existingWork
    ? existingWork.answers
    : new Array(questions.length).fill('');

  function handleAnswerChange(index: number, value: string) {
    let ws = workspace;
    if (!ws.improvementInProgress?.works[issueId]) {
      // lazy start: 該当 issue の work を新規作成（既存の他 issue は保持）。
      // ここで AI 生成質問（questions）が deepQuestions として snapshot される。
      ws = startImprovementWork(ws, {
        issueId,
        sourceReviewIndex: reviewIndex,
        issueText,
        axis,
        deepQuestions: questions,
        templateVersion: DEEP_DIVE_TEMPLATE_VERSION,
      });
    }

    const currentWork = ws.improvementInProgress!.works[issueId];
    const nextAnswers = [...currentWork.answers];
    nextAnswers[index] = value;
    const updated = updateImprovementAnswers(ws, issueId, nextAnswers);

    try {
      upsertEssayWorkspace(updated);
    } catch (e) {
      console.warn('[essay UX修正] answer autosave failed', e);
    }
    setWorkspace(updated);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/essay/improve/${wid}`}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← 改善点一覧へ戻る
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-3 leading-snug">
          深掘り質問で考えを引き出す
        </h1>
        <p className="text-xs text-gray-500">
          質問に答えるだけで OK。完璧な答えである必要はありません。
          回答は自動保存されます。
        </p>
      </div>

      {/* 改善点のコンテキスト */}
      <section className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-blue-700">取り組む改善点</p>
          <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-600 text-white">
            {axis}
          </span>
        </div>
        <p className="text-sm text-gray-800 leading-relaxed">{issueText}</p>
      </section>

      {/* 深掘り質問 */}
      {questionsLoading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center mb-8">
          <p className="text-sm text-gray-500">
            あなたの小論文に合わせた深掘り質問を生成しています…
          </p>
        </div>
      ) : (
        <>
          {usedFallback && (
            <p className="mb-4 text-xs text-amber-600">
              ※ 質問の自動生成に失敗したため、汎用の深掘り質問を表示しています。
            </p>
          )}
          <div className="space-y-4 mb-8">
            {questions.map((q, i) => (
              <section
                key={i}
                className="bg-white border border-gray-200 rounded-xl p-5"
              >
                <p className="text-sm font-semibold text-gray-700 mb-3">
                  Q{i + 1}. {q}
                </p>
                <Textarea
                  value={answers[i] ?? ''}
                  onChange={(e) => handleAnswerChange(i, e.target.value)}
                  rows={3}
                  placeholder="短く・自分の言葉で書いてみましょう"
                />
              </section>
            ))}
          </div>
        </>
      )}

      {/* 改善点一覧へ戻る CTA（責務分離 UX: まとめ生成はここではしない、hub 側で行う）。 */}
      <div className="text-center">
        <Link
          href={`/essay/improve/${wid}`}
          className={`${BUTTON_BASE} ${BUTTON_VARIANT.primary} ${BUTTON_SIZE.md}`}
        >
          改善点一覧へ戻る
        </Link>
        <p className="mt-2 text-xs text-gray-400">
          ※ 回答は自動保存されています。他の改善点も進められます。
        </p>
      </div>

      {/* STEP-GATE-COMPLETE: 402 quota-exceeded ダイアログ。 */}
      {quotaDialog}
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
