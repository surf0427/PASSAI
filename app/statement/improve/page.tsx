'use client';

// STEP 33: ハードコード CURRENT_EVALUATIONS は撤去。
// 保存済み正規化スコアを lib/statementScoreSource から取って改善提案に渡す。

import { useState, useEffect } from 'react';
import { StepHeader } from '@/components/StatementFlow/StepHeader';
import { LinkButton } from '@/components/ui/LinkButton';
import { ImprovementCard } from '@/components/ImprovementGuide/ImprovementCard';
import { PriorityNote } from '@/components/ImprovementGuide/PriorityNote';
import { getImprovementSuggestions } from '@/lib/improvementSuggestions';
import {
  getLatestStatementScore,
  breakdownToPassLineItems,
} from '@/lib/statement/score/statementScoreSource';
import type { StatementScoreResult } from '@/lib/statement/score/statementScore';

export default function StatementImprovePage() {
  const [score, setScore] = useState<StatementScoreResult | null>(null);
  const [mounted, setMounted] = useState(false);

  // localStorage は SSR で読めないため、マウント後に1回だけ読み込む。
  // hydration mismatch を避けるための既存パターン（edit/page.tsx も同様）。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScore(getLatestStatementScore());
    setMounted(true);
  }, []);

  const suggestions = score
    ? getImprovementSuggestions(breakdownToPassLineItems(score.breakdown), 2)
    : [];
  const topPriority = suggestions[0];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 pb-28 sm:pb-12">
      <StepHeader
        currentStep={4}
        totalSteps={5}
        title="どこから直すか決める"
        description="優先順位の高い項目から改善していきましょう。各カードから個別に書き直しに進めます。"
        backHref="/statement/compare"
      />

      {mounted && !score && <NoReviewYet />}

      {mounted && score && (
        <>
          <section className="mb-6">
            <PriorityNote />
          </section>

          <section className="space-y-4 mb-8">
            {suggestions.length === 0 ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
                <p className="text-base font-bold text-emerald-700 mb-2">
                  ✓ すべての項目が合格ライン目安に到達しています
                </p>
                <p className="text-sm text-emerald-600 leading-relaxed">
                  さらに磨きたい場合は、各項目を見直してみましょう。
                </p>
              </div>
            ) : (
              suggestions.map((s, i) => (
                <ImprovementCard key={s.id} suggestion={s} rank={i + 1} />
              ))
            )}
          </section>
        </>
      )}

      {topPriority && (
        <div className="fixed bottom-0 inset-x-0 sm:hidden bg-white border-t border-gray-200 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
          <div className="max-w-4xl mx-auto">
            <LinkButton
              href={topPriority.route}
              variant="primary"
              size="lg"
              className="w-full"
            >
              最優先：{topPriority.label}から改善する →
            </LinkButton>
          </div>
        </div>
      )}
    </div>
  );
}

function NoReviewYet() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 sm:p-8 text-center my-6">
      <p className="text-base font-bold text-amber-800 mb-2">添削履歴がまだありません</p>
      <p className="text-sm text-amber-700 leading-relaxed mb-5">
        先に AI 添削を実行すると、改善優先度の高いポイントが提案されます。
      </p>
      <LinkButton href="/statement/edit" variant="primary" size="md">
        添削画面へ移動 →
      </LinkButton>
    </div>
  );
}
