// /essay/write/[wid]/target page（Phase 2 STEP O 新規）。
//
// 役割: write フロー（いきなり書く）の target 編集。
// structure/target と機能的にほぼ同じだが、戻り先 / 次先が write 系。
// STEP P で structure と共通化を検討（現状は重複 OK）。

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

const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

const EXAM_TYPE_OPTIONS = [
  '総合型選抜（AO入試）',
  '学校推薦型選抜（公募・指定校）',
  '一般選抜',
  '共通テスト利用',
  '海外大学受験',
  'まだ決まっていない',
] as const;

export default function EssayWriteTargetPage() {
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

  const basicInfo = useMemo(
    () => (isMounted ? loadBasicInfo() : null),
    [isMounted],
  );

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
      console.warn('[essay STEP O] write target autosave failed', e);
    }
    setWorkspace(updated);
  }

  function handleNext() {
    router.push(`/essay/write/${wid}/theme`);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href="/essay/write"
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← いきなり書く トップへ
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
