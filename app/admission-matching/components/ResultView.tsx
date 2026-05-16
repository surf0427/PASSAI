// STEP6.11/6.12: 結果画面の logical view。
//   STEP6.11 で page.tsx 内 top-level function として切り出し、STEP6.12 で
//   feature-local component file として physical split した。state ownership は
//   page (AdmissionMatchingPage) に維持し、本ファイルは props を受け取って render する
//   pure-ish 関数。UI / className / render 順 / 文言は page 内に同居していた時点から無変更。

import type { WallHittingResult } from '@/types/analysis';
import type { MatchingResult, AiMatchAdvice, EligibilityResult } from '@/types/matching';
import { StrengthWeaknessGrid } from '@/components/shared/result';
import { MatchingCard } from './MatchingCard';

export type ResultViewProps = {
  displayMatchingLevel: 'basic' | 'full' | null;
  wallHitting: WallHittingResult | null;
  displayResults: MatchingResult[];
  displayAiAdvices: AiMatchAdvice[];
  // PR9d-1 (H7): 出願条件 eligibility を University.id でルックアップする map。
  //   旧 eligibilityByName (university 名キー) は同名・別学部の collision リスクと
  //   React key (PR9d-1 C1 で id 化) との semantics 不一致があったため id ベースに統一。
  // AI cache とは独立に毎 render 即座に再計算される parallel state。
  eligibilityById?: Record<string, EligibilityResult[]>;
  isShowingCached: boolean;
  cachedTimestamp: string | null;
  onReset: () => void;
  onStartMatching: () => void;
};

export function ResultView({
  displayMatchingLevel,
  wallHitting,
  displayResults,
  displayAiAdvices,
  eligibilityById,
  isShowingCached,
  cachedTimestamp,
  onReset,
  onStartMatching,
}: ResultViewProps) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800">AI志望校マッチング</h1>
        <button
          type="button"
          onClick={onReset}
          className="text-sm text-blue-600 hover:underline shrink-0"
        >
          もう一度診断する
        </button>
      </div>

      {/* キャッシュ表示インジケーター */}
      {cachedTimestamp && (
        <div className="mb-6 flex items-center gap-2 text-xs text-gray-400">
          <span>🕐</span>
          <span>
            保存済みの診断結果を表示しています（
            {new Date(cachedTimestamp).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            ）
          </span>
          <button type="button" onClick={onStartMatching} className="text-blue-500 hover:underline ml-1">
            再診断する
          </button>
        </div>
      )}

      {/* 診断レベルバナー */}
      {/* STEP6.3: displayMatchingLevel は cached 表示中なら snapshot 由来、live なら liveMatchingLevel。 */}
      {displayMatchingLevel === 'basic' && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-yellow-800 mb-1">🟡 簡易診断結果</p>
          <p className="text-sm text-yellow-700 leading-relaxed mb-3">
            自己分析のAI深掘りが未実施のため、基本情報・活動整理・自己分析の入力内容をもとにした簡易診断です。AI深掘りを行うと、志望理由との一貫性や改善アクションの精度が上がります。
          </p>
          <a
            href="/self-analysis"
            className="inline-block text-xs font-semibold text-yellow-800 border border-yellow-400 hover:bg-yellow-100 px-4 py-2 rounded-lg transition-colors"
          >
            自己分析を深掘りする →
          </a>
        </div>
      )}
      {displayMatchingLevel === 'full' && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <span className="text-sm font-semibold text-green-700">🟢 本格診断結果</span>
          <span className="text-sm text-green-600">基本情報・活動整理・自己分析・AI深掘り結果をもとに診断しています。</span>
        </div>
      )}

      {/* STEP6.7: 旧 aiError banner を削除。エラー UX は handleStartMatching の alert(...) に統一。 */}

      {/* AI壁打ち結果サマリー */}
      {wallHitting && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-5">
          <p className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-2">AI分析に基づくマッチング</p>
          <p className="text-sm text-blue-900 leading-relaxed mb-3">{wallHitting.summary}</p>
          {/* 結果画面では弱みは 2 件まで（confirm 画面は 3 件）に絞っている。
              StrengthWeaknessGrid は同じ maxItems を強み・弱みに適用するため
              wallHitting の strengths/weaknesses を呼び出し側で個別 slice する。 */}
          <StrengthWeaknessGrid
            strengths={wallHitting.strengths.slice(0, 3)}
            weaknesses={wallHitting.weaknesses.slice(0, 2)}
          />
        </div>
      )}

      {/* マッチング結果 */}
      {/* STEP6.2/6.3: displayResults / displayAiAdvices は cached 表示中なら cachedSnapshot、
          それ以外は live state。data-source は debug / 将来のバナー判定用に保持。
          STEP6.3 で displayAiAdvices も snapshot 由来に統合済み（results と必ず同じ source）。 */}
      <section data-source={isShowingCached ? 'cached' : 'live'}>
        <h2 className="text-base font-bold text-gray-800 mb-4">マッチング結果</h2>
        {/* eligibility 表示の安全注記。eligibilityById に 1 件以上ある時だけ出す。
            警告 UI ではなく参考情報として弱めの gray ノートで表示し、score 表示と
            混同されないようにする。「出願不可」等の断定文言は使わない。 */}
        {Object.keys(eligibilityById ?? {}).length > 0 && (
          <p className="mb-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 leading-relaxed">
            「出願条件（参考）」は、登録済みの大学DBと入力情報をもとにした目安です。最終確認は必ず各大学の公式要項で行ってください。
          </p>
        )}
        {displayResults.length === 0 ? (
          <p className="text-gray-400 text-sm">
            マッチする大学が見つかりませんでした。志望校を入力すると結果が表示されます。
          </p>
        ) : (
          <div className="space-y-4">
            {displayResults.map((result) => {
              const aiAdvice = displayAiAdvices.find((a) => a.universityId === result.university.id);
              // PR9d-1 (H7): lookup key を university.id に統一。MatchingCard の React key も
              //   同 id に揃えることで、cache ↔ live 切り替えや結果並び替え時の component
              //   instance（accordion open 等）の貼り付き事故を防ぐ (PR9d-1 C1)。
              const eligibilityResults = eligibilityById?.[result.university.id];
              return (
                <MatchingCard
                  key={result.university.id}
                  result={result}
                  aiAdvice={aiAdvice ?? null}
                  eligibilityResults={eligibilityResults}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* 下部ボタン */}
      <div className="mt-8 pt-6 border-t border-gray-100">
        <button
          type="button"
          onClick={onReset}
          className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl text-sm transition-colors"
        >
          入力情報を確認する / もう一度診断する
        </button>
      </div>
    </div>
  );
}
