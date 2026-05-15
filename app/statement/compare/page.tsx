'use client';

// STEP 33: ハードコード CURRENT_EVALUATIONS は撤去。
// 保存済み正規化スコアを lib/statementScoreSource から取り、再計算は一切しない。

import { useState, useEffect } from 'react';
import { StepHeader } from '@/components/StatementFlow/StepHeader';
import { LinkButton } from '@/components/ui/LinkButton';
import { ComparisonSummary } from '@/components/PassLineComparison/ComparisonSummary';
import { ComparisonBarCard } from '@/components/PassLineComparison/ComparisonBarCard';
import { TopGapList } from '@/components/PassLineComparison/TopGapList';
import {
  getPassLineComparison,
  getTopImprovementTargets,
} from '@/lib/passLineComparison';
import {
  getLatestStatementScore,
  breakdownToPassLineItems,
} from '@/lib/statement/score/statementScoreSource';
import type { StatementScoreResult } from '@/lib/statement/score/statementScore';

export default function StatementComparePage() {
  const [score, setScore] = useState<StatementScoreResult | null>(null);
  const [mounted, setMounted] = useState(false);

  // localStorage は SSR で読めないため、マウント後に1回だけ読み込む。
  // hydration mismatch を避けるための既存パターン（edit/page.tsx も同様）。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScore(getLatestStatementScore());
    setMounted(true);
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 pb-28 sm:pb-12">
      <StepHeader
        currentStep={3}
        totalSteps={5}
        title="合格ライン目安と比べる"
        description="これは実在の合格者データではなく、志望理由書の完成度を高めるための目安です。今の文章で優先的に伸ばすべき点を確認しましょう。"
        backHref="/statement/score"
        nextHref="/statement/improve"
        nextLabel="改善ポイントを選ぶ"
      />

      {mounted && !score && <NoReviewYet />}

      {mounted && score && <CompareView score={score} />}

      <div className="fixed bottom-0 inset-x-0 sm:static bg-white sm:bg-transparent border-t sm:border-none border-gray-200 px-4 py-3 sm:p-0 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] sm:shadow-none">
        <div className="max-w-4xl mx-auto">
          <LinkButton
            href="/statement/improve"
            variant="primary"
            size="lg"
            className="w-full"
          >
            改善ポイントを選ぶ →
          </LinkButton>
          <p className="text-xs text-slate-400 text-center mt-2 hidden sm:block">
            次のステップ：どこから直すかを決めます
          </p>
        </div>
      </div>
    </div>
  );
}

function NoReviewYet() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 sm:p-8 text-center my-6">
      <p className="text-base font-bold text-amber-800 mb-2">添削履歴がまだありません</p>
      <p className="text-sm text-amber-700 leading-relaxed mb-5">
        先に AI 添削を実行すると、合格ライン目安との差分を確認できます。
      </p>
      <LinkButton href="/statement/edit" variant="primary" size="md">
        添削画面へ移動 →
      </LinkButton>
    </div>
  );
}

function CompareView({ score }: { score: StatementScoreResult }) {
  const items = breakdownToPassLineItems(score.breakdown);
  const results = getPassLineComparison(items);
  const topGaps = getTopImprovementTargets(results, 2);

  return (
    <>
      <section className="mb-4">
        <ComparisonSummary currentTotal={score.total} />
      </section>

      <section className="mb-6">
        <TopGapList items={topGaps} />
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-slate-700 mb-3 px-1">
          評価軸ごとの差分
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {results.map((r) => (
            <ComparisonBarCard key={r.id} result={r} />
          ))}
        </div>
      </section>
    </>
  );
}
