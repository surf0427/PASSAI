'use client';

import { useState } from 'react';
import type { NgWordIssue } from '@/lib/detectNgWords';
import { useDeepDive } from '@/hooks/useDeepDive';
import { DeepDivePanel, DeepDiveReviewPanel } from '@/components/DeepDivePanel';
import { QualityDeepDive } from '@/components/QualityDeepDive';
import { Card } from '@/components/ui/Card';

type Props = {
  issues: NgWordIssue[];
  onStartRewrite: (phrase: string, answers: string[]) => void;
  onInsertStarterHint: (hint: string) => void;
};

const QUALITY_LABELS: Record<NonNullable<NgWordIssue['qualityType']>, string> = {
  length: '文章量不足',
  specificity: '具体性不足',
  experience: '経験・行動不足',
  universityConnection: '大学・学部との接続不足',
};

const QUALITY_SUMMARY_LABELS: Record<NonNullable<NgWordIssue['qualityType']>, string> = {
  length: '情報量が不足しています',
  specificity: '具体的な経験が見えにくいです',
  experience: '自分が何をしたかが伝わりにくいです',
  universityConnection: '大学との接続が弱いです',
};

function PriorityBadge({ severity }: { severity: NgWordIssue['severity'] }) {
  if (severity === 'high') {
    return (
      <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-2 py-0.5">
        優先度：高
      </span>
    );
  }
  return (
    <span className="text-xs font-semibold text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-0.5">
      優先度：中
    </span>
  );
}

