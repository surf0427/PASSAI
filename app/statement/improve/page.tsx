'use client';

// ④「書き直す」機能（do）の入口。STEP-DA-4: ③ /statement/score と思想を揃え、
// 「書き直し開始ページ」として整理する。
//
// 役割:
//   - 過去に書いた志望理由書（statementReviewHistory）の一覧を表示
//   - クリックで「俯瞰（軸別の現在 vs 目安 vs あと N 点 vs 改善方向性）」を表示
//   - 「詳細分析を見る →」で /statement/analysis/[id] へ深掘り遷移
//   - 「この内容をもとに書き直す →」で /statement/edit?rewriteFrom=<id> へ進む
//
// ③ /statement/score との違い:
//   - ③ は閲覧専用（書き直し CTA なし）
//   - ④ は「書き直しへ進む」CTA がある（書き直しは ② edit が担う）
//
// STEP-DA-4 の変更:
//   - 削除: AlertBox 3 種（改善アクション / 弱い点 / 良い点）
//   - 削除: Accordion 本文・詳細分析（NgWordCheck / StructureCheck / EvaluationAxisCheck）
//   - 削除: RadarSummary / ScoreBarCard × 5 / ImprovementPriority
//   - 追加: AxisGapCard × 5（評価項目 / 現在 / 目安 / あと N 点 / 改善方向性）
//   - 追加: 「詳細分析を見る →」LinkButton → /statement/analysis/{entry.id}
//   - 維持: 「この内容をもとに書き直す →」LinkButton → /statement/edit?rewriteFrom={entry.id}
//
// 注: AxisGapCard / STATUS_STYLES は ③ score/page.tsx の同名コードと意図的に重複している
// （③ を触らない制約のため）。将来 STEP で components/ScoreDashboard/AxisGapCard.tsx 等に
// 共通切り出し、③④ で import する形に揃えるのが望ましい。
//
// 触らない:
//   - statementReviewHistory の保存・削除ロジック（read のみ）
//   - /api/statement-review / /api/statement-prepare / AI prompt / PROMPT_VERSION
//   - ② edit / ③ score / /statement/analysis/[id]
//   - /statement/improve/[slug] サブルート（軸別 rewrite ガイドは現状そのまま温存）

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { LinkButton } from '@/components/ui/LinkButton';
import { Button } from '@/components/ui/Button';
import { TotalScoreCard } from '@/components/ScoreDashboard/TotalScoreCard';
import { RankBadge } from '@/components/ScoreDashboard/RankBadge';
import { DashboardSummary } from '@/components/ScoreDashboard/DashboardSummary';
import {
  loadReviewHistory,
  type ReviewHistoryItem,
} from '@/lib/statement/review/statementStorage';
import { statementResultToScore } from '@/lib/statement/score/statementScore';
import { breakdownToPassLineItems } from '@/lib/statement/score/statementScoreSource';
import {
  getPassLineComparison,
  type ComparisonResult,
} from '@/lib/passLineComparison';
import { IMPROVEMENT_COMMENTS } from '@/lib/improvementSuggestions';

// SSR-stable mount flag（他ページと同形パターン）。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

const SUMMARY_MESSAGE =
  'どこを直すかを確認してから、下の「この内容をもとに書き直す」で ② 書く画面へ進めます。';

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
        description="過去に書いた志望理由書を選んで、どこを直すかを確認してから書き直しに進めます。"
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

