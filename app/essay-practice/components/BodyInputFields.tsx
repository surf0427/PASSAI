// 小論文練習フローのステップ 3「本文入力」JSX block。
// STEP-PAGE-06b で app/essay-practice/page.tsx から物理切り出し。
//
// 役割:
//   pure props rendering。`currentStep === 3` でのみ描画される。
//   構成ガイド + ミニ思考欄の参照表示（read-only）+ 本文 textarea + 文字数カウント + 進行ボタン。
//   state は parent (EssayPracticePage) が保持し、setter / proceed callback を props で受ける。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard / refs / state
//   - cache identity（hashEssayReviewInput の入力 essayBody / conclusion / reasonOne / reasonTwo を渡しているが、
//     その文字列の意味と setter 経路は不変。本 component は UI 表示と onChange を中継するだけ）
//   - step machine（onProceed は parent 側で `setCurrentStep(4)` + 条件付き saveEssayProgress を closure 化したものを受ける）

'use client';

import { Textarea } from '@/components/ui/Textarea';

export function BodyInputFields({
  essayBody,
  setEssayBody,
  conclusion,
  reasonOne,
  reasonTwo,
  onProceed,
}: {
  essayBody: string;
  setEssayBody: (v: string) => void;
  conclusion: string;
  reasonOne: string;
  reasonTwo: string;
  onProceed: () => void;
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
      <h2 className="text-base font-semibold text-gray-700 mb-2">本文入力</h2>
      <p className="text-sm text-gray-500 mb-6">
        ミニ思考欄をもとに、自分の言葉で小論文を書いてください。完璧である必要はありません。
      </p>

      {/* 構成ガイド */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
        <p className="text-xs font-semibold text-gray-500 mb-2">書くときのチェックポイント</p>
        <ul className="space-y-1">
          <li className="text-xs text-gray-600">・序論：問題提起を書けているか</li>
          <li className="text-xs text-gray-600">・本論①：理由①が書けているか</li>
          <li className="text-xs text-gray-600">・本論②：理由②が書けているか</li>
          <li className="text-xs text-gray-600">・結論：自分の考えで締めているか</li>
        </ul>
      </div>

      {/* ミニ思考欄の参照 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5">
        <p className="text-xs font-semibold text-blue-600 mb-3">ミニ思考欄（参照用）</p>
        <div className="space-y-2">
          <div>
            <span className="text-xs text-blue-500 font-medium">結論：</span>
            <span className="text-xs text-gray-700">{conclusion || '（未入力）'}</span>
          </div>
          <div>
            <span className="text-xs text-blue-500 font-medium">理由①：</span>
            <span className="text-xs text-gray-700">{reasonOne || '（未入力）'}</span>
          </div>
          <div>
            <span className="text-xs text-blue-500 font-medium">理由②：</span>
            <span className="text-xs text-gray-700">{reasonTwo || '（未入力）'}</span>
          </div>
        </div>
      </div>

      {/* 本文textarea
          section 見出し（h2「本文入力」）が label を兼ねているため
          FormField でラップせず Textarea primitive 直に置換。
          長文用に leading-relaxed と resize-y を className で追加。 */}
      <div className="mb-3">
        <Textarea
          value={essayBody}
          onChange={(e) => setEssayBody(e.target.value)}
          rows={15}
          placeholder={'ここに小論文を書いてください。\nミニ思考欄で書いた内容をもとに広げていきましょう。'}
          className="leading-relaxed resize-y"
        />
      </div>

      {/* 文字数カウント */}
      <p className="text-xs text-gray-400 mb-8">
        文字数：{essayBody.length}文字
      </p>

      <button
        type="button"
        onClick={onProceed}
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
      >
        壁打ちAIへ進む
      </button>
    </section>
  );
}
