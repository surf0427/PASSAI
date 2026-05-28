// 自己PR 履歴カード 1 行分。STEP-PAGE-05b で app/self-pr/page.tsx の selfPRs.map(...) 内側から
// 物理切り出し。selfPRs.length === 0 の empty-state は STEP-PAGE-05 で別 component（EmptyState）に
// 切り出し済み。
//
// 役割:
//   pure props rendering。selfPRs の 1 entry を受け取り、回数バッジ / 作成日 / 添削済みバッジ /
//   タイトル / 本文プレビュー / 「自己分析の深掘りを修正する →」リンク / 削除ボタンを表示する。
//   state / useEffect / useRef / fetch / router / storage を一切持たない。
//
// 触らない:
//   - selfPRs storage 形式（SelfPR 型）
//   - openPR / deletePR / goToSelfAnalysisAnswering の本体ロジック（parent に温存）
//   - mode=direct / from=run の URL flow
//   - seedInputHash / cache identity
//
// callback の id 渡し:
//   parent は selfPRs.map 内側で pr を closure している。本 component は pr.id を引数に乗せて
//   呼び出すが、parent の closure は id 引数を無視して直接 openPR(pr) / deletePR(pr.id) に
//   流す形でよい（TypeScript の関数引数 contravariance により () => void / (id: string) => void は
//   割り当て可能）。
//
// formatDateTime は parent の同名関数と structurally identical な local duplicate。
// resolveTitle は本 component が唯一の consumer のため、parent から移送した。
// 共通 utils.ts 化は本 STEP 系列の禁止事項のため、self-contained 維持。

'use client';

import type { SelfPR } from '@/types/selfPR';

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${h}:${min}`;
}

// タイトルが未入力の場合に本文冒頭20文字を使う
function resolveTitle(pr: SelfPR): string {
  if (pr.title && pr.title.trim()) return pr.title.trim();
  if (pr.text.trim()) return pr.text.trim().slice(0, 20) + (pr.text.trim().length > 20 ? '…' : '');
  return '（本文未入力）';
}

export function PrListItem({
  pr,
  onSelect,
  onDelete,
  onGoToSelfAnalysisAnswering,
}: {
  pr: SelfPR;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onGoToSelfAnalysisAnswering: () => void;
}) {
  return (
    <div
      className="relative bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm rounded-xl transition-all overflow-hidden"
    >
      {/* カード本体: クリックで自己PR添削フォームを開く */}
      <button
        type="button"
        onClick={() => onSelect(pr.id)}
        className="w-full text-left p-6 pr-16"
      >
        {/* 上段：回数・日時・添削済みバッジ */}
        <div className="flex items-center gap-3 mb-2">
          <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-full shrink-0">
            {pr.index}回目
          </span>
          <span className="text-xs text-gray-400">
            {formatDateTime(pr.createdAt ?? pr.updatedAt)} 作成
          </span>
          {pr.latestResult && (
            <span className="text-xs text-green-600 font-medium ml-auto shrink-0">
              添削済み
            </span>
          )}
        </div>

        {/* タイトル */}
        <p className="text-sm font-semibold text-gray-700 mb-1">
          {resolveTitle(pr)}
        </p>

        {/* 本文プレビュー */}
        <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
          {pr.text || '（本文未入力）'}
        </p>
      </button>

      {/* 自己分析の深掘りへの導線 */}
      <div className="border-t border-gray-100 px-6 py-3">
        <button
          type="button"
          onClick={onGoToSelfAnalysisAnswering}
          className="text-sm font-semibold text-blue-600 hover:text-blue-800"
        >
          自己分析の深掘りを修正する →
        </button>
      </div>

      {/* 削除ボタン */}
      <button
        type="button"
        onClick={() => onDelete(pr.id)}
        className="absolute top-4 right-4 text-xs text-gray-300 hover:text-red-500 hover:bg-red-50 rounded px-2 py-1 transition-colors"
      >
        削除
      </button>
    </div>
  );
}
