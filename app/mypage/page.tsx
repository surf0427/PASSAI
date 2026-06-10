'use client';

// マイページ MVP。
//
// 厳守:
//   - localStorage は lib/mypage/loadMypageData.ts 経由でのみ読む。
//   - write しない。schema 変更しない。Supabase / Auth / user_id を触らない。
//
// SSR:
//   localStorage に依存するため、isMounted true まで EMPTY_MYPAGE_DATA を表示し、
//   hydration 後に client で実データに切り替える。
//   既存ページと同じ useSyncExternalStore パターン。

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useAuthDebug } from '@/app/components/AuthProvider';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { LinkButton } from '@/components/ui/LinkButton';
import {
  loadMypageData,
  EMPTY_MYPAGE_DATA,
  type MypageData,
  type RecentActivityItem,
  type MonthlyRankingItem,
} from '@/lib/mypage/loadMypageData';
import { ScoreLineChart } from './ScoreLineChart';
import { EmptyState } from './EmptyState';
import { BillingCard } from './BillingCard';
import { UsageStatusCard } from './UsageStatusCard';
import { LoginNudge } from './LoginNudge';
import { LogoutButton } from './LogoutButton';

const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// 折れ線の色（globals.css の --color-brand-600 / 系統色を SVG に直接使う）。
const STATEMENT_COLOR = '#2563eb'; // brand-600
const ESSAY_COLOR = '#059669'; // emerald-600（青系と弁別）