// ── 詳細表示（俯瞰 + 書き直し開始 CTA） ───────────────────────────
// ③ score の HistoryDetailView と同じ俯瞰構造 + 末尾に書き直し CTA を足す形。
// 詳細分析（NGワード / 構造 / 評価軸チェック）は /statement/analysis/[id] に分離済み。
function HistoryDetailView({
  entry,
  onBack,
}: {
  entry: ReviewHistoryItem;
  onBack: () => void;
}) {
  const score = statementResultToScore(entry.result);
  const passLineItems = breakdownToPassLineItems(score.breakdown);
  // 5 軸の現在 vs 目安比較。diff 降順（あと何点が大きい順 = 改善優先度高い順）に並べ替える。
  // 達成済み（diff=0）は末尾に寄せる。
  const comparison = [...getPassLineComparison(passLineItems)].sort(
    (a, b) => b.diff - a.diff,
  );

  // ② edit へ「書き直し対象」コンテキストを渡す URL。
  const rewriteHref = `/statement/edit?rewriteFrom=${encodeURIComponent(entry.id)}`;
  const analysisHref = `/statement/analysis/${encodeURIComponent(entry.id)}`;

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

      <Card variant="soft" padding="md" className="mb-5">
        <p className="text-[11px] font-bold text-blue-700 tracking-widest mb-2">
          書き直し対象
        </p>
        <p className="text-sm font-semibold text-slate-900">
          {entry.university || '（大学未入力）'}
          {entry.faculty ? `　${entry.faculty}` : ''}
          {entry.department ? `　${entry.department}` : ''}
        </p>
        <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
          {formatDateTime(entry.createdAt)}
        </p>
      </Card>

      <section className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 sm:gap-4 mb-4">
        <TotalScoreCard score={score.total} />
        <div className="bg-white border border-gray-200 rounded-2xl px-6 py-5 sm:px-8 flex items-center justify-center">
          <RankBadge score={score.total} size="lg" />
        </div>
      </section>

      <section className="mb-6">
        <DashboardSummary message={SUMMARY_MESSAGE} />
      </section>

      {/* 各評価軸の俯瞰：現在 / 目安 / あと N 点 / 改善方向性 */}
      <section className="mb-8">
        <h2 className="text-sm font-bold text-slate-900 mb-3">
          評価軸ごとの現在地
        </h2>
        <ul className="space-y-3">
          {comparison.map((c) => (
            <li key={c.id}>
              <AxisGapCard comparison={c} direction={IMPROVEMENT_COMMENTS[c.id] ?? ''} />
            </li>
          ))}
        </ul>
      </section>

      {/* 詳細分析へ進む（深掘りは /statement/analysis/[id] に集約） */}
      <section className="mb-4 bg-slate-50 border border-slate-200 rounded-2xl p-5 sm:p-6">
        <p className="text-[11px] font-bold text-slate-600 mb-1 tracking-widest">
          深掘り
        </p>
        <p className="text-sm text-slate-700 leading-relaxed mb-4">
          抽象表現・NGワード・構造・大学一致など、より詳しい分析を分析レポートで確認できます。
        </p>
        <LinkButton
          href={analysisHref}
          variant="secondary"
          size="md"
          className="w-full sm:w-auto"
        >
          詳細分析を見る →
        </LinkButton>
      </section>

      {/* ── ④ → ② へ遷移する CTA（primary、書き直し開始の主導線）─────────
          STEP4-1 で導入した URL 形式 `?rewriteFrom=<id>` を維持。② 側で本文 prefill + 左サイドに
          「書き直し中：参考メモ」Card を表示する経路と接続済み。 */}
      <section className="mb-6 bg-blue-50 border border-blue-100 rounded-2xl p-5 sm:p-6">
        <p className="text-[11px] font-bold text-blue-700 mb-1 tracking-widest">
          次のステップ
        </p>
        <p className="text-sm text-slate-700 leading-relaxed mb-4">
          選んだ志望理由書をもとに、② 書く画面で改善ポイントを参考にしながら書き直せます。
        </p>
        <LinkButton
          href={rewriteHref}
          variant="primary"
          size="md"
          className="w-full sm:w-auto"
        >
          この内容をもとに書き直す →
        </LinkButton>
      </section>

      {/* STEP-NAV-3: 詳細を最後まで読んだ後、上端の小型 underline link まで戻らずに
          一覧へ戻れるよう、最下部にも副ボタンを置く。onBack は既存 prop を流用。 */}
      <div className="mt-6">
        <Button variant="secondary" onClick={onBack}>
          ← 一覧に戻る
        </Button>
      </div>
    </>
  );
}

// ── 各評価軸の俯瞰カード（③ score/page.tsx の同名 component と意図的に重複） ──
// score を触らない制約のため、improve 側に local 複製を置く。将来 STEP で
// components/ScoreDashboard/AxisGapCard.tsx として共通切り出しする予定。
// 「改善を始める」per-card CTA は意図的に置かない（書き直し導線は下部の
// 「この内容をもとに書き直す →」に集約する）。

const STATUS_STYLES: Record<
  ComparisonResult['status'],
  { label: string; badgeClass: string; barClass: string }
> = {
  achieved: {
    label: '達成',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    barClass: 'bg-emerald-500',
  },
  almost: {
    label: 'もう少し',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    barClass: 'bg-amber-500',
  },
  needsImprovement: {
    label: '要改善',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    barClass: 'bg-rose-500',
  },
};

const AXIS_MAX_SCORE = 20;

function AxisGapCard({
  comparison,
  direction,
}: {
  comparison: ComparisonResult;
  direction: string;
}) {
  const style = STATUS_STYLES[comparison.status];
  const currentPct = clampPct((comparison.currentScore / AXIS_MAX_SCORE) * 100);
  const targetPct = clampPct((comparison.targetScore / AXIS_MAX_SCORE) * 100);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-slate-900">
          {comparison.label}
        </h3>
        <span
          className={`shrink-0 text-[11px] font-semibold border rounded px-2 py-0.5 ${style.badgeClass}`}
        >
          {style.label}
        </span>
      </div>

      {/* 現在地のバー + 目安マーカー */}
      <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
        <div
          className={`h-2 rounded-full transition-all ${style.barClass}`}
          style={{ width: `${currentPct}%` }}
        />
        <div
          aria-hidden
          className="absolute top-0 h-2 w-0.5 bg-slate-400"
          style={{ left: `${targetPct}%` }}
        />
      </div>

      {/* スコア数値 + あと何点 */}
      <p className="text-xs text-slate-600 tabular-nums mb-3">
        現在{' '}
        <span className="font-semibold text-slate-900">
          {comparison.currentScore}
        </span>
        <span className="mx-1 text-slate-400">/</span>
        目安{' '}
        <span className="font-semibold text-slate-700">
          {comparison.targetScore}
        </span>
        {comparison.diff > 0 ? (
          <span className="ml-3 text-slate-700">
            あと{' '}
            <span className="font-semibold text-slate-900">
              {comparison.diff}
            </span>{' '}
            点
          </span>
        ) : (
          <span className="ml-3 text-emerald-600 font-semibold">達成済み</span>
        )}
      </p>

      {/* 改善方向性 */}
      {direction && (
        <p className="text-xs text-slate-600 leading-relaxed">{direction}</p>
      )}
    </div>
  );
}

function clampPct(p: number): number {
  return Math.max(0, Math.min(100, p));
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
