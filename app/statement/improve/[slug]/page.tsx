import { notFound } from 'next/navigation';
import {
  getRewriteGuide,
  getAllImprovementSlugs,
} from '@/lib/rewriteGuides';
import { RewriteForm } from '@/components/ImprovementGuide/RewriteForm';
import { StepHeader } from '@/components/StatementFlow/StepHeader';
import { Card } from '@/components/ui/Card';
import { AlertBox } from '@/components/ui/AlertBox';

type Props = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getAllImprovementSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const guide = getRewriteGuide(slug);
  return {
    title: guide ? `改善する：${guide.axisLabel}` : '改善する',
  };
}

export default async function StatementImproveSlugPage({ params }: Props) {
  const { slug } = await params;
  const guide = getRewriteGuide(slug);
  if (!guide) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* ── ステップヘッダー ─────────────────────────────── */}
      <StepHeader
        currentStep={5}
        totalSteps={5}
        title={`改善する：${guide.axisLabel}`}
        description="個別に書き直すステップです。問いに答えながら、自分の言葉で改善文を書いてみましょう。"
        backHref="/statement/improve"
      />

      {/* ── なぜこの項目を直すべきか ──────────────────────── */}
      <AlertBox variant="info" className="mb-4">
        <p className="text-[11px] font-bold text-blue-700 mb-2 tracking-wider">
          なぜこの項目を直すべきか
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">
          {guide.reasoning}
        </p>
      </AlertBox>

      {/* ── 改善の方向性（参考） ──────────────────────────── */}
      {guide.improvementComment && (
        <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 mb-4">
          <p className="text-[11px] font-bold text-slate-600 mb-2 tracking-wider">
            改善の方向性
          </p>
          <p className="text-sm text-slate-700 leading-relaxed">
            {guide.improvementComment}
          </p>
        </section>
      )}

      {/* ── 現在の弱点 ────────────────────────────────────── */}
      <Card className="mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">
          現在ありがちな弱点
        </h2>
        <ul className="space-y-2">
          {guide.weaknessHints.map((w, i) => (
            <li key={i} className="text-sm text-slate-600 flex gap-2">
              <span className="shrink-0 text-slate-400">・</span>
              <span className="leading-relaxed">{w}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* ── 書き直しの問い ────────────────────────────────── */}
      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">
          書き直しの問い
        </h2>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          以下の問いに頭の中で答えてから書くと、内容が深まります。
        </p>
        <ol className="space-y-3">
          {guide.guidingQuestions.map((q, i) => (
            <li key={i} className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold flex items-center justify-center mt-0.5 tabular-nums">
                Q{i + 1}
              </span>
              <span className="text-sm text-slate-700 leading-relaxed pt-0.5">
                {q}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {/* ── 書き直しエリア + チェックリスト + ボタン ─────── */}
      <RewriteForm
        axisLabel={guide.axisLabel}
        checklist={guide.checklist}
      />
    </div>
  );
}
