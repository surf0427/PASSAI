// /essay/structure/[wid]/mini page（Phase 2 STEP L 新規）。
//
// 役割:
//   ミニ思考欄（結論 1 + 理由 2）の入力。短文 Input（textarea ではない）で
//   「本文を書かせない・思考整理だけに徹する」UI 思想を体現する。
//
// autosave:
//   各 input の onChange で updateMini + upsertEssayWorkspace（best-effort）。
//   失敗しても UI は壊さない、タイプ継続可能。

'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  loadEssayWorkspace,
  upsertEssayWorkspace,
} from '@/lib/essayWorkspaceStorage';
import { updateMini } from '@/lib/essay/workspaceOps';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/ui/FormField';
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

export default function EssayStructureMiniPage() {
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

  // theme 未設定で mini を開いた → 先に theme を選ばせる。
  if (!workspace.theme.text.trim()) {
    return (
      <GuardScreen
        backHref={`/essay/structure/${wid}/theme`}
        backLabel="← テーマ選択へ"
        title="先にテーマを選んでください"
        body="ミニ思考欄はテーマに対する自分の立場を書く欄です。テーマを確認してから戻ってきてください。"
      />
    );
  }

  // ─── handlers ──────────────────────────────────────────────────────

  function handleFieldChange(
    field: keyof EssayWorkspace['mini'],
    value: string,
  ) {
    if (!workspace) return;
    const nextMini = { ...workspace.mini, [field]: value };
    const updated = updateMini(workspace, nextMini);
    try {
      upsertEssayWorkspace(updated);
    } catch (e) {
      console.warn('[essay STEP L] mini autosave failed', e);
    }
    setWorkspace(updated);
  }

  function handleNext() {
    router.push(`/essay/structure/${wid}/sparring`);
  }

  // ─── render ────────────────────────────────────────────────────────

  const targetLabel =
    [workspace.target.university, workspace.target.faculty]
      .filter((s) => s.trim() !== '')
      .join(' / ') || '志望校未設定';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/essay/structure/${wid}/theme`}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← テーマ選択に戻る
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2 leading-snug">
          ミニ思考欄
        </h1>
        <p className="text-xs text-gray-500">
          短くて OK。完璧に書く必要はありません。まずは考えの起点を作りましょう。
        </p>
      </div>

      {/* テーマ + 大学情報（参照） */}
      <section className="bg-blue-50/50 border border-blue-100 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-700">テーマ</p>
          <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {workspace.theme.type || '—'}
          </span>
        </div>
        <p className="text-sm text-gray-800 leading-relaxed mb-2">
          {workspace.theme.text}
        </p>
        <p className="text-xs text-gray-500">{targetLabel}</p>
      </section>

      {/* 結論 + 理由 2 */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
        <FormField
          label="① あなたの結論（1 文）"
          hint="完璧な結論でなくて大丈夫。思いついた順で書いてみましょう。"
        >
          <Input
            type="text"
            value={workspace.mini.conclusion}
            onChange={(e) => handleFieldChange('conclusion', e.target.value)}
            placeholder="〇〇は△△だと考える"
          />
        </FormField>

        <div className="h-4" />

        <FormField label="② 理由①" hint="短くて OK。1 文で書いてみてください。">
          <Input
            type="text"
            value={workspace.mini.reasonOne}
            onChange={(e) => handleFieldChange('reasonOne', e.target.value)}
            placeholder="理由を 1 文で書いてください"
          />
        </FormField>

        <div className="h-4" />

        <FormField
          label="③ 理由②"
          hint="① と違う角度から。1 つしか思いつかなければ空欄でも OK。"
        >
          <Input
            type="text"
            value={workspace.mini.reasonTwo}
            onChange={(e) => handleFieldChange('reasonTwo', e.target.value)}
            placeholder="別の視点から理由を書いてください"
          />
        </FormField>
      </section>

      <div className="text-center">
        <button
          type="button"
          onClick={handleNext}
          className={`${BUTTON_BASE} ${BUTTON_VARIANT.primary} ${BUTTON_SIZE.md}`}
        >
          次へ：AI壁打ち →
        </button>
        <p className="mt-2 text-xs text-gray-400">
          ※ 入力した内容は自動保存されています。
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
