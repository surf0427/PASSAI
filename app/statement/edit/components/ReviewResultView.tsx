// STEP8.4/8.5: 志望理由書 edit 画面の AI 添削結果 view。
//   STEP8.4 で page.tsx 内 top-level function として logical split、STEP8.5 で
//   feature-local component file として physical split。
//   state ownership / hook ownership は page.tsx 側に維持。本 view は props を受け取って
//   render するだけの pure-ish 関数。
//   ScoreBar は本 view 専用 helper として同居（他 view からの参照なし）。

import type { Dispatch, SetStateAction } from 'react';
import { Card } from '@/components/ui/Card';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { LinkButton } from '@/components/ui/LinkButton';
import type { StatementResult } from '@/types/statement';

// ── スコアバー ────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const percentage = (score / 20) * 100;
  const color =
    percentage >= 80 ? 'bg-green-500' : percentage >= 60 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-sm font-semibold text-gray-700 w-14 text-right">{score} / 20</span>
    </div>
  );
}

export type ReviewResultViewProps = {
  result: StatementResult | null;
  showImproveForm: boolean;
  setShowImproveForm: Dispatch<SetStateAction<boolean>>;
  improveText: string;
  setImproveText: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  loading: boolean;
  remainingCount: number;
  onImproveSubmit: () => void;
};

export function ReviewResultView({
  result,
  showImproveForm, setShowImproveForm,
  improveText, setImproveText,
  setError,
  loading,
  remainingCount,
  onImproveSubmit,
}: ReviewResultViewProps) {
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

          {/* 各評価（参照情報。最後に置く） */}
          <Card className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">各評価</h3>
            <div className="space-y-4">
              {result.evaluations.map((ev) => (
                <div key={ev.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">{ev.label}</span>
                  </div>
                  <ScoreBar score={ev.score} />
                </div>
              ))}
            </div>
          </Card>

          {/* ── 再提出フロー ── */}
          {!showImproveForm ? (
            <div className="pt-4 border-t border-gray-200 text-center">
              <p className="text-sm text-gray-500 mb-3">
                改善アクションをもとに文章を見直したら、もう一度添削を受けましょう。
              </p>
              <Button
                variant="outline"
                onClick={() => setShowImproveForm(true)}
                disabled={remainingCount === 0}
              >
                もう一度改善する
              </Button>
              {remainingCount === 0 && (
                <p className="text-xs text-red-500 mt-2">本日の添削回数上限に達しました</p>
              )}
            </div>
          ) : (
            <div className="border border-blue-200 rounded-xl overflow-hidden">
              <div className="bg-blue-50 px-6 py-4">
                <h3 className="text-sm font-bold text-blue-800 mb-2">
                  指摘された点を改善するために、追加情報を入力してください
                </h3>
                <ul className="space-y-1">
                  {result.weaknesses.map((w, i) => (
                    <li key={i} className="text-xs text-blue-700 flex gap-1">
                      <span className="shrink-0">→</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white px-6 py-5">
                <p className="text-xs text-gray-400 mb-2">
                  例：「なぜこの大学を選んだか」「具体的な経験のエピソード」「将来の目標の詳細」など
                </p>
                <Textarea
                  value={improveText}
                  onChange={(e) => setImproveText(e.target.value)}
                  rows={6}
                  placeholder="改善した内容や追加したい情報を自由に書いてください"
                  className="leading-relaxed resize-y"
                />
                <div className="flex items-center gap-3 mt-4">
                  <Button
                    variant="primary"
                    onClick={onImproveSubmit}
                    disabled={loading}
                  >
                    {loading ? '添削中...' : 'この情報を加えて再添削する'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setShowImproveForm(false); setImproveText(''); setError(''); }}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            </div>
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

      {/* ── 次のステップへ：完成度スコア ─────────────────── */}
      {result && (
        <section className="mb-10 bg-blue-50 border border-blue-100 rounded-2xl p-5 sm:p-6">
          <p className="text-[11px] font-bold text-blue-700 mb-1 tracking-widest">
            次のステップ
          </p>
          <p className="text-sm text-slate-700 leading-relaxed mb-4">
            添削結果をもとに、完成度スコアで現在地を確認しましょう。
          </p>
          <LinkButton
            href="/statement/score"
            variant="primary"
            size="md"
            className="w-full sm:w-auto"
          >
            完成度スコアを見る →
          </LinkButton>
        </section>
      )}
    </>
  );
}
