'use client';

// 最終評価レポート（プレゼン + Q&A の締め）。result 画面の最後に表示する。
// /api/presentation/qa の final-report アクションに接続。
//   - マウント時に presentation_results.final_report（RLS owner SELECT）から復元。
//   - Q&A が 5 問完了（ready）かつ未生成なら 1 度だけ自動生成（サーバ側で冪等＝再課金しない）。
//   - 総合スコア/ランク/各項目スコア/良かった点/改善点/プレゼン・Q&Aレビュー/最終総評/改善プラン/合格可能性。

import { useCallback, useEffect, useRef, useState } from 'react';

import { getBrowserSupabaseClient } from '@/lib/supabase/browserClient';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

type Improvement = { point: string; reason: string };
type PlanItem = { priority: number; title: string; today: string; tomorrow: string };

type FinalReport = {
  totalScore: number;
  rank: string;
  categoryScores: Record<string, number>;
  goodPoints: string[];
  improvements: Improvement[];
  presentationReview: string;
  qaReview: string;
  finalComment: string;
  improvementPlan: PlanItem[];
  passProbabilityStars: number;
  passProbabilityNote: string;
};

const SCORE_DIMENSIONS: { key: string; label: string }[] = [
  { key: 'themeUnderstanding', label: 'テーマ理解' },
  { key: 'logicalStructure', label: '論理構成' },
  { key: 'depth', label: '内容の深さ' },
  { key: 'persuasion', label: '説得力' },
  { key: 'concreteExample', label: '具体例' },
  { key: 'timeManagement', label: '時間配分' },
  { key: 'delivery', label: '話し方' },
  { key: 'qaHandling', label: 'Q&A対応力' },
];

const RANK_CLASS: Record<string, string> = {
  S: 'bg-violet-100 text-violet-800 ring-violet-300',
  A: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  B: 'bg-blue-100 text-blue-800 ring-blue-300',
  C: 'bg-amber-100 text-amber-800 ring-amber-300',
  D: 'bg-slate-200 text-slate-700 ring-slate-300',
};

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function parseReport(v: unknown): FinalReport {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const cats =
    o.categoryScores && typeof o.categoryScores === 'object'
      ? (o.categoryScores as Record<string, unknown>)
      : {};
  const categoryScores: Record<string, number> = {};
  for (const { key } of SCORE_DIMENSIONS) categoryScores[key] = num(cats[key]);

  const improvements = Array.isArray(o.improvements)
    ? o.improvements
        .map((it) => {
          const x = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
          return {
            point: typeof x.point === 'string' ? x.point : '',
            reason: typeof x.reason === 'string' ? x.reason : '',
          };
        })
        .filter((x) => x.point)
    : [];

  const improvementPlan = Array.isArray(o.improvementPlan)
    ? o.improvementPlan
        .map((it, i) => {
          const x = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
          return {
            priority: typeof x.priority === 'number' ? x.priority : i + 1,
            title: typeof x.title === 'string' ? x.title : '',
            today: typeof x.today === 'string' ? x.today : '',
            tomorrow: typeof x.tomorrow === 'string' ? x.tomorrow : '',
          };
        })
        .filter((x) => x.title)
    : [];

  const rank = typeof o.rank === 'string' ? o.rank : '';
  return {
    totalScore: num(o.totalScore),
    rank,
    categoryScores,
    goodPoints: strArr(o.goodPoints),
    improvements,
    presentationReview:
      typeof o.presentationReview === 'string' ? o.presentationReview : '',
    qaReview: typeof o.qaReview === 'string' ? o.qaReview : '',
    finalComment: typeof o.finalComment === 'string' ? o.finalComment : '',
    improvementPlan,
    passProbabilityStars: Math.max(0, Math.min(5, Math.round(num(o.passProbabilityStars)))),
    passProbabilityNote:
      typeof o.passProbabilityNote === 'string' ? o.passProbabilityNote : '',
  };
}

