// /essay/structure/[wid]/sparring page（Phase 2 STEP M 新規）。
//
// 「AI壁打ち」という UI 名称だが、Phase 2 では AI を一切使わない。
// 固定テンプレ 5 問（lib/essay/sparringQuestions.ts）に answer する形式。
//
// lazy start パターン（Phase 1 deep page と同型）:
//   - mount 直後は workspace.sparring を作らない
//   - 最初の textarea 入力で startSparring を発火
//   - useEffect 不要、Strict Mode 安全（idempotent な lazy start）
//
// 質問は決定論的に derive 可能:
//   - sparring 不在 → buildSparringQuestions(ctx) を live 計算で表示
//   - sparring 存在 → snapshot された sparring.questions を表示（resume / drift 対策）
//
// AI 呼び出し:
//   ゼロ。/api/essay-chat / /api/essay-improve-summary 等を呼ばない。

'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  loadEssayWorkspace,
  upsertEssayWorkspace,
} from '@/lib/essayWorkspaceStorage';
import {
  startSparring,
  updateSparringAnswers,
} from '@/lib/essay/workspaceOps';
import {
  SPARRING_TEMPLATE_VERSION,
  buildSparringQuestions,
} from '@/lib/essay/sparringQuestions';
import { Textarea } from '@/components/ui/Textarea';
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

export default function EssayStructureSparringPage() {
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
        body="壁打ち質問はテーマに紐づいて生成されます。テーマを選んでから戻ってきてください。"
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
        body="壁打ちはあなたの結論・理由を起点に深掘りします。1 文ずつでよいので先に埋めてみてください。"
      />
    );
  }

  // ─── derived ───────────────────────────────────────────────────────

  // sparring がない場合は live derive、存在する場合は snapshot 使用。
  // ※ テンプレ更新後の resume でも snapshot 優先で content drift しない。
  const sparring = workspace.sparring;
  const questions = sparring
    ? sparring.questions
    : buildSparringQuestions({
        themeText: workspace.theme.text,
        conclusion: workspace.mini.conclusion,
        faculty: workspace.target.faculty,
        university: workspace.target.university,
      });
  const answers: string[] = sparring
    ? sparring.answers
    : new Array(questions.length).fill('');

  // ─── handlers ──────────────────────────────────────────────────────

  // lazy start: 最初の入力で startSparring を発火。以降は updateSparringAnswers のみ。
  function handleAnswerChange(index: number, value: string) {
    if (!workspace) return;

    let ws = workspace;
    if (!ws.sparring) {
      const startQuestions = buildSparringQuestions({
        themeText: ws.theme.text,
        conclusion: ws.mini.conclusion,
        faculty: ws.target.faculty,
        university: ws.target.university,
      });
      ws = startSparring(ws, {
        questions: startQuestions,
        templateVersion: SPARRING_TEMPLATE_VERSION,
      });
    }

    const currentAnswers = ws.sparring?.answers ?? [];
    const nextAnswers = [...currentAnswers];
    nextAnswers[index] = value;
    const updated = updateSparringAnswers(ws, nextAnswers);

    try {
      upsertEssayWorkspace(updated);
    } catch (e) {
      // best-effort: autosave 失敗時もタイプは継続できる。次の onChange で再試行。
      console.warn('[essay STEP M] sparring autosave failed', e);
    }
    setWorkspace(updated);
  }

  function handleNext() {
    router.push(`/essay/structure/${wid}/body`);
  }

  // ─── render ────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/essay/structure/${wid}/mini`}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← ミニ思考欄に戻る
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2 leading-snug">
          AI壁打ち
        </h1>
        <p className="text-xs text-gray-500">
          5 問の質問に答えるだけ。完璧な答えである必要はありません。
          自分の言葉で書けば、本文を書くときの素材になります。
        </p>
      </div>

      {/* テーマ + ミニ思考欄（参照） */}
      <section className="bg-blue-50/50 border border-blue-100 rounded-lg p-4 mb-6">
        <p className="text-xs font-semibold text-gray-700 mb-1">テーマ</p>
        <p className="text-sm text-gray-800 leading-relaxed mb-3">
          {workspace.theme.text}
        </p>
        <p className="text-xs font-semibold text-gray-700 mb-1">ミニ思考欄</p>
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

      {/* 5 問の質問カード（1 問 1 セクション） */}
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

      <div className="text-center">
        <button
          type="button"
          onClick={handleNext}
          className={`${BUTTON_BASE} ${BUTTON_VARIANT.primary} ${BUTTON_SIZE.md}`}
        >
          次へ：本文を書く →
        </button>
        <p className="mt-2 text-xs text-gray-400">
          ※ 回答は自動保存されています。途中で離脱しても続きから再開できます。
        </p>
      </div>
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