export function NgWordCheck({ issues, onStartRewrite, onInsertStarterHint }: Props) {
  const { active, completed, isComplete, start, submitAnswer, goBack, close } = useDeepDive();
  const [reviewingPhrase, setReviewingPhrase] = useState<string | null>(null);
  const [copiedPhrase, setCopiedPhrase] = useState<string | null>(null);
  // quality カードの深掘りパネル管理（issue.phrase をキーとして使う）
  const [activeQualityDive, setActiveQualityDive] = useState<string | null>(null);

  async function handleCopy(hint: string, key: string) {
    try {
      await navigator.clipboard.writeText(hint);
    } catch {
      // clipboard API が使えない環境でも落ちない
    }
    setCopiedPhrase(key);
    setTimeout(() => setCopiedPhrase((prev) => (prev === key ? null : prev)), 2000);
  }

  function handleStart(issue: NgWordIssue) {
    setReviewingPhrase(null);
    close();
    start(issue);
  }

  function handleReview(phrase: string) {
    close();
    setReviewingPhrase((prev) => (prev === phrase ? null : phrase));
  }

  const qualityCount = issues.filter((i) => i.kind === 'quality').length;
  const phraseCount = issues.filter((i) => i.kind === 'phrase').length;

  return (
    <Card className="mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">
        抽象表現・文章品質チェック
      </h3>

      {issues.length === 0 ? (
        <p className="text-sm text-gray-500 leading-relaxed">
          目立つ抽象表現は見つかりませんでした。ただし、具体的な経験・数字・固有名詞が入っているかは自分でも確認しましょう。
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-4">
            {qualityCount > 0 && `品質指摘 ${qualityCount} 件`}
            {qualityCount > 0 && phraseCount > 0 && '・'}
            {phraseCount > 0 && `抽象表現 ${phraseCount} 件`}
            が見つかりました。優先度の高いものから取り組みましょう。
          </p>

          {/* quality系 全体サマリー */}
          {qualityCount > 0 && (() => {
            const summaryItems = issues
              .filter((i) => i.kind === 'quality' && i.qualityType)
              .slice(0, 3);
            return (
              <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 mb-4">
                <p className="text-xs font-semibold text-orange-800 mb-2">
                  この文章はまずここを直しましょう
                </p>
                <ul className="space-y-1">
                  {summaryItems.map((issue, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-sm text-orange-800">
                      <span className="shrink-0 mt-0.5">・</span>
                      <span>
                        {issue.severity === 'high' && (
                          <span className="font-semibold">【重要】</span>
                        )}
                        {issue.qualityType
                          ? QUALITY_SUMMARY_LABELS[issue.qualityType]
                          : issue.phrase}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          <div className="space-y-3">
            {issues.map((issue, i) => {
              const isSessionActive = active?.phrase === issue.phrase;
              const isDone = completed[issue.phrase] != null;
              const isReviewing = reviewingPhrase === issue.phrase;
              const isQualityDiveActive = activeQualityDive === issue.phrase;

              return (
                <div key={i}>
                  {issue.kind === 'quality' ? (
                    /* ── Quality カード ── */
                    <>
                    <div
                      className={`border rounded-lg p-4 ${
                        issue.severity === 'high'
                          ? 'bg-red-50 border-red-300'
                          : 'bg-orange-50 border-orange-200'
                      }`}
                    >
                      {/* ヘッダー */}
                      <div className="flex items-center gap-2 mb-3">
                        <PriorityBadge severity={issue.severity} />
                        <span className={`text-sm font-bold ${
                          issue.severity === 'high' ? 'text-red-900' : 'text-orange-900'
                        }`}>
                          {issue.qualityType ? QUALITY_LABELS[issue.qualityType] : issue.phrase}
                        </span>
                      </div>

                      <div className="space-y-3">
                        {/* 最初に直すべき理由 */}
                        {issue.priorityReason && (
                          <div className={`rounded-md px-3 py-2 text-sm font-medium ${
                            issue.severity === 'high'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-orange-100 text-orange-800'
                          }`}>
                            {issue.priorityReason}
                          </div>
                        )}

                        {/* 指摘内容 */}
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-0.5">指摘内容</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{issue.reason}</p>
                        </div>

                        {/* 不足している要素 */}
                        {issue.missingElements && issue.missingElements.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1">不足している要素</p>
                            <ul className="space-y-1">
                              {issue.missingElements.map((el, j) => (
                                <li key={j} className="flex items-start gap-1.5 text-sm text-gray-700">
                                  <span className="shrink-0 text-gray-400 mt-0.5">・</span>
                                  <span>{el}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* 改善の方向性 */}
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-0.5">改善の方向性</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{issue.suggestion}</p>
                        </div>

                        {/* 書き出しヒント */}
                        {issue.starterHint && (
                          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                            <p className="text-xs font-semibold text-gray-500 mb-1.5">
                              まずこの一文から書き始めてみましょう
                            </p>
                            <p className="text-sm text-gray-800 leading-relaxed mb-2">
                              {issue.starterHint}
                            </p>
                            <p className="text-xs text-gray-500 mb-3">
                              💡 この一文は型です。必ずあなた自身の経験に書き換えてください。
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleCopy(issue.starterHint!, issue.phrase)}
                                className={`text-xs border rounded px-3 py-1.5 transition-all duration-200 flex items-center gap-1 ${
                                  copiedPhrase === issue.phrase
                                    ? 'text-green-600 bg-green-50 border-green-300'
                                    : 'text-gray-500 hover:text-gray-700 border-gray-200 hover:border-gray-300'
                                }`}
                              >
                                {copiedPhrase === issue.phrase ? '✔ コピーしました' : 'コピーする'}
                              </button>
                              <button
                                type="button"
                                onClick={() => onInsertStarterHint(issue.starterHint!)}
                                className="text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-3 py-1.5 transition-colors"
                              >
                                本文に入れる
                              </button>
                            </div>
                          </div>
                        )}

                        {/* 深掘りボタン */}
                        {issue.qualityType && !isQualityDiveActive && (
                          <div className="pt-3 border-t border-gray-100 mt-1">
                            <button
                              type="button"
                              onClick={() => setActiveQualityDive(issue.phrase)}
                              className="text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg px-3 py-1.5 transition-colors"
                            >
                              この部分を深掘りする
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 深掘りパネル */}
                    {isQualityDiveActive && issue.qualityType && (
                      <QualityDeepDive
                        qualityType={issue.qualityType}
                        onInsert={onInsertStarterHint}
                        onClose={() => setActiveQualityDive(null)}
                      />
                    )}
                    </>
                  ) : (
                    /* ── Phrase カード（抽象表現） ── */
                    <div
                      className={`border rounded-lg p-4 transition-colors ${
                        isSessionActive ? 'bg-amber-50 border-blue-300' : 'bg-amber-50 border-amber-200'
                      }`}
                    >
                      {/* ヘッダー */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-amber-600 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">
                            抽象表現
                          </span>
                          <span className="text-sm font-semibold text-amber-900">
                            「{issue.phrase}」
                          </span>
                        </div>
                        {isDone && !isSessionActive && (
                          <span className="shrink-0 text-xs font-semibold text-green-600 bg-green-50 border border-green-200 rounded px-2 py-0.5">
                            回答済み
                          </span>
                        )}
                      </div>

                      <div className="space-y-2 mb-4">
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-0.5">なぜ弱いか</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{issue.reason}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-0.5">具体化の方向性</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{issue.suggestion}</p>
                        </div>
                        {issue.activityHint && (
                          <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mt-1">
                            <p className="text-xs font-semibold text-blue-700 mb-0.5">
                              あなたの活動データより
                            </p>
                            <p className="text-xs text-blue-700 leading-relaxed">{issue.activityHint}</p>
                          </div>
                        )}
                      </div>

                      {/* アクションボタン */}
                      <div className="flex flex-wrap gap-2">
                        {!isSessionActive && (
                          <button
                            type="button"
                            onClick={() => handleStart(issue)}
                            className="text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg px-3 py-1.5 transition-colors"
                          >
                            この部分を具体化する
                          </button>
                        )}
                        {isSessionActive && !isComplete && (
                          <button
                            type="button"
                            onClick={close}
                            className="text-xs text-gray-400 hover:text-gray-600"
                          >
                            閉じる
                          </button>
                        )}
                        {isDone && !isSessionActive && (
                          <button
                            type="button"
                            onClick={() => handleReview(issue.phrase)}
                            className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-1.5 transition-colors"
                          >
                            {isReviewing ? '回答を閉じる' : '回答を確認する'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 壁打ちパネル（phrase カードのみ） */}
                  {isSessionActive && active && (
                    <DeepDivePanel
                      session={active}
                      isComplete={isComplete}
                      onAnswer={submitAnswer}
                      onBack={goBack}
                      onClose={close}
                      onRewrite={() => {
                        onStartRewrite(active.phrase, active.answers);
                        close();
                      }}
                    />
                  )}

                  {/* 過去の回答確認パネル（phrase カードのみ） */}
                  {isReviewing && !isSessionActive && isDone && (
                    <DeepDiveReviewPanel
                      result={completed[issue.phrase]}
                      onClose={() => setReviewingPhrase(null)}
                      onRewrite={() => {
                        onStartRewrite(issue.phrase, completed[issue.phrase].answers);
                        setReviewingPhrase(null);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
