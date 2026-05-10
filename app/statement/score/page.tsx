'use client';

// STEP 33: 「保存済み正規化スコアを表示するだけ」に統一。
// ハードコード EVALUATIONS は撤去し、lib/statementScoreSource から取得する。

import { useState, useEffect } from 'react';
import { StepHeader } from '@/components/StatementFlow/StepHeader';
import { LinkButton } from '@/components/ui/LinkButton';
import { TotalScoreCard } from '@/components/ScoreDashboard/TotalScoreCard';
import { RankBadge } from '@/components/ScoreDashboard/RankBadge';
import { ScoreBarCard } from '@/components/ScoreDashboard/ScoreBarCard';
import { RadarSummary } from '@/components/ScoreDashboard/RadarSummary';
import { ImprovementPriority } from '@/components/ScoreDashboard/ImprovementPriority';
import { DashboardSummary } from '@/components/ScoreDashboard/DashboardSummary';
import { getImprovementPriority } from '@/lib/scoreRank';
import {
  getLatestStatementScore,
  breakdownToRankItems,
} from '@/lib/statementScoreSource';
import type { StatementScoreResult } from '@/lib/statementScore';

// 各軸の説明テキストはスコアに依存しない汎用説明にする（旧版はハードコードスコア前提だった）。
const AXIS_DESCRIPTIONS: Record<string, string> = {
  logic:         '主張と根拠のつながり',
  specificity:   '体験の描写・具体性',
  universityFit: '大学固有のカリキュラム・教員への言及度',
  futureGoal:    '将来像の踏み込み度',
  originality:   '自分らしさ・独自性',
};

const SUMMARY_MESSAGE =
  '次のステップで合格ライン目安と比べて、足りない要素を見つけましょう。';

export default function StatementScorePage() {
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
        currentStep={2}
        totalSteps={5}
        title="完成度を確認"
        description="あなたの志望理由書の現在地を可視化します。弱点を把握したら、次のステップで合格ライン目安と比べましょう。"
        backHref="/statement/edit"
        nextHref="/statement/compare"
        nextLabel="差分を見る"
      />

      {mounted && !score && <NoReviewYet />}

      {mounted && score && <ScoreView score={score} />}

      <div className="fixed bottom-0 inset-x-0 sm:static bg-white sm:bg-transparent border-t sm:border-none border-gray-200 px-4 py-3 sm:p-0 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] sm:shadow-none">
        <div className="max-w-4xl mx-auto">
          <LinkButton
            href="/statement/compare"
            variant="primary"
            size="lg"
            className="w-full"
          >
            合格ライン目安と比べる →
          </LinkButton>
          <p className="text-xs text-slate-400 text-center mt-2 hidden sm:block">
            次のステップ：合格ライン目安との差分を確認します
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
        先に <span className="font-semibold">志望理由書を入力 → AI 添削</span> を実行すると、ここに完成度スコアが表示されます。
      </p>
      <LinkButton href="/statement/edit" variant="primary" size="md">
        添削画面へ移動 →
      </LinkButton>
    </div>
  );
}

function ScoreView({ score }: { score: StatementScoreResult }) {
  const items = breakdownToRankItems(score.breakdown);
  const radarItems = items.map(({ label, score: s }) => ({ label, score: s }));
  const priority = getImprovementPriority(items);

  return (
    <>
      <section className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 sm:gap-4 mb-4">
        <TotalScoreCard score={score.total} />
        <div className="bg-white border border-gray-200 rounded-2xl px-6 py-5 sm:px-8 flex items-center justify-center">
          <RankBadge score={score.total} size="lg" />
        </div>
      </section>

      <section className="mb-6">
        <DashboardSummary message={SUMMARY_MESSAGE} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 sm:gap-4 mb-6">
        <RadarSummary items={radarItems} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
          {items.map(({ key, label, score: itemScore }) => (
            <ScoreBarCard
              key={key}
              label={label}
              score={itemScore}
              description={AXIS_DESCRIPTIONS[key] ?? ''}
            />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <ImprovementPriority items={priority} />
      </section>
    </>
  );
}
