// STEP8.4/8.5: 志望理由書 edit 画面の AI 添削結果 view。
//   STEP8.4 で page.tsx 内 top-level function として logical split、STEP8.5 で
//   feature-local component file として physical split。
//   state ownership / hook ownership は page.tsx 側に維持。本 view は props を受け取って
//   render するだけの pure-ish 関数。
//
// ── ②「志望理由書を書く機能」整理 ────────────────────────────────
// 添削後 1 ページ目は「総合評価点数＋概要＋完成度スコアを見る導線」のみに絞る。
//   - 各評価カード（軸別 ScoreBar）→ /statement/score と内容が被るため削除
//   - 「もう一度改善する」ボタン + 再添削フォーム → 書き直しは ④ /statement/improve
//     に分離するため、②の添削後ページからは導線を出さない
// 保存処理（saveReviewHistory）/ API（/api/statement-review）/ プロンプトは未変更。

import { Card } from '@/components/ui/Card';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import type { StatementResult } from '@/types/statement';

export type ReviewResultViewProps = {
  result: StatementResult | null;
  // 添削結果直下から本文入力欄へスムーズスクロールするための callback。
  // 「もう一度改善する」UI を復活させず、同一ページ内 anchor scroll のみで戻り導線を提供する。
  // ref 本体は page.tsx 側に集約され、InputFormView に渡される inputSectionRef を流用する。
  onScrollToInput: () => void;
};

export function ReviewResultView({ result, onScrollToInput }: ReviewResultViewProps) {
  return (
    <>
      {result ? (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-gray-800 mb-6">添削結果</h2>

          {/* 総合評価 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-4 mb-3">
              <span className="text-4xl font-bold text-blue-700">{result.overallScore}</span>
              <div>
                <p className="text-sm font-semibold text-blue-800">総合評価</p>
                <p className="text-xs text-blue-600">/ 100点</p>
              </div>
            </div>
          </div>

          {/* 改善アクション（結論ファースト UX：優先度順で最上部に置く） */}
          <AlertBox variant="warning" className="mb-4">
            <h3 className="text-sm font-semibold text-yellow-800 mb-3">優先度順の改善アクション</h3>
            <ol className="space-y-2">
              {result.actions.map((a, i) => (
                <li key={i} className="text-sm text-yellow-900 flex gap-2">
                  <span className="font-bold shrink-0">{i + 1}.</span>
                  <span>{a}</span>
                </li>
              ))}
            </ol>
          </AlertBox>

          {/* 弱い点（アクションの根拠として直下に置く） */}
          <AlertBox variant="error" className="mb-4">
            <h3 className="text-sm font-semibold text-red-800 mb-3">弱い点</h3>
            <ul className="space-y-1">
              {result.weaknesses.map((w, i) => (
                <li key={i} className="text-sm text-red-700 flex gap-2">
                  <span>△</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </AlertBox>

          {/* 再提出チェックリスト（次にやることを目立たせる） */}
          <Card className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">再提出チェックリスト</h3>
            <ul className="space-y-2">
              {result.checklist.map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    id={`check-${i}`}
                  />
                  <label htmlFor={`check-${i}`} className="text-sm text-gray-700 cursor-pointer">
                    {item}
                  </label>
                </li>
              ))}
            </ul>
          </Card>

          {/* 部分修正例 */}
          <Card className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">部分修正例</h3>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">
              {result.partialRevision}
            </pre>
          </Card>

          {/* 良い点 */}
          <AlertBox variant="success" className="mb-4">
            <h3 className="text-sm font-semibold text-green-800 mb-3">良い点</h3>
            <ul className="space-y-1">
              {result.strengths.map((s, i) => (
                <li key={i} className="text-sm text-green-700 flex gap-2">
                  <span>✓</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </AlertBox>
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
