// 小論文 workspace 1 件分の summary カード（STEP C 新規）。
// /essay/results の一覧表示で使う。
//
// 表示項目:
//   - テーマ
//   - 大学・学部
//   - updatedAt
//   - 添削件数
//   - 最新 totalScore
//
// クリック遷移先:
//   - 既定 (`/essay/results`): `/essay/result/{workspace.id}`
//   - href prop で上書き可能 (`/essay/improve` 一覧で使う場合は `/essay/improve/{id}` を渡す)
//
// 動作分岐は持たず、見た目は variant prop 等で切り替えない（呼び出し側責務）。

import Link from 'next/link';
import { formatReviewDate } from '@/lib/essayPracticeStorage';
import type { EssayWorkspace } from '@/types/essay';

export function EssayWorkspaceCard({
  workspace,
  href,
}: {
  workspace: EssayWorkspace;
  href?: string;
}) {
  const targetHref = href ?? `/essay/result/${workspace.id}`;
  const latest = workspace.reviews.at(-1) ?? null;
  const targetLabel =
    [workspace.target.university, workspace.target.faculty]
      .filter((s) => s.trim() !== '')
      .join(' / ') || '志望校未設定';
  const themeText = workspace.theme.text || 'テーマ未設定';

  return (
    <Link
      href={targetHref}
      className="block bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm rounded-xl p-5 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-sm font-semibold text-gray-800 line-clamp-2">
          {themeText}
        </p>
        {latest && (
          <span className="shrink-0 inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {latest.totalScore} 点
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span>{targetLabel}</span>
        <span>·</span>
        <span>添削 {workspace.reviews.length} 件</span>
        <span>·</span>
        <span>{formatReviewDate(workspace.updatedAt)}</span>
      </div>
    </Link>
  );
}
