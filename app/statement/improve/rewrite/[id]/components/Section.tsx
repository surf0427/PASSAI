// レイアウト primitive。STEP-PAGE-03 で page.tsx の inline 定義から切り出し。
//
// 役割:
//   pure props rendering。`{ title, children }` を受け取って h2 + section を返すだけ。
//   /statement/analysis/[id]（49f8bca）と同思想：枠 + 背景ではなく余白 + 見出しで区切る。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard / refs / state

'use client';

import type { ReactNode } from 'react';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-16">
      <h2 className="text-xl font-semibold text-slate-900 tracking-tight mb-6">
        {title}
      </h2>
      {children}
    </section>
  );
}
