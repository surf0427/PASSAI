// /essay/structure/[wid]/theme page（Phase 2 STEP L 新規）。
//
// 役割:
//   workspace.target からテーマ候補を導出し、ユーザーに 1 件選ばせる。
//   候補 rotate は **local state のみ**（workspace に書き込まない）。
//   「このテーマで進む」CTA で初めて workspace.theme に確定保存する。
//
// 設計判断（ghost autosave 禁止）:
//   - rotate 中の theme 値を毎回 workspace に保存すると、ユーザーが迷っている途中の
//     不本意な theme が workspace に残る → ghost autosave。これを避けるため
//     確定操作（CTA クリック）でだけ updateTheme + upsertEssayWorkspace を呼ぶ。
//   - workspace.theme.text に既存値があれば、それを themeIndex の初期表示に対応させる
//     （resume 時に「最後に選んだテーマが残っている」体験を保つ）。

'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  loadEssayWorkspace,
  upsertEssayWorkspace,
} from '@/lib/essayWorkspaceStorage';
import { updateTheme } from '@/lib/essay/workspaceOps';
import {
  getEssayThemeCandidates,
  type EssayThemeCandidate,
} from '@/lib/essayThemes';
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

export default function EssayStructureThemePage() {
  const params = useParams<{ wid: string }>();
  const router = useRouter();
  const wid = params?.wid ?? '';

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  const workspace = useMemo<EssayWorkspace | null>(
    () => (isMounted && wid ? loadEssayWorkspace(wid) : null),
    [isMounted, wid],
  );

  // 候補 rotate 用の local index。workspace に書かない（ghost autosave 防止）。
  const [themeIndex, setThemeIndex] = useState(0);

  // pre-mount: 読み込み中。SSR / hydration safe。
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

  // テーマ候補は workspace.target から導出。target は STEP K で保存済み前提。
  const candidates = getEssayThemeCandidates({
    university: workspace.target.university,
    faculty: workspace.target.faculty,
    department: workspace.target.department,
    examType: workspace.target.examType,
  });
  // 必ず 1 件以上返る保証。空配列ハンドリングは不要（essayThemes.ts の契約）。
  const current: EssayThemeCandidate =
    candidates[themeIndex % candidates.length];

  const isPersistedThemeMatch =
    workspace.theme.text === current.theme &&
    workspace.theme.type === current.themeType;

  // ─── handlers ──────────────────────────────────────────────────────

  function handleRotate() {
    setThemeIndex((prev) => prev + 1);
  }

  function handleConfirm() {
    if (!workspace) return;
    const nextTheme: EssayWorkspace['theme'] = {
      text: current.theme,
      type: current.themeType,
      source: current.sourceType,
      reason: current.reason,
    };
    const updated = updateTheme(workspace, nextTheme);
    try {
      upsertEssayWorkspace(updated);
    } catch (e) {
      console.warn('[essay STEP L] theme confirm save failed', e);
      // 失敗しても遷移は進める（次の page で再 load して整合確認できる）。
    }
    router.push(`/essay/structure/${wid}/mini`);
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
          href={`/essay/structure/${wid}/target`}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← 志望校設定に戻る
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2 leading-snug">
          テーマを選ぶ
        </h1>
        <p className="text-xs text-gray-500">
          志望校のアドミッションポリシーや学部傾向から候補を出しています。
          ピンと来なければ別のテーマに切り替えてください。
        </p>
      </div>

      {/* target 確認 */}
      <section className="bg-blue-50/50 border border-blue-100 rounded-lg p-4 mb-5">
        <p className="text-xs font-semibold text-gray-700 mb-1">今回の志望校</p>
        <p className="text-sm text-gray-800">{targetLabel}</p>
      </section>

      {/* テーマ本文 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-600">小論文テーマ</p>
          <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {current.themeType}
          </span>
        </div>
        <p className="text-sm text-gray-800 leading-relaxed mb-3">
          {current.theme}
        </p>
        <p
          className={
            current.sourceType === 'admission_policy'
              ? 'text-xs text-blue-600'
              : 'text-xs text-amber-600'
          }
        >
          {current.reason}
        </p>
        {candidates.length > 1 && (
          <p className="text-xs text-gray-400 mt-2">
            ※ 候補 {candidates.length} 件 / 表示中 {(themeIndex % candidates.length) + 1} 件目
          </p>
        )}
      </section>

      {/* resume 時の補足 */}
      {workspace.theme.text && !isPersistedThemeMatch && (
        <p className="mb-4 text-xs text-amber-600">
          ※ 前回「{workspace.theme.text}」を選んでいました。別のテーマで進めると上書きされます。
        </p>
      )}

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          type="button"
          onClick={handleConfirm}
          className={`${BUTTON_BASE} ${BUTTON_VARIANT.primary} ${BUTTON_SIZE.md}`}
        >
          このテーマで進む →
        </button>
        {candidates.length > 1 && (
          <button
            type="button"
            onClick={handleRotate}
            className={`${BUTTON_BASE} ${BUTTON_VARIANT.outline} ${BUTTON_SIZE.md}`}
          >
            別のテーマを見る
          </button>
        )}
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