export function PresentationFinalReport({
  attemptId,
  ready,
}: {
  attemptId: string;
  ready: boolean;
}) {
  const [report, setReport] = useState<FinalReport | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [loaded, setLoaded] = useState(false);
  // 自動生成を 1 回だけに抑えるガード（再レンダ・StrictMode 二重実行の重複生成防止）。
  const startedRef = useRef(false);

  // マウント時: 保存済みの最終レポートを復元（列未適用・未保存は null）。
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) {
        if (!cancelled) setLoaded(true);
        return;
      }
      const { data } = await supabase
        .from('presentation_results')
        .select('final_report')
        .eq('attempt_id', attemptId)
        .maybeSingle();
      if (cancelled) return;
      if (data?.final_report) {
        setReport(parseReport(data.final_report));
        startedRef.current = true;
      }
      setLoaded(true);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  const runReport = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/presentation/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempt_id: attemptId, action: 'final-report' }),
      });
      if (!res.ok) {
        setStatus('error');
        return;
      }
      const json = (await res.json()) as { report?: unknown };
      if (!json.report) {
        setStatus('error');
        return;
      }
      setReport(parseReport(json.report));
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, [attemptId]);

  // Q&A 5 問完了かつ未取得なら 1 度だけ自動生成。
  useEffect(() => {
    if (!loaded || !ready || report || startedRef.current) return;
    startedRef.current = true;
    void runReport();
  }, [loaded, ready, report, runReport]);

  if (!ready || !loaded) return null;

  if (!report) {
    if (status === 'loading') {
      return (
        <Card padding="lg">
          <FinalReportHeader />
          <p className="mt-3 flex items-center gap-2 text-sm font-medium text-indigo-700">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-indigo-600" />
            最終評価レポートを作成しています…
          </p>
        </Card>
      );
    }
    if (status === 'error') {
      return (
        <Card padding="lg" className="space-y-3">
          <FinalReportHeader />
          <AlertBox variant="warning">最終評価レポートの作成に失敗しました。</AlertBox>
          <Button variant="secondary" size="sm" onClick={() => void runReport()}>
            最終評価レポートを再作成する
          </Button>
        </Card>
      );
    }
    return null;
  }

  const rankClass = RANK_CLASS[report.rank] ?? RANK_CLASS.C;

  return (
    <Card padding="lg" className="space-y-6 border-2 border-indigo-200">
      <FinalReportHeader />

      {/* ① 総合スコア + ランク */}
      <div className="flex flex-wrap items-center justify-center gap-6 rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 p-5">
        <div className="text-center">
          <p className="text-xs font-semibold text-slate-500">総合評価</p>
          <p className="text-4xl font-extrabold text-slate-900">
            {report.totalScore}
            <span className="text-lg font-bold text-slate-400"> / 100</span>
          </p>
        </div>
        <div
          className={`flex h-16 w-16 items-center justify-center rounded-full text-3xl font-extrabold ring-2 ${rankClass}`}
        >
          {report.rank || '—'}
        </div>
      </div>

      {/* ② 各項目スコア */}
      <section className="space-y-2">
        <h4 className="text-sm font-bold text-slate-800">項目別スコア</h4>
        <div className="space-y-2">
          {SCORE_DIMENSIONS.map(({ key, label }) => (
            <ScoreBar key={key} label={label} score={report.categoryScores[key] ?? 0} />
          ))}
        </div>
      </section>

      {/* ③ 良かった点 */}
      <GoodPointsSection items={report.goodPoints} />

      {/* ④ 改善点（重要度順 + なぜ上がるか） */}
      {report.improvements.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-sm font-bold text-slate-800">改善点（重要度順）</h4>
          <ol className="space-y-2">
            {report.improvements.map((imp, i) => (
              <li
                key={i}
                className="rounded-lg border border-amber-200 bg-amber-50/60 p-3"
              >
                <p className="text-sm font-semibold text-slate-800">
                  {i + 1}. {imp.point}
                </p>
                {imp.reason && (
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    <span className="font-medium text-amber-700">改善すると: </span>
                    {imp.reason}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ⑤ プレゼン内容レビュー */}
      {report.presentationReview && (
        <TextSection title="プレゼン内容レビュー" text={report.presentationReview} />
      )}

      {/* ⑥ Q&Aレビュー */}
      {report.qaReview && <TextSection title="Q&Aレビュー" text={report.qaReview} />}

      {/* ⑦ 最終総評 */}
      {report.finalComment && (
        <section className="space-y-1 rounded-lg bg-slate-50 p-4">
          <h4 className="text-sm font-bold text-slate-800">最終総評</h4>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {report.finalComment}
          </p>
        </section>
      )}

      {/* ⑧ 次回までの改善プラン */}
      {report.improvementPlan.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-sm font-bold text-slate-800">次回までの改善プラン</h4>
          <div className="space-y-2">
            {report.improvementPlan.map((p, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                    {p.priority}
                  </span>
                  {p.title}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <p className="rounded-md bg-indigo-50 p-2 text-xs leading-relaxed text-slate-700">
                    <span className="font-semibold text-indigo-700">今日: </span>
                    {p.today}
                  </p>
                  <p className="rounded-md bg-slate-100 p-2 text-xs leading-relaxed text-slate-700">
                    <span className="font-semibold text-slate-600">明日: </span>
                    {p.tomorrow}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ⑨ 合格可能性（参考） */}
      <section className="space-y-1 rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-800">合格可能性（参考）</h4>
          <span className="text-lg tracking-widest text-amber-500">
            {'★'.repeat(report.passProbabilityStars)}
            <span className="text-slate-300">
              {'★'.repeat(5 - report.passProbabilityStars)}
            </span>
          </span>
        </div>
        {report.passProbabilityNote && (
          <p className="text-xs leading-relaxed text-slate-600">
            {report.passProbabilityNote}
          </p>
        )}
        <p className="text-[11px] text-slate-400">
          ※ 合否を断定するものではなく、現状の目安としての参考評価です。
        </p>
      </section>
    </Card>
  );
}

function FinalReportHeader() {
  return (
    <div className="text-center">
      <p className="text-xs font-semibold tracking-widest text-indigo-500">
        ★★★★★★★★
      </p>
      <h3 className="text-lg font-extrabold text-slate-900">最終評価レポート</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        プレゼンと Q&A を総合した、面接官視点の評価レポートです。
      </p>
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const barColor =
    pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-indigo-500' : 'bg-amber-500';
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-xs text-slate-600">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right text-sm font-bold text-slate-800">
        {score}点
      </span>
    </div>
  );
}

function GoodPointsSection({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-bold text-slate-800">良かった点</h4>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li
            key={i}
            className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-sm leading-relaxed text-slate-700"
          >
            <span className="text-emerald-600">✓</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TextSection({ title, text }: { title: string; text: string }) {
  return (
    <section className="space-y-1">
      <h4 className="text-sm font-bold text-slate-800">{title}</h4>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
        {text}
      </p>
    </section>
  );
}
