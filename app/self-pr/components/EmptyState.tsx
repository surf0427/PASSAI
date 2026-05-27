// 自己PR 一覧画面の empty-state（自己PR が 0 件のとき表示）。
// STEP-PAGE-05 で app/self-pr/page.tsx の inline JSX block から切り出し。
//
// 役割:
//   pure props rendering。`selfPRs.length === 0` でしか描画されない。
//   2 ボタン（直接書く / 自己分析から始める）と headline 文言を表示するだけ。
//
// STEP-NAV-3 設計意図（page.tsx から移送）:
//   hub の②「書いた自己PRを添削する」着地経路を成立させるため、
//   empty-state を「直接自己PRを書く / 自己分析から始める」の 2 択に統一する。
//   hasSelfAnalysis は headline 文言の微差にだけ使う（経路は両方とも同じ 2 ボタン）。
//     - 直接自己PRを書く: 既存 createNewPR() を流用（空 PR を 1 件作って自動 open）。
//       daily limit は従来どおり selfAnalysisLimit.canUse で disable 連動。
//     - 自己分析から始める: /self-analysis (hub) に戻して 4 カードから選び直す経路。
//   selfPRs[] の構造 / API / cache には何も触らない。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard / refs / state
//   - selfAnalysisLimit.canUse(usage) の計算は parent (page.tsx) で完了させ、
//     boolean (canCreateNewPR) を props で受け取るだけにする（cache identity に関わらないため）。

'use client';

import Link from 'next/link';

export function EmptyState({
  hasSelfAnalysis,
  canCreateNewPR,
  onCreateNewPR,
}: {
  hasSelfAnalysis: boolean;
  canCreateNewPR: boolean;
  onCreateNewPR: () => void;
}) {
  return (
    <div className="text-center py-24">
      <p className="text-gray-400 text-base mb-3">
        {hasSelfAnalysis ? 'まだ自己PR添削はありません' : 'まだ自己PRはありません'}
      </p>
      <p className="text-gray-500 text-sm mb-8 leading-relaxed">
        本文をそのまま貼って添削するか、<br />
        自己分析から整理して書き始めるか選べます。
      </p>
      <div className="flex flex-col items-center gap-3 max-w-sm mx-auto">
        <button
          type="button"
          onClick={onCreateNewPR}
          disabled={!canCreateNewPR}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
        >
          {canCreateNewPR
            ? '直接自己PRを書く'
            : '直接自己PRを書く（本日の上限）'}
        </button>
        <Link
          href="/self-analysis"
          className="w-full inline-block text-center border border-blue-300 text-blue-600 hover:bg-blue-50 font-semibold px-8 py-3 rounded-lg text-base transition-colors"
        >
          自己分析から始める →
        </Link>
      </div>
    </div>
  );
}
