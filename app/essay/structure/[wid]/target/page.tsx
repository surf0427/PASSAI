// /essay/structure/[wid]/target page（Phase 2 STEP K 新規）。
//
// 役割:
//   target（university / faculty / department / examType）を編集。
//   入力ごとに updateTarget で autosave、「次へ」で /essay/structure/[wid]/theme へ遷移。
//
// 設計:
//   - workspace は loadEssayWorkspace(wid) で 1 度読み込み、mutation 後は setWorkspace で override
//   - autosave は best-effort（try/catch、UI に伝播しない）
//   - guard: workspace 不在 / wid 不正 / reviews 完了済み → 戻り link 付きの GuardScreen
//   - reviews 完了済みの workspace で structure を開けないよう（誤動作防止）guard

'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  loadEssayWorkspace,
  upsertEssayWorkspace,
} from '@/lib/essayWorkspaceStorage';
import { updateTarget } from '@/lib/essay/workspaceOps';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import BasicInfoSummary from '@/components/shared/BasicInfoSummary';
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

// 入試方式選択肢（既存 /essay-practice の ESSAY_EXAM_TYPE_OPTIONS と同集合）。
// 将来 Phase 2 が安定したら共有定数化を検討。
const EXAM_TYPE_OPTIONS = [
  '総合型選抜（AO入試）',
  '学校推薦型選抜（公募・指定校）',
  '一般選抜',
  '共通テスト利用',
  '海外大学受験',
  'まだ決まっていない',
] as const;

export default function EssayStructureTargetPage() {
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

  // BasicInfoSummary 表示用。target の初期値は workspace.target（entry 側で prefill 済み）。
  const basicInfo = useMemo(
    () => (isMounted ? loadBasicInfo() : null),
    [isMounted],
  );

  // pre-mount: 読み込み中。SSR / hydration safe。
  if (!isMounted) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-sm text-gray-500">読み込み中…</div>
      </div>
    );
  }

  // workspace 不在 / wid 不正 / 退役済み。
  if (!workspace) {
    return (
      <GuardScreen
        backHref="/essay/structure"
        backLabel="← 整理して書く トップへ"
        title="見つかりませんでした"
        body="指定された下書きは存在しないか、保存件数の上限を超えて退役した可能性があります。新しく始めるか、トップから一覧を確認してください。"
      />
    );
  }

  // 完了済みの workspace で structure を開いた → 誤動作防止。
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

  // ─── handlers ──────────────────────────────────────────────────────

  function handleFieldChange(
    field: keyof EssayWorkspace['target'],
    value: string,
  ) {
    if (!workspace) return;
    const nextTarget = { ...workspace.target, [field]: value };
    const updated = updateTarget(workspace, nextTarget);
    try {
      upsertEssayWorkspace(updated);
    } catch (e) {
      // best-effort: autosave 失敗時もタイプは継続できる（次の onChange で再試行）。
      console.warn('[essay STEP K] target autosave failed', e);
    }
    setWorkspace(updated);
  }

  function handleNext() {
    router.push(`/essay/structure/${wid}/theme`);
  }

  // ─── render ────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href="/essay/structure"
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← 整理して書く トップへ
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2 leading-snug">
          志望校を選ぶ
        </h1>
        <p className="text-xs text-gray-500">
          今回の小論文で意識する志望校・学部・入試方式を入力してください。
          基本情報の値は上書きされません。
        </p>
      </div>

      <BasicInfoSummary basicInfo={basicInfo} />

      <section className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
        <div className="space-y-3">
          <FormField label="大学名">
            <Input
              type="text"
              value={workspace.target.university}
              onChange={(e) => handleFieldChange('university', e.target.value)}
              placeholder="例：〇〇大学"
            />
          </FormField>

          <FormField label="学部名">
            <Input
              type="text"
              value={workspace.target.faculty}
              onChange={(e) => handleFieldChange('faculty', e.target.value)}
              placeholder="例：〇〇学部"
            />
          </FormField>

          <FormField label="学科名（任意）">
            <Input
              type="text"
              value={workspace.target.department}
              onChange={(e) => handleFieldChange('department', e.target.value)}
              placeholder="例：〇〇学科"
            />
          </FormField>

          <FormField
            label="入試方式（任意）"
            hint="基本情報の受験予定方式の先頭を初期値にしています。"
          >
            <select
              value={workspace.target.examType}
              onChange={(e) => handleFieldChange('examType', e.target.value)}
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">未選択</option>
              {EXAM_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </section>

      <div className="text-center">
        <button
          type="button"
          onClick={handleNext}
          className={`${BUTTON_BASE} ${BUTTON_VARIANT.primary} ${BUTTON_SIZE.md}`}
        >
          次へ：テーマ確認 →
        </button>
        <p className="mt-2 text-xs text-gray-400">
          ※ 入力した内容は自動保存されています。
        </p>
      </div>
    </div>
  );
}

// 表示専用 sub-component（NotFound / 完了済み warning 用）。
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
