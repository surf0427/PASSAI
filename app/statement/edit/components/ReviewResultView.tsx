// STEP-DA-3: ②「書く + 添削結果の概要」として軽量化。
//   - 各評価カード（軸別 ScoreBar）→ 既に STEP-2 で削除済み
//   - 「もう一度改善する」ボタン + 再添削フォーム → 既に STEP-2 で削除済み
//   - 優先度順の改善アクション full list / 弱い点 / 良い点 AlertBox → /statement/score
//   - 再提出チェックリスト / 部分修正例 Card → /statement/analysis/[id]
//
// 残すもの:
//   - 総合スコア（大きい数値）
//   - 各評価のコンパクト badge 列（label + score だけ）
//   - 簡単な総評（result.actions の top 1 のみ）
//   - 「完成度スコアを見る →」LinkButton（③ へ）
//   - 「↑ 本文を修正する」Button（STEP-NAV-1: 同一ページ内 anchor scroll）
//
// 詳細分析は /statement/analysis/[id]、軸別ギャップは /statement/score に集約済み。
// 添削 API / 保存処理は触らない（呼び出しは page.tsx 側で従来どおり）。

import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import type { StatementResult } from '@/types/statement';

export type ReviewResultViewProps = {
  result: StatementResult | null;
  // 添削結果直下から本文入力欄へスムーズスクロールするための callback。
  // ref 本体は page.tsx 側に集約し、InputFormView に渡される inputSectionRef を流用する。
  onScrollToInput: () => void;
};

const AXIS_MAX = 20;

export function ReviewResultView({ result, onScrollToInput }: ReviewResultViewProps) {
  return (
    <>
      {result ? (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-gray-800 mb-6">添削結果</h2>

          {/* 総合評価 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-5">
            <div className="flex items-center gap-4">
              <span className="text-4xl font-bold text-blue-700 tabular-nums">
                {result.overallScore}
              </span>
              <div>
                <p className="text-sm font-semibold text-blue-800">総合評価</p>
                <p className="text-xs text-blue-600">/ 100点</p>
              </div>
            </div>
          </div>

          {/* 各評価のコンパクト badge 列。ScoreBar 等の大きい visual は ③ /statement/score 側に集約。 */}
          <div className="flex flex-wrap gap-2 mb-5">
            {result.evaluations.map((ev) => (
              <span
                key={ev.label}
                className="inline-flex items-baseline gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1"
              >
                <span className="text-[11px] text-slate-600">{ev.label}</span>
                <span className="text-sm font-semibold text-slate-900 tabular-nums">
                  {ev.score}
                </span>
                <span className="text-[10px] text-slate-400">/{AXIS_MAX}</span>
              </span>
            ))}
          </div>

          {/* 簡単な総評: actions の top 1 を 1〜2 行で出す。
              full list は ③ /statement/score / /statement/analysis/[id] で確認できるため概要のみ。 */}
          {result.actions[0] && (
            <p className="text-sm text-slate-700 leading-relaxed">
              <span className="font-semibold text-slate-800">次に直すなら：</span>
              {result.actions[0]}
            </p>
          )}
        </section>
      ) : (
        /* 添削前のプレースホルダー */
        <section className="mb-10">
          <h2 className="text-xl font-bold text-gray-800 mb-4">添削結果</h2>
          <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-10 text-center">
            <p className="text-gray-400 text-sm">まだ添削結果はありません</p>
          </div>
        </section>
      )}

      {/* ── 次のステップへ：完成度スコア / 本文修正 ───────────────────
          完成度スコア = 進む（primary）／本文修正 = 戻り anchor（secondary）。
          後者は inputSectionRef へスクロールするだけで、新 state / 新 handler 経路を作らない。 */}
      {result && (
        <section className="mb-10 bg-blue-50 border border-blue-100 rounded-2xl p-5 sm:p-6">
          <p className="text-[11px] font-bold text-blue-700 mb-1 tracking-widest">
            次のステップ
          </p>
          <p className="text-sm text-slate-700 leading-relaxed mb-4">
            添削結果をもとに、完成度スコアで現在地を確認しましょう。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <LinkButton
              href="/statement/score"
              variant="primary"
              size="md"
              className="w-full sm:w-auto"
            >
              完成度スコアを見る →
            </LinkButton>
            <Button variant="secondary" onClick={onScrollToInput}>
              ↑ 本文を修正する
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
