'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadAnalyzeState } from '@/lib/analyzeStorage';
import { loadSelfPRs } from '@/lib/selfPRStorage';

// hub と同形 mount gate。SSR では snapshot=null（"読み込み中..." だけ出す）にし、
// hydration 後に client で localStorage を読んで再 render する。
// useSyncExternalStore は state を持たない（subscribe は no-op）ので
// 「mount したか」フラグだけを SSR-safe に提供する役割。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

type Snapshot = {
  // analyzeState.analysis (= WallHittingResult) の有無。
  hasAnalysis: boolean;
  // analyzeState.summary (= SummaryResult) の有無。
  // MVP では summary の存在を「結果として表示可能」の基準にする。
  hasSummary: boolean;
  // selfPRs[] の件数（添削履歴）。
  prCount: number;
};

export default function ResultListPage() {
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // STEP-RESULT-1 MVP: analyzeState は配列化されておらず単一エントリのみ。
  // よって「直近 1 件」= 現在保存中の analyzeState を指す。
  // 保存済みデータを読むだけで、API / hash cache / Supabase には触らない。
  const snapshot: Snapshot | null = useMemo(() => {
    if (!isMounted) return null;
    const state = loadAnalyzeState();
    return {
      hasAnalysis: !!state?.analysis,
      hasSummary: !!state?.summary,
      prCount: loadSelfPRs().length,
    };
  }, [isMounted]);

  const hasResult = snapshot !== null && snapshot.hasSummary;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="mb-4">
        <Link
          href="/self-analysis"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
        >
          ← 自己分析機能一覧に戻る
        </Link>
      </div>

      <PageHeader
        title="結果ログ"
        description="保存済みの自己分析結果を確認できます。"
      />

      {/* mount 前は empty/ready の判定ができないため neutral 表示。
          render 切り替えは isMounted 経由のみで決定し、SSR/CSR の差分を出さない。*/}
      {!snapshot && <p className="text-sm text-slate-400">読み込み中...</p>}

      {snapshot && !hasResult && <EmptyState />}

      {snapshot && hasResult && <ResultCard snapshot={snapshot} />}
    </div>
  );
}

function ResultCard({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Card variant="default" padding="md">
      <h2 className="text-base font-bold text-slate-800 mb-4">直近の自己分析結果</h2>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatusItem
          label="活動整理"
          value={snapshot.hasAnalysis ? 'あり' : 'なし'}
          highlight={snapshot.hasAnalysis}
        />
        <StatusItem
          label="深掘りまとめ"
          value={snapshot.hasSummary ? 'あり' : 'なし'}
          highlight={snapshot.hasSummary}
        />
        <StatusItem
          label="自己PR添削"
          value={snapshot.prCount > 0 ? `${snapshot.prCount}件` : 'なし'}
          highlight={snapshot.prCount > 0}
        />
      </div>
      {/* STEP-RESULT-1 では一覧 → 詳細リンクの "形" だけ用意する。
          /self-analysis/result/current の実体は STEP-RESULT-2 で実装。
          それまでは Next.js の標準 404 に着地する（保存データには影響しない）。*/}
      <Link
        href="/self-analysis/result/current"
        className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg text-sm transition-colors"
      >
        結果を詳しく見る →
      </Link>
    </Card>
  );
}

function StatusItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-500 mb-0.5">{label}</p>
      <p
        className={`text-sm font-semibold truncate ${
          highlight ? 'text-slate-800' : 'text-slate-400'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16">
      <p className="text-gray-400 text-base mb-8">
        まだ表示できる自己分析結果がありません
      </p>
      <div className="flex flex-col items-center gap-3 max-w-sm mx-auto">
        {/* /self-analysis/run へ直接遷移。analyzeState が未保存なら自然に confirm 起点。
            STEP-NAV-1 でカード①が担う step リセットはここでは行わない
            （result ページは "保存済みデータを読むだけ" を守るため localStorage に書かない）。*/}
        <Link
          href="/self-analysis/run"
          className="w-full inline-block text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
        >
          0から自己PRを書く
        </Link>
        <Link
          href="/self-analysis"
          className="w-full inline-block text-center border border-blue-300 text-blue-600 hover:bg-blue-50 font-semibold px-8 py-3 rounded-lg text-base transition-colors"
        >
          自己分析トップに戻る
        </Link>
      </div>
    </div>
  );
}
