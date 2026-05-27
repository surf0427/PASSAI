// 過去ログ一覧の 1 行。クリックで「整理メモ 5 項目」と「質問と回答」を展開する <details> ベース。
// STEP-PAGE-01 で app/statement/prepare/university/page.tsx の inline 定義から切り出し。
//
// 役割:
//   pure props rendering。entry を受け取って表示するだけ。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard
//
// SUMMARY_FIELDS / formatDate は本 component 固有のローカル定義として持つ。
// SummaryStep の SUMMARY_FIELDS と内容は等価だが、各 component を self-contained に保つために
// 共有化しない（共通 component / utils.ts 化は本 STEP の禁止事項）。

'use client';

import type { UniversityPrepareEntry } from '@/lib/statement/prepare/universityPrepareHistory';
import type { StatementPrepareApiResult } from '@/app/api/statement-prepare/route';

const SUMMARY_FIELDS: Array<{
  key: keyof StatementPrepareApiResult;
  label: string;
}> = [
  { key: 'impressiveExperience', label: '印象に残った経験' },
  { key: 'feltIssue',            label: '気づいた課題' },
  { key: 'interestInField',      label: '分野・学部への興味' },
  { key: 'universityLearning',   label: '大学で学びたいこと' },
  { key: 'futureApplication',    label: '将来やりたいこと' },
];

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}/${m}/${day}`;
}

export function HistoryEntryCard({ entry }: { entry: UniversityPrepareEntry }) {
  const filledQuestions = entry.questions.filter(
    (q) => q.answer.trim().length > 0,
  );
  return (
    <details className="group bg-white rounded-lg border border-slate-200">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">
            {entry.university || '（大学未入力）'}
            {entry.faculty ? `　${entry.faculty}` : ''}
            {entry.department ? `　${entry.department}` : ''}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-xs text-slate-400 tabular-nums">
            {formatDate(entry.createdAt)}
          </span>
          <span className="text-slate-400 transition-transform group-open:rotate-180 inline-block">
            ▾
          </span>
        </div>
      </summary>
      <div className="px-4 pb-4 pt-1 border-t border-slate-100">
        <section className="mb-4">
          <h4 className="text-xs font-bold text-slate-700 mb-2">整理メモ</h4>
          <ol className="space-y-2 list-none">
            {SUMMARY_FIELDS.map(({ key, label }) => (
              <li key={key}>
                <p className="text-[11px] font-semibold text-slate-600 mb-0.5">
                  {label}
                </p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {entry.summary[key]}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {filledQuestions.length > 0 && (
          <section>
            <h4 className="text-xs font-bold text-slate-700 mb-2">
              質問と回答
            </h4>
            <ol className="space-y-3 list-none">
              {filledQuestions.map((q) => (
                <li key={q.id}>
                  <p className="text-[11px] font-semibold text-slate-600 mb-0.5">
                    Q. {q.label}
                  </p>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {q.answer}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </details>
  );
}
