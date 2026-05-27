// STEP 3: 整理メモ表示。
// STEP-PAGE-01 で app/statement/prepare/university/page.tsx の inline 定義から切り出し。
//
// 役割:
//   pure props rendering。state を持たず、parent (page.tsx) が渡す summary を 5 項目で表示する。
//   handlers (onEditAnswers / onStartOver) は parent 側 setter を起動するだけで、自身では state を触らない。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard
//   - props 名・callback 名

'use client';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import type { SchoolPreference } from '@/types/basicInfo';
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

export function SummaryStep({
  pref,
  summary,
  onEditAnswers,
  onStartOver,
}: {
  pref: SchoolPreference;
  summary: StatementPrepareApiResult;
  // 同じ大学・同じ回答を保持して 6 問画面へ戻す（answers / questions / pref state は触らない）。
  // handleStartOver の全リセットとは役割を分離する。
  onEditAnswers: () => void;
  onStartOver: () => void;
}) {
  return (
    <>
      <Card className="mb-6 bg-blue-50 border-blue-100">
        <p className="text-[11px] font-bold text-blue-700 tracking-widest mb-2">
          整理メモを保存しました
        </p>
        <p className="text-sm font-semibold text-slate-900">
          {pref.university}
          {pref.faculty ? `　${pref.faculty}` : ''}
          {pref.department ? `　${pref.department}` : ''}
        </p>
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          次は志望理由書の本文を書く画面で、この整理メモを参考にできます。
        </p>
      </Card>

      <Card className="mb-6">
        <h2 className="text-sm font-bold text-slate-900 mb-4">整理メモ</h2>
        <ol className="space-y-4 list-none">
          {SUMMARY_FIELDS.map(({ key, label }, i) => (
            <li key={key} className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-800 mb-1">
                  {label}
                </p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {summary[key]}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <LinkButton href="/statement/edit" variant="primary" size="md">
          志望理由書を書きに行く →
        </LinkButton>
        <Button variant="secondary" onClick={onEditAnswers}>
          回答を修正する
        </Button>
        <Button variant="secondary" onClick={onStartOver}>
          別の大学で整理する
        </Button>
      </div>

      {/* 整理メモを確認し終えたユーザーが、自然に他機能（書く / 過去結果を見る / 改善する等）へ
          移れるよう、ページ末尾に志望理由書機能一覧への戻り導線を置く。
          上の primary CTA「志望理由書を書きに行く →」と視覚的に分離するため、
          別行 + border 区切り + secondary で目立たない navigation footer 扱いにする。 */}
      <div className="mt-10 pt-6 border-t border-slate-100 flex justify-center">
        <LinkButton href="/statement" variant="secondary" size="md">
          志望理由書機能一覧に戻る
        </LinkButton>
      </div>
    </>
  );
}
