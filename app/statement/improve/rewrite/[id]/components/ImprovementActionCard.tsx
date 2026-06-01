// 改善ポイント card（v4: 「どこを直すか」を明示する実行 card）。
// STEP-PAGE-03 で page.tsx の inline 定義から切り出し。
//
// 役割:
//   pure props rendering。state / useEffect / useRef を持たず、parent (RewritePrep) が渡す
//   answers / onChange を経由して workAnswers の更新を依頼するだけ。
//   filledCount は props (questions / answers) から都度計算する derived value。
//
// 1 suggestion = 1 details カード。closed default。
// summary に「改善ポイント①」+ axis chip + filled count + diff を出し、開くと
//   1. weaknessText（analysis 由来の essay-specific 指摘 / fallback: reasoning）
//   2. 現在の本文（excerptText, pickRelevantExcerpt の heuristic 抽出 / null なら非表示）
//   3. actionText（"改善するには" + analysis 由来の具体アクション / fallback: comment）
//   4. 本文に入れる素材（static questions、existing autosave 経路は不変）
//   5. 具体的な書き換え例（Before/After、generic だが補助として残す）
// が並ぶ。textarea の value/onChange は親（RewritePrep）の workAnswers state を更新する。
// storage shape（axisKey × questionKey × string）は STEP-WORK-2 から変更なし。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard / refs / state
//   - autosave 不変条件（state + ref + effect は親に温存）
//
// AxisExample 型は page.tsx 側の正本と structurally identical な型を本ファイル内に duplicate する。
// 共通 type ファイル化は本 STEP の禁止事項（self-contained 維持）。

'use client';

import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import type { ImprovementSuggestion } from '@/lib/improvementSuggestions';
import type { RewriteWorkQuestion } from '@/lib/statement/rewrite/rewriteWorkQuestions';
import { BeforeAfter } from './BeforeAfter';

type AxisExample = {
  before: string;
  after: string;
  hint: string;
};

export function ImprovementActionCard({
  index,
  suggestion,
  axisKey,
  questions,
  answers,
  onChange,
  weaknessText,
  actionText,
  excerptText,
  example,
  source,
}: {
  index: number;
  suggestion: ImprovementSuggestion;
  axisKey: string;
  questions: RewriteWorkQuestion[];
  answers: Partial<Record<string, string>>;
  onChange: (axisKey: string, questionKey: string, value: string) => void;
  weaknessText: string;
  actionText: string;
  excerptText: string | null;
  example: AxisExample | undefined;
  // STEP-STATEMENT-FALLBACK-01:
  //   weaknessText / actionText の出力元。
  //   'ai'       : 両方とも分析レポート由来（pickAnalysisForAxes が hit）
  //   'partial'  : weakness / action の片方だけ AI 由来、片方は generic 軸テンプレ
  //   'fallback' : 両方とも generic 軸テンプレ（pickAnalysisForAxes が hit せず）
  //   省略時は 'ai' 扱いで従来挙動を維持（後方互換）。
  source?: 'ai' | 'partial' | 'fallback';
}) {
  const filledCount = questions.reduce(
    (n, q) => n + (answers[q.key] && answers[q.key]!.length > 0 ? 1 : 0),
    0,
  );
  return (
    <details className="group rounded-xl border border-slate-200 bg-white hover:border-violet-200 hover:shadow-sm transition-colors">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center gap-3 px-4 sm:px-5 py-4">
        <span className="inline-flex items-center justify-center size-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold tabular-nums shrink-0">
          {index + 1}
        </span>
        <h3 className="text-base font-semibold text-slate-900 flex-1 min-w-0 truncate">
          改善ポイント{index + 1}
        </h3>
        <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 tracking-wide">
          {suggestion.label}
        </span>
        <span
          className={`text-xs tabular-nums ${
            filledCount > 0 && filledCount === questions.length
              ? 'text-violet-700 font-semibold'
              : 'text-slate-400'
          }`}
        >
          {filledCount}/{questions.length}
        </span>
        {suggestion.diff > 0 && (
          <span className="text-xs text-slate-500 tabular-nums">
            +{suggestion.diff}
          </span>
        )}
        <span className="shrink-0 text-slate-400 transition-transform group-open:rotate-180 inline-block text-sm leading-none">
          ▾
        </span>
      </summary>
      <div className="space-y-5 px-4 sm:px-5 pb-5 pt-1">
        {/* STEP-STATEMENT-FALLBACK-01: AI 由来でない場合の注意文。
            両方 fallback のときは「テンプレートを表示しています」、片方だけ AI のときは
            「一部の内容は基本テンプレートで表示されています」と文面を切り替える。 */}
        {source === 'fallback' && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
            <p className="text-xs text-amber-800 leading-relaxed">
              この軸は分析レポートから具体的な指摘が取得できなかったため、基本テンプレートを表示しています。必要に応じて再分析をお試しください。
            </p>
          </div>
        )}
        {source === 'partial' && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
            <p className="text-xs text-amber-800 leading-relaxed">
              一部の内容は基本テンプレートで表示されています。必要に応じて再分析をお試しください。
            </p>
          </div>
        )}
        {/* 1. analysis 由来の essay-specific な指摘（card の主役） */}
        <p className="text-sm text-slate-800 leading-relaxed break-words">
          {weaknessText}
        </p>
        {/* 2. 現在の本文（v4: essay から heuristic 抽出した「直す対象の 1 文」）。
            該当無しの場合は表示しない。長文は line-clamp で視覚的に丸める（本体は保持）。
            UI polish: rewrite flow の accent である violet を使って「直す対象」を視覚的にマーク。 */}
        {excerptText && (
          <div className="rounded-lg bg-violet-50/50 border-l-2 border-violet-300 px-4 py-3">
            <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider mb-1.5">
              現在の本文
            </p>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words line-clamp-4">
              「{excerptText}」
            </p>
          </div>
        )}
        {/* 3. 改善するには（analysis 由来 / fallback: generic comment）。
            左 border の薄い accent で「現在の本文 → 改善するには → 質問」の視線誘導を補助。 */}
        <div className="border-l-2 border-slate-200 pl-3">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            改善するには
          </p>
          <p className="text-sm text-slate-600 leading-relaxed break-words">
            {actionText}
          </p>
        </div>
        {/* 4. 本文に入れる素材（static questions × autosave） */}
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
            本文に入れる素材
          </p>
          <div className="space-y-5">
            {questions.map((q) => {
              const fieldId = `work-${axisKey}-${q.key}`;
              const value = answers[q.key] ?? '';
              return (
                <div key={q.key}>
                  <Label htmlFor={fieldId} className="text-sm">
                    {q.label}
                  </Label>
                  <Textarea
                    id={fieldId}
                    value={value}
                    onChange={(e) => onChange(axisKey, q.key, e.target.value)}
                    rows={3}
                    placeholder={q.placeholder}
                    className="leading-relaxed resize-y"
                  />
                </div>
              );
            })}
          </div>
        </div>
        {/* 5. 参考の書き換え例（軸 generic な Before/After。analysis 由来ではない補助情報） */}
        {example && (
          <details className="group/inner">
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center gap-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              <span>具体的な書き換え例（参考）</span>
              <span className="text-slate-400 transition-transform group-open/inner:rotate-180 inline-block text-sm leading-none">
                ▾
              </span>
            </summary>
            <div className="pt-3">
              <BeforeAfter example={example} />
            </div>
          </details>
        )}
      </div>
    </details>
  );
}
