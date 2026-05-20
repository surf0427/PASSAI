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
    title: guide ? `書き直す：${guide.axisLabel}` : '書き直す',
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
        title={`書き直す：${guide.axisLabel}`}
        description="問いに答えながら、自分の言葉で書き直してみましょう。"
        backHref="/statement/improve"
      />

      {/* ── なぜここを直すか（短く可視） ──────────────────── */}
      <AlertBox variant="info" className="mb-3">
        <p className="text-[11px] font-bold text-blue-700 mb-2 tracking-wider">
          なぜここを直すか
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">
          {guide.reasoning}
        </p>
      </AlertBox>

      {/* ── 直す方向性（折り畳み、補助情報） ─────────────── */}
      {guide.improvementComment && (
        <details className="group bg-slate-50 border border-slate-200 rounded-xl mb-3">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-xs font-bold text-slate-700 px-4 py-3 flex items-center justify-between">
            <span>直す方向性</span>
            <span className="text-slate-400 transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <p className="text-sm text-slate-700 leading-relaxed px-4 pb-4">
            {guide.improvementComment}
          </p>
        </details>
      )}

      {/* ── ありがちな弱点（折り畳み、補助情報） ─────────── */}
      <details className="group bg-slate-50 border border-slate-200 rounded-xl mb-5">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-xs font-bold text-slate-700 px-4 py-3 flex items-center justify-between">
          <span>ありがちな弱点</span>
          <span className="text-slate-400 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <ul className="space-y-2 px-4 pb-4">
          {guide.weaknessHints.map((w, i) => (
            <li key={i} className="text-sm text-slate-600 flex gap-2">
              <span className="shrink-0 text-slate-400">・</span>
              <span className="leading-relaxed">{w}</span>
            </li>
          ))}
        </ul>
      </details>

      {/* ── 書き直しの問い（DO トリガー、可視） ──────────── */}
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
