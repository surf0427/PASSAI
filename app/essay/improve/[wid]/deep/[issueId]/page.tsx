// 改善ワーク深掘り画面（STEP E 新規、責務分離 UX 修正版）。
//
// UX 修正後の方針:
//   - session 粒度は workspace（≒ essay）単位。issue 切替で conflict にしない
//   - 同 workspace 内の別 issue は ImprovementInProgress.works[issueId] に
//     並行して保存される
//   - 改善まとめ生成は **hub ページ側**（/essay/improve/[wid]）に集約。
//     deep page では生成 CTA を持たない
//   - 完了後は「改善点一覧へ戻る」CTA を出して hub への自然な誘導
//
// 表示モード（render 時に決まる、内部 phase state は持たない）:
//   1. 読み込み中（pre-mount）
//   2. NotFound（workspace 不在 / wid 不正）
//   3. InvalidIssue（issueId parse 失敗 / sourceReviewIndex 範囲外 / issueText 空）
//   4. Questions form （resume または lazy start）
//
// lazy start パターン（Phase 1 deep page と同型）:
//   - mount 直後は workspace の works[issueId] を作らない
//   - 最初の textarea 入力で startImprovementWork が works[issueId] を追加
//   - 別 issue の work は触らずに残す（並行保存）

'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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
import { parseIssueId, type ParsedIssueId } from '@/lib/essay/issueId';
import { Textarea } from '@/components/ui/Textarea';
import {
  BUTTON_BASE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
} from '@/components/ui/buttonStyles';
import type { EssayWorkspace, ReviewEntry } from '@/types/essay';

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

  const mountedWorkspace = useMemo<EssayWorkspace | null>(
    () => (isMounted && wid ? loadEssayWorkspace(wid) : null),
    [isMounted, wid],
  );

  const [postUserWorkspace, setWorkspace] = useState<EssayWorkspace | null>(null);
  const workspace: EssayWorkspace | null = postUserWorkspace ?? mountedWorkspace;

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

  // ─── derived ──────────────────────────────────────────────────────

  // 既存の work があればその snapshot を使う、なければ live derive。
  const existingWork = workspace.improvementInProgress?.works[issueId] ?? null;
  const axis = existingWork ? existingWork.axis : inferAxis(issueText);
  const questions = existingWork
    ? existingWork.deepQuestions
    : getDeepDiveQuestions(axis);
  const answers: string[] = existingWork
    ? existingWork.answers
    : new Array(questions.length).fill('');

  // ─── handlers ─────────────────────────────────────────────────────

  function handleAnswerChange(index: number, value: string) {
    if (!workspace) return;

    let ws = workspace;
    if (!ws.improvementInProgress?.works[issueId]) {
      // lazy start: 該当 issue の work を新規作成（既存の他 issue は保持）。
      ws = startImprovementWork(ws, {
        issueId,
        sourceReviewIndex: parsed!.reviewIndex,
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

  // ─── render ───────────────────────────────────────────────────────

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
