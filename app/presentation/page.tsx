import { Fragment } from 'react';
import Link from 'next/link';

import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';

import { PresentationHubClient } from './PresentationHubClient';

// 利用フロー（4 ステップ）。ハブ最上部に常時表示し、Premium ゲートの有無に
// かかわらず全ユーザーが流れを把握できるようにする（導線説明のみ。挙動は変えない）。
const FLOW_STEPS = [
  { step: '①', label: '大学・学部を設定' },
  { step: '②', label: 'テーマを決める' },
  { step: '③', label: '録画して発表' },
  { step: '④', label: 'AI評価＋質疑応答' },
] as const;

export default function PresentationPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <Link
        href="/home"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors mb-8"
      >
        ← ホームへ戻る
      </Link>

      <PageHeader
        title="プレゼン対策"
        description="本番に近いプレゼン対策。録画した発表を AI がカテゴリ評価し、発表後に深掘り質問を行います（Premium 限定）。"
        className="mb-8"
      />

      {/* 利用フロー（4 ステップ） */}
      <Card padding="lg" className="mb-8">
        <p className="text-sm font-bold text-slate-900 mb-4">利用の流れ</p>
        <ol className="flex flex-col items-start sm:flex-row sm:items-center gap-2">
          {FLOW_STEPS.map((s, i) => (
            <Fragment key={s.step}>
              <li className="flex items-center gap-2 sm:flex-1">
                <span className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-600 ring-1 ring-blue-100">
                  {s.step}
                </span>
                <span className="text-sm text-slate-700">{s.label}</span>
              </li>
              {i < FLOW_STEPS.length - 1 && (
                <span
                  className="pl-2 text-slate-300 sm:px-1"
                  aria-hidden="true"
                >
                  <span className="sm:hidden">↓</span>
                  <span className="hidden sm:inline">→</span>
                </span>
              )}
            </Fragment>
          ))}
        </ol>
      </Card>

      <PresentationHubClient />
    </div>
  );
}
