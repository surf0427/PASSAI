// STEP6.11/6.12: 確認画面の logical view。
//   STEP6.11 で page.tsx 内 top-level function として切り出し、STEP6.12 で
//   feature-local component file として physical split した。state ownership は
//   page (AdmissionMatchingPage) に維持し、本ファイルは props を受け取って render する
//   pure-ish 関数。UI / className / render 順 / 文言は page 内に同居していた時点から無変更。

import Link from 'next/link';
import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { SelfPR } from '@/types/selfPR';
import type { WallHittingResult } from '@/types/analysis';
import BasicInfoSummary from '@/components/shared/BasicInfoSummary';
import { StrengthWeaknessGrid } from '@/components/shared/result';
import { ActivitySummary } from './ActivitySummary';

export type ConfirmViewProps = {
  missingItems: string[];
  basicFormData: BasicInfo;
  activityData: ActivityData | null;
  wallHitting: WallHittingResult | null;
  selfPRs: SelfPR[];
  hasCachedResult: boolean;
  cachedTimestamp: string | null;
  onStartMatching: () => void;
  onShowCached: () => void;
};

export function ConfirmView({
  missingItems,
  basicFormData,
  activityData,
  wallHitting,
  selfPRs,
  hasCachedResult,
  cachedTimestamp,
  onStartMatching,
  onShowCached,
}: ConfirmViewProps) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">AI志望校マッチング</h1>
      <p className="text-sm text-gray-500 mb-8">
        以下の入力情報をもとに診断します。内容を確認してから診断を開始してください。
      </p>

      {/* 不足データ警告 */}
      {missingItems.length > 0 && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-yellow-800 mb-2">
            以下のデータが未入力のため、マッチング精度が下がっています
          </p>
          <ul className="space-y-1 mb-3">
            {missingItems.map((item) => (
              <li key={item} className="text-sm text-yellow-700 flex items-center gap-2 flex-wrap">
                <span>⚠</span>
                <span>{item}が未入力です</span>
                {item === '基本情報' && (
                  <a href="/input/basic" className="text-blue-600 underline">入力する →</a>
                )}
                {item === '活動整理' && (
                  <a href="/input/activity" className="text-blue-600 underline">入力する →</a>
                )}
                {item === '自己分析添削' && (
                  <Link href="/self-pr" className="text-blue-600 underline">入力する →</Link>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-yellow-700">💡 入力するとマッチング精度が上がります</p>
        </div>
      )}

      {/* 基本情報 */}
      <BasicInfoSummary basicInfo={basicFormData} editHref="/input/basic" />

      {/* 活動整理 */}
      <section className="mb-5 bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide">活動整理</h2>
          <a href="/input/activity" className="text-xs text-blue-600 hover:underline">編集する</a>
        </div>
        {activityData ? (
          <ActivitySummary activityData={activityData} />
        ) : (
          <p className="text-sm text-yellow-600">⚠ 活動整理が未入力です</p>
        )}
      </section>

      {/* 自己分析 */}
      <section className="mb-8 bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">自己分析</h2>
        {wallHitting ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700 leading-relaxed">{wallHitting.summary}</p>
            <StrengthWeaknessGrid
              strengths={wallHitting.strengths}
              weaknesses={wallHitting.weaknesses}
              maxItems={3}
            />
          </div>
        ) : selfPRs.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-2">自己PR添削履歴</p>
            {selfPRs.slice(0, 2).map((pr, i) => (
              <div key={i} className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
                {pr.title || pr.text.slice(0, 30) + '…'}
              </div>
            ))}
            <p className="text-xs text-orange-600 mt-2">
              ⚠ AI壁打ちが未実施です。自己分析を行うとマッチング精度が上がります。
            </p>
          </div>
        ) : (
          <p className="text-sm text-yellow-600">⚠ 自己分析が未実施です</p>
        )}
      </section>

      {/* 診断ボタン */}
      <button
        type="button"
        onClick={onStartMatching}
        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-4 rounded-xl text-base transition-colors"
      >
        志望校マッチングをする
      </button>
      {!wallHitting && (
        <p className="text-xs text-gray-400 text-center mt-2">
          ※ AI壁打ちが未実施のため、基本スコアのみでのマッチングになります
        </p>
      )}
      {hasCachedResult && (
        <div className="mt-3">
          <button
            type="button"
            onClick={onShowCached}
            className="w-full border border-gray-300 hover:bg-gray-50 text-gray-600 font-medium px-6 py-3 rounded-xl text-sm transition-colors"
          >
            以前の診断結果を見る
          </button>
          {cachedTimestamp && (
            <p className="text-xs text-gray-400 text-center mt-1">
              前回診断：{new Date(cachedTimestamp).toLocaleString('ja-JP', {
                year: 'numeric', month: 'numeric', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
          )}
          <p className="text-xs text-gray-400 text-center mt-0.5">
            ※再計算せず、前回保存した結果を表示します
          </p>
        </div>
      )}
    </div>
  );
}
