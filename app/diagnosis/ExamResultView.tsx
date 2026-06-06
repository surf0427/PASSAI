'use client';

import Link from 'next/link';
import type { ExamResult } from '@/types/examDiagnosis';

// 9タイプ診断の結果表示。juken-shindan/components/Result.tsx を移植し、PASSAI の
// 導線（/home CTA・もう一度診断する）に合わせた。
// type名・キャッチコピー・特徴・戦略・推薦大学・大学キャラ・理由・NG行動・失敗例・改善策を表示。
// ⚠️ ここで表示する universities / badExamples / ngExplanation の生文は Tutor へ渡さない
//    （tutorContext.ts 側で type → 傾向 hint に言い換える）。

const TYPE_STYLES: Record<ExamResult['type'], { badge: string; section: string }> = {
  riaju: { badge: 'bg-sky-100 text-sky-700', section: 'bg-sky-50 border-sky-100' },
  challenger: { badge: 'bg-indigo-100 text-indigo-700', section: 'bg-indigo-50 border-indigo-100' },
  creator: { badge: 'bg-violet-100 text-violet-700', section: 'bg-violet-50 border-violet-100' },
  kaigai: { badge: 'bg-teal-100 text-teal-700', section: 'bg-teal-50 border-teal-100' },
  kakumeika: { badge: 'bg-amber-100 text-amber-700', section: 'bg-amber-50 border-amber-100' },
  kyoyo: { badge: 'bg-emerald-100 text-emerald-700', section: 'bg-emerald-50 border-emerald-100' },
  yutosei: { badge: 'bg-blue-100 text-blue-700', section: 'bg-blue-50 border-blue-100' },
  jiyujin: { badge: 'bg-fuchsia-100 text-fuchsia-700', section: 'bg-fuchsia-50 border-fuchsia-100' },
  gariben: { badge: 'bg-slate-100 text-slate-700', section: 'bg-slate-50 border-slate-100' },
};

// ⚠️ Tailwind は class 名を literal でしか検出できないため、`text-${tone}-600` のような
//    動的合成は安全でない（他所での literal 使用に暗黙依存し、消えると無言で色落ちする）。
//    tone → 完全な class 文字列の静的マップに固定する。
const SECTION_LABEL_TONE: Record<'slate' | 'blue' | 'red' | 'emerald', string> = {
  slate: 'text-slate-600',
  blue: 'text-blue-600',
  red: 'text-red-600',
  emerald: 'text-emerald-600',
};

function SectionLabel({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode;
  tone?: keyof typeof SECTION_LABEL_TONE;
}) {
  return (
    <div className={`mb-3 text-xs font-semibold uppercase tracking-[0.18em] ${SECTION_LABEL_TONE[tone]}`}>
      {children}
    </div>
  );
}

export function ExamResultView({
  result,
  secondary,
  onRestart,
}: {
  result: ExamResult;
  secondary?: ExamResult | null;
  onRestart: () => void;
}) {
  const style = TYPE_STYLES[result.type] ?? TYPE_STYLES.yutosei;

  return (
    <div className="rounded-3xl bg-white p-6 sm:p-8 ring-1 ring-slate-200 shadow-sm">
      {/* ヘッダー：タイプ名 + キャッチコピー */}
      <div className={`rounded-2xl border ${style.section} p-5 mb-6`}>
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${style.badge} mb-3`}>
          受験タイプ診断
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-1">{result.name}</h1>
        <p className="text-base sm:text-lg font-semibold text-slate-700">{result.catchphrase}</p>
        {secondary && (
          <p className="mt-2 text-xs text-slate-500">
            副タイプの傾向も近め：{secondary.name}
          </p>
        )}
      </div>

      <div className="grid gap-4">
        {/* 特徴 */}
        <section className="rounded-2xl bg-slate-50 p-5">
          <SectionLabel tone="slate">あなたのタイプ</SectionLabel>
          <p className="text-sm sm:text-base text-slate-700 leading-relaxed whitespace-pre-wrap">
            {result.description}
          </p>
        </section>

        {/* 戦略 */}
        <section className="rounded-2xl bg-blue-50 p-5">
          <SectionLabel tone="blue">戦略</SectionLabel>
          <p className="text-sm sm:text-base text-slate-900 font-semibold leading-relaxed">
            {result.strategy}
          </p>
        </section>

        {/* 推薦大学 + 大学キャラ */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-white border border-slate-200 p-5">
            <SectionLabel tone="slate">向いている大学</SectionLabel>
            <ul className="space-y-1.5 text-sm text-slate-700">
              {result.universities.map((uni) => (
                <li key={uni} className="leading-6">{uni}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 p-5">
            <SectionLabel tone="slate">大学のキャラ</SectionLabel>
            <p className="text-sm text-slate-700 leading-relaxed">{result.universityCharacter}</p>
          </div>
        </section>

        {/* 理由 */}
        <section className="rounded-2xl bg-white border border-slate-200 p-5">
          <SectionLabel tone="slate">理由</SectionLabel>
          <p className="text-sm text-slate-700 leading-relaxed">{result.reason}</p>
        </section>

        {/* NG行動 */}
        <section className="rounded-2xl bg-red-50 border border-red-100 p-5">
          <SectionLabel tone="red">NG行動</SectionLabel>
          <p className="text-sm text-red-900 font-semibold mb-2">{result.ngBehavior}</p>
          <p className="text-sm text-red-900 leading-relaxed">{result.ngExplanation}</p>
        </section>

        {/* 失敗例 */}
        <section className="rounded-2xl bg-white border border-slate-200 p-5">
          <SectionLabel tone="slate">ありがちな失敗例</SectionLabel>
          <ul className="space-y-1.5 text-sm text-slate-700">
            {result.badExamples.map((ex) => (
              <li key={ex} className="list-disc ml-4 leading-6">{ex}</li>
            ))}
          </ul>
        </section>

        {/* 改善策 */}
        <section className="rounded-2xl bg-emerald-50 border border-emerald-100 p-5">
          <SectionLabel tone="emerald">改善策</SectionLabel>
          <p className="text-sm text-emerald-900 font-semibold leading-relaxed">
            {result.countermeasure}
          </p>
        </section>
      </div>

      {/* CTA */}
      <div className="mt-8 flex flex-col gap-3 max-w-md mx-auto">
        <Link
          href="/home"
          className="inline-flex justify-center items-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base px-8 py-4 rounded-3xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200"
        >
          このタイプに合わせて対策を始める
          <span aria-hidden="true" className="ml-2">→</span>
        </Link>
        <button
          type="button"
          onClick={onRestart}
          className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          もう一度診断する
        </button>
      </div>
    </div>
  );
}