export default function MyPage() {
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // AuthProvider は profile を mount 時 1 回しか取得しないため、webhook で
  // plan が basic に更新されても stale free cache のまま Free 表示になり得る。
  // /mypage 表示時と、タブ復帰（focus）時に profile を 1 回ずつ再取得して是正する。
  // retryProfile は useCallback(deps=[]) で安定参照のため deps に入れても再実行されず、
  // ループ・過剰 fetch にならない（mount 1 回 + focus ごと 1 回）。
  const { retryProfile } = useAuthDebug();
  useEffect(() => {
    void retryProfile();
    const onFocus = () => {
      void retryProfile();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [retryProfile]);

  const data: MypageData = useMemo(
    () => (isMounted ? loadMypageData() : EMPTY_MYPAGE_DATA),
    [isMounted],
  );

  const {
    header,
    summary,
    scoreTimeline,
    recentActivities,
    monthlyRanking,
    activeDayCount,
    monthlyActiveDayCount,
  } = data;

  // 全機能ゼロかつ診断もしていない真の初回ユーザー → 空状態画面
  const showEmptyState =
    isMounted &&
    summary.totalActivityCount === 0 &&
    summary.selfPRCount === 0 &&
    header.applicantType === null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 sm:py-10">
      <PageHeader
        title="マイページ"
        description={
          header.name
            ? `${header.name} さんの学習の積み重ね`
            : '学習の積み重ねとスコアの推移をひと目で。'
        }
      />

      {/* ── ログイン誘導（STEP-AUTH-P0） ───────────────────
          匿名 / メール未連携のときだけ表示。永続ユーザーには出さない。 */}
      <LoginNudge />

      {/* ── プロフィール小バナー ─────────────────────────── */}
      <ProfileBanner header={header} />

      {/* ── 課金情報カード (STEP-BILLING-05) ───────────────
          empty-state 分岐の外側に置く: 課金状態は活動有無に依存しないため、
          初回ユーザーでも Free / 契約導線が見える。 */}
      <BillingCard />

      {/* ── 今月の利用状況 (STEP-BILLING-07) ─────────────
          BillingCard と同じく empty-state の外。Free ユーザーには内部で
          自動的に何も描画されない。 */}
      <UsageStatusCard />

      {showEmptyState ? (
        <div className="mt-8">
          <EmptyState hasDiagnosis={header.applicantType !== null} />
        </div>
      ) : (
        <>
          {/* ── 上部：総活動回数 + 成長サマリー ───────────── */}
          <section className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <BigStatCard
              label="総活動回数"
              value={summary.totalActivityCount}
              unit="回"
              hint="志望理由書 / 小論文 / 自己分析 / 面接練習の合計"
            />
            <GrowthCard
              label="志望理由書"
              latest={summary.statementLatest}
              count={summary.statementCount}
              href="/statement"
              color={STATEMENT_COLOR}
            />
            <GrowthCard
              label="小論文"
              latest={summary.essayLatest}
              count={summary.essayReviewCount}
              href="/essay"
              color={ESSAY_COLOR}
            />
          </section>

          {/* ── 中部：折れ線グラフ ───────────────────────── */}
          <section className="mt-8 space-y-4">
            <h2 className="text-base font-semibold text-slate-800">スコア推移</h2>
            <ScoreLineChart
              title="志望理由書"
              points={scoreTimeline.statement}
              color={STATEMENT_COLOR}
              emptyHint={
                <>
                  まだ添削結果がありません。
                  <Link href="/statement" className="text-brand-600 hover:underline ml-1">
                    志望理由書を書く →
                  </Link>
                </>
              }
            />
            <ScoreLineChart
              title="小論文"
              points={scoreTimeline.essay}
              color={ESSAY_COLOR}
              emptyHint={
                <>
                  まだ添削結果がありません。
                  <Link href="/essay" className="text-brand-600 hover:underline ml-1">
                    小論文を練習する →
                  </Link>
                </>
              }
            />
          </section>

          {/* ── 下部：活動実績 ──────────────────────────── */}
          <section className="mt-10">
            <h2 className="text-base font-semibold text-slate-800 mb-3">活動実績</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CountTile
                label="自己分析"
                value={summary.selfAnalysisCount}
                href="/self-analysis"
              />
              <CountTile
                label="志望理由書"
                value={summary.statementCount}
                href="/statement"
              />
              <CountTile
                label="小論文"
                value={summary.essayReviewCount}
                href="/essay"
              />
              <CountTile
                label="面接練習"
                value={summary.interviewCount}
                href="/interview"
              />
            </div>
          </section>

          {/* ── 下部：今月のサマリー（活動日数 + ランキング） ── */}
          {/* 表示条件: 月内に 1 件以上活動があるとき。完全に 0 件のときは
              空のセクションを出さず（empty noise を避ける）、ユーザーに
              「今月も使った」感を侵さないために RecentList が「履歴ありません」
              メッセージを担当する。 */}
          {monthlyRanking.length > 0 && (
            <section className="mt-10">
              <h2 className="text-base font-semibold text-slate-800 mb-3">今月のサマリー</h2>
              <MonthlySummaryCard
                activeDayCount={activeDayCount}
                monthlyActiveDayCount={monthlyActiveDayCount}
                ranking={monthlyRanking}
              />
            </section>
          )}

          {/* ── 下部：最近の活動 ────────────────────────── */}
          <section className="mt-10">
            <h2 className="text-base font-semibold text-slate-800 mb-3">最近の活動</h2>
            <RecentList items={recentActivities} />
          </section>
        </>
      )}

      {/* ── 最下部：補助アクション（ログアウト） ──────────────
          設定系の補助操作のため、誤タップを避けてページ最下部に控えめに配置。
          empty-state 分岐の外側に置き、活動有無に関わらず常に表示する。 */}
      <LogoutButton />
    </div>
  );
}

// ── サブコンポーネント ─────────────────────────────────────────────

function ProfileBanner({ header }: { header: MypageData['header'] }) {
  if (!header.grade && !header.applicantType) return null;
  return (
    <Card variant="soft" padding="sm" className="mt-4">
      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
        {header.grade && (
          <span className="inline-flex items-center gap-1">
            <span className="text-slate-500">学年:</span>
            <span className="font-medium">{header.grade}</span>
          </span>
        )}
        {header.applicantType !== null && (
          /* FREEZE(legacy-diagnosis): 受験タイプ値の表示は残すが、/diagnosis への
             リンクは凍結中のため非ナビゲーション化（プレーン表示に変更）。 */
          <span className="inline-flex items-center gap-1 text-slate-700">
            <span className="text-slate-500">受験タイプ:</span>
            <span className="font-medium">{header.applicantTypeLabel}</span>
          </span>
        )}
      </div>
    </Card>
  );
}

function BigStatCard({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: number;
  unit: string;
  hint: string;
}) {
  return (
    <Card padding="md">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="text-3xl sm:text-4xl font-bold text-slate-900">
          {value}
        </span>
        <span className="text-sm text-slate-500">{unit}</span>
      </p>
      <p className="mt-2 text-xs text-slate-500 leading-relaxed">{hint}</p>
    </Card>
  );
}

function GrowthCard({
  label,
  latest,
  count,
  href,
  color,
}: {
  label: string;
  latest: { total: number; delta: number | null } | null;
  count: number;
  href: string;
  color: string;
}) {
  if (!latest) {
    return (
      <Card padding="md">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-300">—</p>
        <Link
          href={href}
          className="mt-2 inline-block text-xs text-brand-600 hover:underline"
        >
          スコアを記録する →
        </Link>
      </Card>
    );
  }

  return (
    <Card padding="md">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl sm:text-4xl font-bold text-slate-900">
          {latest.total}
        </span>
        <span className="text-sm text-slate-500">点</span>
        {latest.delta !== null && (
          <DeltaBadge delta={latest.delta} color={color} />
        )}
      </p>
      {/* 履歴回数表示。delta が null（1 件のみ）の場合も "1回実施" として明示。
          delta と count は意味が異なる: delta はスコア成長量、count は履歴件数。 */}
      <p className="mt-1.5 text-xs text-slate-500">
        {count}回実施
        {latest.delta === null && (
          <span className="ml-1 text-slate-400">
            ・もう一度書くと推移が見えます
          </span>
        )}
      </p>
    </Card>
  );
}

function DeltaBadge({ delta, color }: { delta: number; color: string }) {
  if (delta === 0) {
    return <span className="text-sm text-slate-500">±0</span>;
  }
  const sign = delta > 0 ? '+' : '';
  const isPositive = delta > 0;
  return (
    <span
      className="text-sm font-semibold"
      style={{ color: isPositive ? color : '#dc2626' }}
    >
      ({sign}
      {delta})
    </span>
  );
}

function CountTile({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3 hover:ring-brand-200 hover:bg-brand-50 transition-colors"
    >
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-900">{value}</span>
        <span className="text-xs text-slate-500">回</span>
      </p>
    </Link>
  );
}

function MonthlySummaryCard({
  activeDayCount,
  monthlyActiveDayCount,
  ranking,
}: {
  activeDayCount: number;
  monthlyActiveDayCount: number;
  ranking: MonthlyRankingItem[];
}) {
  // 順位メダル（テキストのみ。装飾の絵文字依存を最小化）。
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <Card padding="md">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 mb-4">
        <Stat label="今月の活動日数" value={monthlyActiveDayCount} unit="日" />
        <Stat label="累計の活動日数" value={activeDayCount} unit="日" />
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-2">
          🏆 今月よく取り組んだ機能
        </p>
        <ol className="space-y-1.5">
          {ranking.map((item, i) => (
            <li
              key={item.feature}
              className="flex items-center justify-between text-sm"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-base" aria-hidden>
                  {medals[i] ?? '・'}
                </span>
                <span className="text-slate-700">{item.label}</span>
              </span>
              <span className="text-slate-500 text-xs whitespace-nowrap">
                {item.count}回
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <span className="inline-flex flex-col">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="flex items-baseline gap-0.5">
        <span className="text-xl font-bold text-slate-900">{value}</span>
        <span className="text-xs text-slate-500">{unit}</span>
      </span>
    </span>
  );
}

function RecentList({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return (
      <Card padding="md">
        <p className="text-sm text-slate-500">
          活動履歴はまだありません。各機能を使うとここに記録されます。
        </p>
      </Card>
    );
  }

  return (
    <Card padding="none">
      <ul className="divide-y divide-slate-100">
        {items.map((item, i) => (
          <li
            key={`${item.feature}-${item.date}-${i}`}
            className="flex items-center justify-between px-4 sm:px-5 py-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`inline-flex items-center justify-center w-2 h-2 rounded-full ${featureDotClass(item.feature)} shrink-0`}
              />
              <span className="text-sm text-slate-700 truncate">
                {item.label}
                {/* detail は既存 storage から取れる場合のみ。スコア "57点" /
                    "タイプ 2" / "AI評価あり" 等。undefined の活動はラベル素のまま。 */}
                {item.detail && (
                  <span className="ml-1.5 text-slate-500 text-xs">
                    （{item.detail}）
                  </span>
                )}
              </span>
            </div>
            <span className="text-xs text-slate-500 whitespace-nowrap">
              {formatShortDate(item.date)}
            </span>
          </li>
        ))}
      </ul>
      <div className="px-4 sm:px-5 py-3 border-t border-slate-100">
        <LinkButton href="/home" variant="secondary" size="sm">
          ホームへ戻る
        </LinkButton>
      </div>
    </Card>
  );
}

function featureDotClass(feature: RecentActivityItem['feature']): string {
  switch (feature) {
    case 'statement':
      return 'bg-brand-500';
    case 'essay':
      return 'bg-emerald-500';
    case 'interview':
      return 'bg-amber-500';
    case 'selfAnalysis':
      return 'bg-violet-500';
    case 'selfPR':
      return 'bg-pink-500';
    case 'diagnosis':
      return 'bg-accent-500';
    case 'matching':
      return 'bg-cyan-500';
    default:
      return 'bg-slate-400';
  }
}

function formatShortDate(iso: string): string {
  if (iso.length < 10) return '';
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (!Number.isFinite(m) || !Number.isFinite(d)) return '';
  return `${m}/${d}`;
}
