'use client';

// 「書き直す」機能の入口。過去添削の一覧 hub。
// 責務: analysis = 理解 / rewrite = 整理 / edit = 執筆 の中の「rewrite cycle 入口」。
//
// 役割:
//   - 過去に書いた志望理由書（statementReviewHistory）の一覧を表示
//   - 各エントリは `<Link>` で /statement/improve/analysis/<id>（improve 専用 analysis）へ遷移
//   - 完成度スコア俯瞰 UI（score page 側に分離）は持たない
//
// rewrite cycle のフロー:
//   /statement/improve                       ← 過去添削の一覧（このページ）
//     → カードクリック
//   /statement/improve/analysis/<id>          ← 改善ポイント（actions / weaknesses + 改善の方向）
//     → 「書き直し準備へ進む →」
//   /statement/improve/rewrite/<id>           ← 整理（rewriteMemo + Before/After 参考例）
//     → 「②で本文を書き直す →」
//   /statement/edit?rewriteFrom=<id>          ← 執筆（本文 prefill + 添削）
//
// /statement/score との責務分離:
//   - score = 完成度を俯瞰する view 機能（read-only、AxisGapCard 5 軸）。詳細は
//     /statement/analysis/[id]（view-only analysis）で読める。rewrite には誘導しない。
//   - improve = 書き直しを始める do 機能。/statement/improve/analysis/[id] は改善ポイントを
//     上位に置き、rewrite CTA を持つ improve 専用 analysis。view と do の analysis page
//     を分離することで、shared page による責務混入を防ぐ（STEP-IA-1）。
//
// 触らない:
//   - statementReviewHistory の保存・削除ロジック（read のみ）
//   - /api/statement-review / /api/statement-prepare / AI prompt / PROMPT_VERSION
//   - edit / score / /statement/analysis/[id] / /statement/improve/rewrite/[id]

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { LinkButton } from '@/components/ui/LinkButton';
import {
  loadReviewHistory,
  deleteReviewHistoryItem,
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

  // 履歴は read + delete のみ。save は ② edit 側、clear は本ページから呼ばない。
  // localStorage の sync 用に useState + mount-init useEffect パターンを採用：
  //   - 初期値 [] で SSR / 初回 client render を hydration セーフに揃える
  //   - mount 後に loadReviewHistory() を 1 度実行して seed
  //   - delete 時は handleDelete から setHistory(loadReviewHistory()) で再 sync
  const [history, setHistory] = useState<ReviewHistoryItem[]>([]);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isMounted) setHistory(loadReviewHistory());
  }, [isMounted]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleDelete(id: string) {
    const ok = window.confirm(
      'この志望理由書の履歴を削除しますか？この操作は元に戻せません。',
    );
    if (!ok) return;
    deleteReviewHistoryItem(id);
    setHistory(loadReviewHistory());
  }

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
      {isMounted && history.length > 0 && (
        <HistoryListView history={history} onDelete={handleDelete} />
      )}
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
// 各カードは <Link> で /statement/improve/analysis/<id>（improve 専用 analysis）へ遷移する。
// 旧版では in-page state（selectedId）で詳細 hub に切り替えていたが、hub の情報が薄く
// 1 クリック余計に挟まる UX だったため撤去した。視覚的なカード形状は維持。
// 「書き直し準備（/statement/improve/rewrite/<id>）」は improve 専用 analysis page 下部の CTA
// 経由で到達する。本ページから rewrite prep に直接飛ばすと、改善点を読まずに
// 書き始めることになり、④ の意図と合わない。
function HistoryListView({
  history,
  onDelete,
}: {
  history: ReviewHistoryItem[];
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <p className="text-sm text-slate-600 mb-4 leading-relaxed">
        書き直したい志望理由書を選んでください。
      </p>
      <ul className="space-y-3">
        {history.map((item) => (
          // 削除 button を Link と sibling にし、Link の navigation と干渉させない。
          // 削除側で preventDefault + stopPropagation を defensive に呼んでおく。
          <li key={item.id} className="relative">
            <Link
              href={`/statement/improve/analysis/${encodeURIComponent(item.id)}`}
              className="block w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-4 pr-12 hover:border-blue-300 hover:shadow-sm transition-all"
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
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(item.id);
              }}
              className="absolute top-2 right-2 text-xs text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
              aria-label="この履歴を削除"
            >
              削除
            </button>
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
