'use client';

// STEP 33: ハードコード CURRENT_EVALUATIONS は撤去。
// 保存済み正規化スコアを lib/statementScoreSource から取って改善提案に渡す。

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { StepHeader } from '@/components/StatementFlow/StepHeader';
import { Card } from '@/components/ui/Card';
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
      {mounted && score && (
        <StepHeader
          currentStep={4}
          totalSteps={5}
          title="どこから直すか決める"
          description="優先順位の高い項目から改善していきましょう。各カードから個別に書き直しに進めます。"
          backHref="/statement/compare"
        />
      )}

      {mounted && !score && <NoImproveYet />}

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

// /statement Entry の④「書き直す」は score なしで disabled なので、通常導線では到達しない。
// 直リンク・ブラウザ履歴・将来の導線変更で来た users に対する着地点。
// 「書き直す」は重い作業モードなので、empty では作業させず ③「今のスコアを見る」へ戻す。
function NoImproveYet() {
  return (
    <Card variant="soft" padding="lg" className="text-center mt-2 sm:mt-4">
      <h2 className="text-lg sm:text-xl font-bold text-slate-900 mb-3">
        まだ書き直す内容はありません
      </h2>
      <p className="text-sm text-slate-600 leading-relaxed mb-6 max-w-md mx-auto">
        志望理由書を書いてスコアを見ると、ここで直す部分を選べます。
      </p>
      <LinkButton
        href="/statement/score"
        variant="primary"
        size="md"
        className="w-full sm:w-auto"
      >
        今のスコアを見る
      </LinkButton>
      <div className="mt-4 flex flex-col items-center gap-1.5">
        <Link
          href="/statement/edit"
          className="text-sm text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-slate-700"
        >
          志望理由書を書く
        </Link>
        <Link
          href="/statement"
          className="text-sm text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-slate-700"
        >
          志望理由書TOPに戻る
        </Link>
      </div>
    </Card>
  );
}
