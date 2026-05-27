// 小論文練習フローのステップ 2「ミニ思考欄」JSX block。
// STEP-PAGE-06 で app/essay-practice/page.tsx から物理切り出し。
//
// 役割:
//   pure props rendering。`currentStep === 2` でのみ描画される。
//   結論 / 理由① / 理由② の 3 つの 1 文 input と「本文入力へ進む」ボタンだけを返す。
//   state は parent (EssayPracticePage) が保持し、setter / proceed callback を props で受ける。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard / refs / state
//   - cache identity（hashEssayReviewInput の入力 conclusion/reasonOne/reasonTwo を渡しているが、
//     その文字列の意味と setter 経路は不変。本 component は UI 表示と onChange を中継するだけ）
//   - step machine（onProceed は parent 側で `setCurrentStep(3)` を closure 化したものを受ける）

'use client';

import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';

export function MiniThoughtFields({
  conclusion,
  setConclusion,
  reasonOne,
  setReasonOne,
  reasonTwo,
  setReasonTwo,
  onProceed,
}: {
  conclusion: string;
  setConclusion: (v: string) => void;
  reasonOne: string;
  setReasonOne: (v: string) => void;
  reasonTwo: string;
  setReasonTwo: (v: string) => void;
  onProceed: () => void;
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
      <h2 className="text-base font-semibold text-gray-700 mb-2">ミニ思考欄</h2>
      <p className="text-sm text-gray-500 mb-6">
        短くてOKです。完璧に書く必要はありません。まずは考えの起点を作りましょう。
      </p>

      {/* 結論 */}
      <div className="mb-6">
        <FormField
          label="① あなたの結論（1文）"
          hint="完璧な結論でなくて大丈夫です。思いついた順で書いてみましょう。"
        >
          <Input
            type="text"
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            placeholder="〇〇は△△だと考える"
          />
        </FormField>
      </div>

      {/* 理由① */}
      <div className="mb-6">
        <FormField
          label="② 理由①"
          hint="短くてOK。1 文で書いてみてください。"
        >
          <Input
            type="text"
            value={reasonOne}
            onChange={(e) => setReasonOne(e.target.value)}
            placeholder="理由を1文で書いてください"
          />
        </FormField>
      </div>

      {/* 理由② */}
      <div className="mb-8">
        <FormField
          label="③ 理由②"
          hint="①と違う角度から。1 つしか思いつかなければ空欄でも大丈夫です。"
        >
          <Input
            type="text"
            value={reasonTwo}
            onChange={(e) => setReasonTwo(e.target.value)}
            placeholder="別の視点から理由を書いてください"
          />
        </FormField>
      </div>

      <button
        type="button"
        onClick={onProceed}
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
      >
        本文入力へ進む
      </button>
    </section>
  );
}
