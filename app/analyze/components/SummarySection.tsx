import type { SummaryResult } from '@/types/analysis';

type Props = { summary: SummaryResult };

export function SummarySection({ summary }: Props) {
  return (
    <div className="space-y-5">
      <SummaryCard title="活動の要約">
        <p className="text-gray-800 leading-relaxed text-sm">{summary.activitySummary}</p>
      </SummaryCard>
      <SummaryCard title="強み">
        <p className="text-gray-800 leading-relaxed text-sm">{summary.strengths}</p>
      </SummaryCard>
      <SummaryCard title="アピールポイント">
        <p className="text-gray-800 leading-relaxed text-sm">{summary.appealPoints}</p>
      </SummaryCard>
      <SummaryCard title="自己PRのたたき台">
        <p className="text-gray-800 leading-relaxed text-sm whitespace-pre-line">
          {summary.selfPRDraft}
        </p>
      </SummaryCard>
      <SummaryCard title="面接で話せる要点">
        <ul className="list-disc pl-5 space-y-1">
          {summary.interviewPoints.map((point, i) => (
            <li key={i} className="text-gray-800 text-sm">
              {point}
            </li>
          ))}
        </ul>
      </SummaryCard>
    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 pb-2 border-b border-gray-100">
        {title}
      </h3>
      {children}
    </div>
  );
}
