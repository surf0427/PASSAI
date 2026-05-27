// 自己分析 step 2 上部の WallHittingResult 表示カード（要約 / 強み・補強 2 カラム / 将来とのつながり）。
// STEP-PAGE-02 で app/self-analysis/run/page.tsx の inline 定義から切り出し。
//
// 役割:
//   pure props rendering。analysis を受け取って 4 ブロックを表示するだけ。
//   state / useEffect / fetch / router / localStorage を一切持たない。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard
//   - patchStudentProfileFromSummary / splitSummaryStrengths（page 側に温存）

'use client';

import type { WallHittingResult } from '@/types/analysis';
import { ImprovementList } from '@/components/shared/result';

export function AnalysisResultCard({ analysis }: { analysis: WallHittingResult }) {
  return (
    <div className="space-y-4">
      {/* 要約 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-blue-800 mb-2">あなたの活動ストーリー</h3>
        <p className="text-sm text-blue-900 leading-relaxed">{analysis.summary}</p>
      </div>

      {/* 強み / 補強ポイントの 2 カラム
          外側の bg-green-50 / bg-orange-50 のカラーカード wrapper と h3 見出しは raw 維持。
          リスト本体だけを ImprovementList に置換する（色は variant 標準の green-700 /
          orange-700 になり、現行の green-900 / orange-900 から軽微にライト化する）。
          density="relaxed" で space-y-1.5 にし、現行 space-y-2 にできるだけ近づける。
          StrengthWeaknessGrid 自体は使えない：当該 grid は「per-column の card 無し・
          青/オレンジ・xs サイズ」で設計されており、ここで使うと per-column card と
          色（緑→青）が両方変わって視覚インパクトが大きいため。 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 強み */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-green-800 mb-3">強み</h3>
          <ImprovementList
            items={analysis.strengths}
            variant="success"
            density="relaxed"
          />
        </div>

        {/* 弱み・補強ポイント */}
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-orange-800 mb-3">補強ポイント</h3>
          <ImprovementList
            items={analysis.weaknesses}
            variant="warning"
            density="relaxed"
          />
        </div>
      </div>

      {/* 将来とのつながり */}
      <div className="bg-purple-50 border border-purple-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-purple-800 mb-3">将来とのつながり（仮説）</h3>
        <ul className="space-y-2">
          {analysis.futureConnections.map((f, i) => (
            <li key={i} className="flex gap-2 text-sm text-purple-900">
              <span className="text-purple-400 mt-0.5 shrink-0">→</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
