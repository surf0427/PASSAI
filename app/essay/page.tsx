// 小論文機能 hub（STEP C 新規 / Phase 2 STEP N で「整理して書く」link 切替 / STEP O で「いきなり書く」link 切替）。
//
// カード:
//   - 整理して書く : /essay/structure
//   - いきなり書く : /essay/write（Phase 2 STEP O で /essay-practice から切替）
//   - 改善する     : /essay/improve（Phase 1 改善フロー入口）
//   - 結果を見る   : /essay/results
//
// /essay-practice は legacy として維持（rollback safety）。判断見直しは STEP P で。
//
// このページは Server Component（データ依存なし）。

import Link from 'next/link';

export default function EssayHubPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-3">小論文</h1>
        <p className="text-gray-600 text-sm">
          書く・整理する・結果を振り返るための入り口です。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/essay/structure"
          className="bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm rounded-xl p-6 transition-colors"
        >
          <h2 className="text-base font-semibold text-gray-800 mb-2">
            整理して書く
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            ミニ思考欄と壁打ちで素材を整理してから本文に進みます。
          </p>
        </Link>

        <Link
          href="/essay/write"
          className="bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm rounded-xl p-6 transition-colors"
        >
          <h2 className="text-base font-semibold text-gray-800 mb-2">
            いきなり書く
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            テーマだけ決めてすぐ本文を書き始めます。
          </p>
        </Link>

        <Link
          href="/essay/improve"
          className="bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm rounded-xl p-6 transition-colors"
        >
          <h2 className="text-base font-semibold text-gray-800 mb-2">
            改善する
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            過去の添削結果から改善ポイントを選び、1 つずつ直して書き直します。
          </p>
        </Link>

        <Link
          href="/essay/results"
          className="bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm rounded-xl p-6 transition-colors"
        >
          <h2 className="text-base font-semibold text-gray-800 mb-2">
            結果を見る
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            過去の添削結果と本文を時系列で振り返ります。
          </p>
        </Link>
      </div>
    </div>
  );
}
