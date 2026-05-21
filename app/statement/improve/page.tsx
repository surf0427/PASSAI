'use client';

// ④「書き直す」機能（do）の入口。
// STEP-IMP-2: 完成度スコア俯瞰 UI を撤去し、「書き直し対象を選ぶだけ」のシンプルな入口に戻す。
//
// 役割:
//   - 過去に書いた志望理由書（statementReviewHistory）の一覧を表示
//   - クリックで「書き直しを始める」CTA だけを表示
//   - CTA は /statement/improve/rewrite/<id>（ページ3：書き直し準備）へ遷移
//   - 完成度スコア俯瞰（TotalScoreCard / RankBadge / DashboardSummary / AxisGapCard）は持たない
//
// ③ /statement/score との責務分離:
//   - ③ = 完成度を俯瞰する view 機能
//   - ④ = 改善点を整理して書き直しを始める do 機能（俯瞰 UI は持たない）
//
// STEP-IMP-2 で削除:
//   - TotalScoreCard / RankBadge / DashboardSummary 使用
//   - AxisGapCard × 5（local component / STATUS_STYLES / AXIS_MAX_SCORE / clampPct）
//   - 「評価軸ごとの現在地」section、「現在 / 目安 / あと N 点」表示
//   - statementResultToScore / breakdownToPassLineItems / getPassLineComparison 呼び出し
//   - IMPROVEMENT_COMMENTS 参照
//   - DashboardSummary メッセージ用 SUMMARY_MESSAGE 定数
//   - 詳細分析 CTA（ページ3 から張り直すため）
//
// 触らない:
//   - statementReviewHistory の保存・削除ロジック（read のみ）
//   - /api/statement-review / /api/statement-prepare / AI prompt / PROMPT_VERSION
//   - ② edit / ③ score / /statement/analysis/[id]
//   - /statement/improve/[slug] サブルート（orphan 維持）
//   - /statement/improve/rewrite/[id]（page 3 = STEP-IMP-1）

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { LinkButton } from '@/components/ui/LinkButton';
import { Button } from '@/components/ui/Button';
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

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected =
    selectedId === null ? null : history.find((h) => h.id === selectedId) ?? null;

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

      {isMounted && history.length > 0 && selected === null && (
        <HistoryListView
          history={history}
          onSelect={(id) => setSelectedId(id)}
        />
      )}

      {isMounted && selected !== null && (
        <HistoryDetailView
          entry={selected}
          onBack={() => setSelectedId(null)}
        />
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
function HistoryListView({
  history,
  onSelect,
}: {
  history: ReviewHistoryItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <p className="text-sm text-slate-600 mb-4 leading-relaxed">
        書き直したい志望理由書を選んでください。
      </p>
      <ul className="space-y-3">
        {history.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
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
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── 詳細表示（書き直し開始のシンプルな入口）──────────────────────
// STEP-IMP-2 で score 俯瞰 UI（TotalScoreCard / RankBadge / DashboardSummary /
// AxisGapCard / 評価軸ごとの現在地）と詳細分析 CTA を撤去。
// 「この志望理由書を書き直すか確認 → 書き直し準備ページへ進む」だけのシンプルな hub に戻す。
// 改善ポイント / 詳細分析 / 書き直しメモはすべて page 3（/statement/improve/rewrite/[id]）側で表示。

function HistoryDetailView({
  entry,
  onBack,
}: {
  entry: ReviewHistoryItem;
  onBack: () => void;
}) {
  const rewritePrepHref = `/statement/improve/rewrite/${encodeURIComponent(entry.id)}`;

  return (
    <>
      <div className="mb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2"
        >
          ← 一覧に戻る
        </button>
      </div>

      <header className="mb-8">
        <p className="text-xs text-slate-400 tabular-nums mb-2">
          {formatDateTime(entry.createdAt)}
        </p>
        <h2 className="text-xl font-semibold text-slate-900 tracking-tight mb-2">
          {entry.university || '（大学未入力）'}
          {entry.faculty ? `　${entry.faculty}` : ''}
          {entry.department ? `　${entry.department}` : ''}
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          この志望理由書を書き直しますか？次のページで改善ポイントを確認しながら、修正方針を整理できます。
        </p>
      </header>

      <div>
        <LinkButton
          href={rewritePrepHref}
          variant="primary"
          size="md"
          className="w-full sm:w-auto"
        >
          書き直しを始める →
        </LinkButton>
      </div>

      {/* STEP-NAV-3: 詳細を最後まで読んだ後、上端の小型 underline link まで戻らずに
          一覧へ戻れるよう、最下部にも副ボタンを置く。onBack は既存 prop を流用。 */}
      <div className="mt-10">
        <Button variant="secondary" onClick={onBack}>
          ← 一覧に戻る
        </Button>
      </div>
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
