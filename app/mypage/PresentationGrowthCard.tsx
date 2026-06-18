'use client';

/**
 * マイページ「プレゼン成長レポート」カード。
 *
 * 役割分担:
 *   - マイページ = 成長サマリ（「前回より良くなった」を見せる）。詳細は /presentation/history。
 *   - DB 変更・API 追加・AI 評価ロジック変更・課金/usage 消費なし。
 *     本人の evaluated attempt（presentation_results）を client が RLS owner SELECT で直読みし、
 *     lib/presentation/growthReport.ts で数値化・差分計算する（PresentationHistoryClient と同パターン）。
 *
 * 表示条件:
 *   - Premium ユーザー（plan === 'premium' or QA バイパス）のみ。それ以外は何も描画しない。
 *   - evaluated result が 1 件以上 → 成長レポート。0 件 → 空状態（練習導線）。
 *   - 取得失敗 → カード内にエラー文言（マイページ全体は壊さない）。
 */

import { useEffect, useRef, useState } from 'react';

import { useProfile } from '@/app/components/AuthProvider';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';
import {
  buildPresentationGrowthReport,
  formatAverage,
  formatCategoryDelta,
  formatDelta,
  type PresentationGrowthEntry,
  type PresentationGrowthReport,
} from '@/lib/presentation/growthReport';
import { getBrowserSupabaseClient } from '@/lib/supabase/browserClient';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'ready'; report: PresentationGrowthReport };

const SCORE_MAX = 3;

export function PresentationGrowthCard() {
  const profile = useProfile();
  const isPremium =
    profile !== null && (profile.plan === 'premium' || profile.isQaUser);

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  // 累計Q&A回答数（永続化済み presentation_qa_reviews の本人分件数）。補助指標のため
  // 取得失敗しても 0 とし、カード全体は落とさない。
  const [qaCount, setQaCount] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    // Premium 以外は fetch しない（描画もしない）。
    if (!isPremium) return;

    cancelledRef.current = false;

    async function load() {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) {
        if (!cancelledRef.current) setState({ kind: 'error' });
        return;
      }

      // evaluated attempt（RLS owner SELECT で本人分のみ）。
      const { data: attempts, error: attemptsErr } = await supabase
        .from('presentation_attempts')
        .select('id, status, created_at');
      if (cancelledRef.current) return;
      if (attemptsErr) {
        setState({ kind: 'error' });
        return;
      }

      // results（本人分）→ attempt_id でマップ化。
      const { data: results, error: resultsErr } = await supabase
        .from('presentation_results')
        .select('attempt_id, categories, created_at');
      if (cancelledRef.current) return;
      if (resultsErr) {
        setState({ kind: 'error' });
        return;
      }

      const resultMap = new Map<string, Record<string, unknown>>();
      for (const r of results ?? []) {
        const cats =
          r.categories && typeof r.categories === 'object'
            ? (r.categories as Record<string, unknown>)
            : {};
        resultMap.set(r.attempt_id as string, cats);
      }

      // result を持つ evaluated attempt のみを集計対象にする。
      const entries: PresentationGrowthEntry[] = [];
      for (const a of attempts ?? []) {
        if (a.status !== 'evaluated') continue;
        const categories = resultMap.get(a.id as string);
        if (!categories) continue;
        entries.push({
          createdAt: (a.created_at as string) ?? '',
          categories,
        });
      }

      // 累計Q&A回答数（RLS owner SELECT で本人分のみ。head+count で件数だけ取得）。
      const { count: qaTotal } = await supabase
        .from('presentation_qa_reviews')
        .select('id', { count: 'exact', head: true });
      if (cancelledRef.current) return;
      setQaCount(qaTotal ?? 0);

      const report = buildPresentationGrowthReport(entries);
      if (cancelledRef.current) return;
      setState(report ? { kind: 'ready', report } : { kind: 'empty' });
    }

    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [isPremium]);

  if (!isPremium) return null;

  return (
    <Card padding="md" className="mt-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-bold text-slate-800">プレゼン成長レポート</h2>
        {state.kind === 'ready' && (
          <span className="text-xs text-slate-500">練習の目安</span>
        )}
      </div>
      <CardBody state={state} qaCount={qaCount} />
    </Card>
  );
}

function CardBody({ state, qaCount }: { state: LoadState; qaCount: number }) {
  if (state.kind === 'loading') {
    return <p className="text-sm text-slate-500">読み込み中…</p>;
  }

  if (state.kind === 'error') {
    return (
      <p className="text-sm text-slate-500">
        プレゼン成長レポートを読み込めませんでした
      </p>
    );
  }

  if (state.kind === 'empty') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600 leading-relaxed">
          まだプレゼン評価の記録がありません。録画練習をすると、ここに成長レポートが表示されます。
        </p>
        <LinkButton href="/presentation/university" variant="primary" size="sm">
          プレゼン練習を始める
        </LinkButton>
      </div>
    );
  }

  return <ReportBody report={state.report} qaCount={qaCount} />;
}

function ReportBody({
  report,
  qaCount,
}: {
  report: PresentationGrowthReport;
  qaCount: number;
}) {
  return (
    <div className="space-y-5">
      {/* ── サマリ数値 ─────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <Metric label="累計練習回数" value={`${report.attemptCount} 回`} />
        <Metric
          label="現在の平均"
          value={`${formatAverage(report.latestAverage)} / ${SCORE_MAX.toFixed(1)}`}
        />
        <Metric label="累計Q&A回答数" value={`${qaCount} 件`} />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
        <span className="text-slate-600">
          初回から{' '}
          <span
            className={`font-semibold ${deltaColor(report.delta)}`}
          >
            {formatDelta(report.delta)}
          </span>
        </span>
        {report.mostImproved && (
          <span className="text-slate-600">
            一番伸びた項目:{' '}
            <span className="font-semibold text-slate-800">
              {report.mostImproved.label}{' '}
              <span className={deltaColor(report.mostImproved.delta)}>
                {formatCategoryDelta(report.mostImproved.delta)}
              </span>
            </span>
          </span>
        )}
      </div>

      {report.nextFocus && (
        <p className="text-sm text-slate-600">
          次に伸ばすべき項目:{' '}
          <span className="font-semibold text-slate-800">
            {report.nextFocus.label}
          </span>
        </p>
      )}

      {/* ── 直近 3 回の推移（CSS バー） ─────────────── */}
      {report.recentTrend.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">直近の推移</p>
          <ul className="space-y-1.5">
            {report.recentTrend.map((pt) => (
              <li key={pt.index} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-slate-500">
                  {pt.index}回目
                </span>
                <span
                  className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden"
                  aria-hidden
                >
                  <span
                    className="block h-full rounded-full bg-brand-500"
                    style={{
                      width: `${Math.min(pt.average / SCORE_MAX, 1) * 100}%`,
                    }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right text-xs font-medium text-slate-700">
                  {formatAverage(pt.average)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-slate-400 leading-relaxed">
        スコアは weak/normal/strong を 1〜3 に換算した練習の目安です（厳密な成績ではありません）。
      </p>

      <div className="pt-1">
        <LinkButton href="/presentation/history" variant="secondary" size="sm">
          詳しい履歴を見る
        </LinkButton>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}

function deltaColor(delta: number): string {
  if (delta > 0) return 'text-emerald-600';
  if (delta < 0) return 'text-red-600';
  return 'text-slate-500';
}
