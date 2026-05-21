'use client';

// ④「書き直す」機能（do）の入口。
// STEP-IMP-2 で score 俯瞰 UI を撤去、続く STEP で中継 hub も撤去し、
// 「一覧 → クリック → そのまま書き直し準備ページ」のフラットな 1 階層構造にした。
//
// 役割:
//   - 過去に書いた志望理由書（statementReviewHistory）の一覧を表示
//   - 各エントリは `<Link>` で /statement/improve/rewrite/<id> へ直接遷移
//   - 詳細 hub（"この志望理由書を書き直しますか？" の中継ページ）は持たない
//   - 完成度スコア俯瞰 UI（TotalScoreCard / RankBadge / DashboardSummary / AxisGapCard）も持たない
//
// ③ /statement/score との責務分離:
//   - ③ = 完成度を俯瞰する view 機能（一覧 + 詳細 hub あり）
//   - ④ = 書き直しを始める do 機能（一覧から直接 rewrite prep へ）
//
// 触らない:
//   - statementReviewHistory の保存・削除ロジック（read のみ）
//   - /api/statement-review / /api/statement-prepare / AI prompt / PROMPT_VERSION
//   - ② edit / ③ score / /statement/analysis/[id]
//   - /statement/improve/[slug] サブルート（orphan 維持）
//   - /statement/improve/rewrite/[id]（page 3 = STEP-IMP-1、本ページの遷移先）

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { LinkButton } from '@/components/ui/LinkButton';
import {
  loadReviewHistory,
  type ReviewHistoryItem,
} from '@/lib/statement/review/statementStorage';

// SSR-stable mount flag（他ページと同形パターン）。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function StatementImprovePage() {
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // 履歴は read only。saveReviewHistory / delete / clear は本ページから一切呼ばない。
  const history = useMemo<ReviewHistoryItem[]>(
    () => (isMounted ? loadReviewHistory() : []),
    [isMounted],
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <PageHeader
        title="書き直す"
        description="過去に書いた志望理由書を選んで、書き直しを始めましょう。"
      />

      <div className="mb-6">
        <Link
          href="/statement"
          className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2"
        >
          ← 志望理由書トップへ
        </Link>
      </div>

      {isMounted && history.length === 0 && <NoHistoryYet />}
      {isMounted && history.length > 0 && <HistoryListView history={history} />}
    </div>
  );
}

// ── 履歴ゼロのとき ─────────────────────────────────────────────────
// 「書き直す対象が無い」状態。② に誘導して新規作成を促す。
function NoHistoryYet() {
  return (
    <Card variant="soft" padding="lg" className="text-center mt-2 sm:mt-4">
      <h2 className="text-lg sm:text-xl font-bold text-slate-900 mb-3">
        まだ書き直す対象がありません
      </h2>
      <p className="text-sm text-slate-600 leading-relaxed mb-6 max-w-md mx-auto">
        志望理由書を書いて添削を受けると、ここから過去の結果を選んで書き直せます。
      </p>
      <LinkButton
        href="/statement/edit"
        variant="primary"
        size="md"
        className="w-full sm:w-auto"
      >
        志望理由書を書く
      </LinkButton>
    </Card>
  );
}

// ── 一覧表示 ─────────────────────────────────────────────────────
// 各カードは <Link> で /statement/improve/rewrite/<id> へ直接遷移する。
// 旧版では in-page state（selectedId）で詳細 hub に切り替えていたが、hub の情報が薄く
// 1 クリック余計に挟まる UX だったため撤去した。視覚的なカード形状は維持。
function HistoryListView({ history }: { history: ReviewHistoryItem[] }) {
  return (
    <>
      <p className="text-sm text-slate-600 mb-4 leading-relaxed">
        書き直したい志望理由書を選んでください。
      </p>
      <ul className="space-y-3">
        {history.map((item) => (
          <li key={item.id}>
            <Link
              href={`/statement/improve/rewrite/${encodeURIComponent(item.id)}`}
              className="block w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {item.university || '（大学未入力）'}
                  {item.faculty ? `　${item.faculty}` : ''}
                  {item.department ? `　${item.department}` : ''}
                </p>
                <div className="shrink-0 flex items-center gap-3">
                  <span className="text-base font-bold text-blue-700 tabular-nums">
                    {item.result.overallScore}
                    <span className="text-[11px] text-blue-500 font-normal ml-0.5">/100</span>
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 tabular-nums mb-1.5">
                {formatDateTime(item.createdAt)}
              </p>
              <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                {previewEssay(item.essay)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── helpers ──────────────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${h}:${min}`;
}

function previewEssay(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  const limit = 90;
  if (trimmed.length <= limit) return trimmed;
  return trimmed.slice(0, limit) + '…';
}
