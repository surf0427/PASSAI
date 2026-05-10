'use client';

import { useState } from 'react';
import { getSummaryForPhrase } from '@/lib/deepDiveQuestions';
import type { StructureElement } from '@/lib/deepDiveQuestions';

type Props = {
  phrase: string;
  answers: string[];
  onClose: () => void;
};

const MISSING_ACTIONS: Record<StructureElement, string> = {
  'きっかけ': 'その関心を持つようになった具体的な出来事・体験を書いてください',
  '課題': 'その時に直面した困難・うまくいかなかったことを書いてください',
  '行動': 'あなたが実際に何をしたか・どんな工夫をしたかを書いてください',
  '学び': 'その経験から何に気づいた・どう考えが変わったかを書いてください',
  '将来目標': '大学卒業後にどうなりたいか・何を実現したいかを書いてください',
  '大学との接続': 'なぜこの大学・学部でなければならないかを具体的に書いてください',
};

export function RewriteGuide({ phrase, answers, onClose }: Props) {
  const summary = getSummaryForPhrase(phrase);
  const [checked, setChecked] = useState<boolean[]>(() =>
    new Array(summary.checklist.length).fill(false)
  );

  const doneCount = checked.filter(Boolean).length;
  const total = summary.checklist.length;

  function toggle(i: number) {
    setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)));
  }

  return (
    <div className="bg-blue-50 border border-blue-300 rounded-xl p-5 mb-5">

      {/* ヘッダー */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-semibold text-blue-600 mb-0.5">書き直しガイド</p>
          <h3 className="text-sm font-bold text-blue-900">
            「{phrase}」の書き直し用メモ（コピペOK）
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-xs text-blue-400 hover:text-blue-600 border border-blue-200 rounded px-2 py-1"
        >
          閉じる
        </button>
      </div>

      <div className="space-y-5">

        {/* 壁打ちで出た材料 */}
        <div>
          <p className="text-xs font-semibold text-blue-700 mb-2">壁打ちで出た材料</p>
          <ul className="space-y-1.5 bg-white border border-blue-200 rounded-lg p-3">
            {answers.map((ans, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-800 leading-relaxed">
                <span className="text-blue-300 shrink-0 mt-0.5 select-none">・</span>
                <span className="whitespace-pre-wrap">{ans}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 追加先 + 強化要素 */}
        <div className="bg-white border border-blue-200 rounded-lg p-3">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-xs font-semibold text-blue-700 shrink-0">追加先</span>
            <span className="text-sm text-gray-800">{summary.recommendedParagraph}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-blue-700 shrink-0">強化要素</span>
            <span className="text-sm text-green-700">
              {summary.strengthenedElements.join(' / ')}
            </span>
          </div>
        </div>

        {/* 不足要素のアクション */}
        {summary.missingElements.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-blue-700 mb-2">まだ不足している要素</p>
            <ul className="space-y-2">
              {summary.missingElements.map((el) => (
                <li key={el} className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                  <p className="text-sm font-medium text-yellow-800 mb-0.5">
                    ⚠ {el}が不足しています
                  </p>
                  <p className="text-xs text-gray-600">
                    → {MISSING_ACTIONS[el]}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* チェックリスト（進捗バー付き） */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-blue-700">
              チェックリスト　{doneCount} / {total} 完了
            </p>
            {doneCount === total && (
              <span className="text-xs font-semibold text-green-600">提出レベルに到達！</span>
            )}
            {doneCount > 0 && doneCount < total && (
              <span className="text-xs text-gray-500">あと{total - doneCount}つで提出レベル</span>
            )}
          </div>

          <div className="h-2 bg-blue-100 rounded-full mb-3 overflow-hidden">
            <div
              className="h-2 bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${total > 0 ? (doneCount / total) * 100 : 0}%` }}
            />
          </div>

          <ul className="space-y-2">
            {summary.checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id={`rg-${phrase}-${i}`}
                  checked={checked[i]}
                  onChange={() => toggle(i)}
                  className="mt-0.5 shrink-0 accent-blue-600"
                />
                <label
                  htmlFor={`rg-${phrase}-${i}`}
                  className={`text-sm cursor-pointer leading-relaxed ${
                    checked[i] ? 'line-through text-gray-400' : 'text-gray-700'
                  }`}
                >
                  {item}
                </label>
              </li>
            ))}
          </ul>
        </div>

      </div>
    </div>
  );
}
