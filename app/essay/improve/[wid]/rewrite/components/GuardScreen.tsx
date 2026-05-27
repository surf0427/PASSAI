// pre-mount / state 不足時の guard 画面。
// STEP-PAGE-04 で app/essay/improve/[wid]/rewrite/page.tsx の inline 定義から切り出し。
//
// 役割:
//   pure props rendering。`backHref / backLabel / title / body` を受け取り、
//   戻り Link + タイトル + 本文の guard 画面を表示するだけ。
//   workspace 不在 / improvementInProgress 不在 / summary 不在 / works 空 の 4 経路で再利用。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard / refs / state

'use client';

import Link from 'next/link';

export function GuardScreen({
  backHref,
  backLabel,
  title,
  body,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  body: string;
}) {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href={backHref}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          {backLabel}
        </Link>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-800 mb-2">{title}</h1>
        <p className="text-sm text-gray-600">{body}</p>
      </div>
    </div>
  );
}
