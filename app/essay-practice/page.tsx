'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  saveEssayProgress,
  saveReviewResult,
  loadReviewResult,
  formatReviewDate,
  type ReviewResult,
  type SavedReview,
} from '@/lib/essayPracticeStorage';
import type { BasicInfo } from '@/types/basicInfo';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import BasicInfoSummary from '@/components/shared/BasicInfoSummary';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { FormField } from '@/components/ui/FormField';
import { ImprovementList } from '@/components/shared/result';

// マウント前 false / マウント後 true を返す flag。
// loadReviewResult() / loadBasicInfo() は localStorage 依存のため SSR では null を返したい。
// useSyncExternalStore の getServerSnapshot/getSnapshot で setState なしにこの semantics を表現する。
// （STEP9/10/14/15 と同形パターン）
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

const TOTAL_STEPS = 5;
const CHAT_MAX_COUNT = 3;

const DEFAULT_THEME = 'AI時代において、大学教育はどのように変化すべきか。あなたの考えを述べなさい。';

type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
};

const CHAT_SUGGESTIONS = [
  'この理由で弱いところは？',
  '反対意見ってどんなのがある？',
  'もっと具体例ある？',
];

export default function EssayPracticePage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [conclusion, setConclusion] = useState('');
  const [reasonOne, setReasonOne] = useState('');
  const [reasonTwo, setReasonTwo] = useState('');
  const [essayBody, setEssayBody] = useState('');
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [prevReviewResult, setPrevReviewResult] = useState<ReviewResult | null>(null);
  const [reviewHistory, setReviewHistory] = useState<ReviewResult[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  // savedReview は (1) マウント時に loadReviewResult() で初期化し、
  // (2) API 添削成功時 (handleEssayReview の最後) に上書きされる。
  // post-API の上書き値だけを useState で持ち、マウント時の値は useMemo([isMounted]) で結合する
  // ことで、useEffect 内で setState する形(react-hooks/set-state-in-effect)を回避する。
  // 既存の setSavedReview 呼び出し側はそのまま動くよう setter 名は維持する。
  const [postApiSavedReview, setSavedReview] = useState<SavedReview | null>(null);

  // basicInfo は両 API（chat / review）に同梱して、AI が志望大学・学部・学科・文理・受験方式を踏まえた回答を返せるようにする。
  // localStorage を直接読まず、共通関数 loadBasicInfo() を経由する。null フォールバック対応済み。
  // マウント前は null、マウント後に loadBasicInfo() を 1度だけ呼んで以降は memo 値を返す。
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  const mountedSavedReview = useMemo<SavedReview | null>(
    () => (isMounted ? loadReviewResult() : null),
    [isMounted],
  );
  const savedReview: SavedReview | null = postApiSavedReview ?? mountedSavedReview;
  const basicInfo = useMemo<BasicInfo | null>(
    () => (isMounted ? loadBasicInfo() : null),
    [isMounted],
  );

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatRemainingCount, setChatRemainingCount] = useState(CHAT_MAX_COUNT);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');

  async function handleChatSubmit() {
    if (!chatInput.trim() || chatRemainingCount === 0 || chatLoading) return;

    const userQuestion = chatInput.trim();
    const userMessage: ChatMessage = { role: 'user', text: userQuestion };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput('');
    setChatLoading(true);
    setChatError('');

    try {
      const res = await fetch('/api/essay-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, conclusion, reasonOne, reasonTwo, essayBody, userQuestion, basicInfo }),
      });

      const data = await res.json();

      if (!res.ok) {
        setChatError(data.error ?? 'AIの処理に失敗しました。時間をおいてお試しください。');
        return;
      }

      const aiMessage: ChatMessage = { role: 'assistant', text: data.reply };
      setChatMessages((prev) => [...prev, aiMessage]);
      setChatRemainingCount((prev) => prev - 1);
    } catch {
      setChatError('通信エラーが発生しました。インターネット接続を確認してください。');
    } finally {
      setChatLoading(false);
    }
  }

  function handleStart() {
    setCurrentStep(2);
  }

  function handleBack() {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  }

  async function handleReviewEssay() {
    setReviewLoading(true);
    setReviewError('');

    try {
      const res = await fetch('/api/essay-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, conclusion, reasonOne, reasonTwo, essayBody, basicInfo }),
      });

      const data = await res.json();

      if (!res.ok) {
        setReviewError(data.error ?? 'AIの処理に失敗しました。時間をおいてお試しください。');
        return;
      }

      const newResult = data as ReviewResult;
      const saved: SavedReview = {
        ...newResult,
        updatedAt: new Date().toISOString(),
        essayBodySnapshot: essayBody,
      };

      const previousResult = reviewHistory.length > 0
        ? reviewHistory[reviewHistory.length - 1]
        : null;
      setPrevReviewResult(previousResult);
      setReviewHistory([...reviewHistory, newResult]);
      setReviewResult(newResult);
      saveReviewResult(newResult, essayBody);
      setSavedReview(saved);
      setCurrentStep(5);
      saveEssayProgress({ hasContent: true, hasReview: true });
    } catch {
      setReviewError('通信エラーが発生しました。インターネット接続を確認してください。');
    } finally {
      setReviewLoading(false);
    }
  }

  function handleViewSavedReview() {
    if (!savedReview) return;
    setReviewResult(savedReview);
    setCurrentStep(5);
  }

  function handleReset() {
    setCurrentStep(1);
    setReviewResult(null);
    setPrevReviewResult(null);
    setReviewHistory([]);
    setReviewLoading(false);
    setReviewError('');
    setTheme(DEFAULT_THEME);
    setConclusion('');
    setReasonOne('');
    setReasonTwo('');
    setEssayBody('');
    setChatMessages([]);
    setChatInput('');
    setChatRemainingCount(CHAT_MAX_COUNT);
    setChatLoading(false);
    setChatError('');
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">

      {/* ── ページタイトル・説明 ── */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-3">小論文練習AI</h1>
        <p className="text-gray-600 text-sm leading-relaxed">
          テーマに沿って小論文を書き、AIからフィードバックを受けながら論述力を高めます。
        </p>
        <p className="text-gray-500 text-xs mt-1">
          ※AIが代わりに書くのではなく、自分の力で書けるようにサポートします。
        </p>
      </div>

      <BasicInfoSummary basicInfo={basicInfo} />

      {/* ── ステップ表示 ── */}
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {currentStep > 1 && (
            <button
              type="button"
              onClick={handleBack}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded px-3 py-1.5 transition-colors"
            >
              ← 戻る
            </button>
          )}
          <p className="text-sm text-gray-500">
            ステップ <span className="font-semibold text-gray-700">{currentStep}</span> / {TOTAL_STEPS}
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 hover:border-gray-300 rounded px-3 py-1.5 transition-colors"
        >
          新しいテーマで始める
        </button>
      </div>

      {/* ── ステップ1：テーマ入力 ── */}
      {currentStep === 1 && (
        <section className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
          <h2 className="text-base font-semibold text-gray-700 mb-5">ステップ1：テーマ確認</h2>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-gray-700">小論文テーマ</p>
              <span className="text-xs text-gray-400">変更不可</span>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-800 leading-relaxed">
              {theme}
            </div>
          </div>

          <button
            type="button"
            onClick={handleStart}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
          >
            このテーマで始める
          </button>
        </section>
      )}

      {/* ── ステップ2以降：テーマ確定表示（編集不可） ── */}
      {currentStep >= 2 && (
        <section className="mb-8">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-blue-600">テーマ</p>
              <span className="text-xs text-blue-400">確定済み・変更不可</span>
            </div>
            <p className="text-sm text-gray-800 leading-relaxed">{theme}</p>
          </div>
        </section>
      )}

      {/* ── ステップ2：ミニ思考欄 ── */}
      {currentStep === 2 && (
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
                placeholder="大学教育は〇〇すべきである"
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
            onClick={() => setCurrentStep(3)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
          >
            本文入力へ進む
          </button>
        </section>
      )}

      {/* ── ステップ3：本文入力 ── */}
      {currentStep === 3 && (
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
            onClick={() => {
              setCurrentStep(4);
              if (essayBody.trim()) saveEssayProgress({ hasContent: true, hasReview: false });
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
          >
            壁打ちAIへ進む
          </button>
        </section>
      )}

      {/* ── ステップ4：壁打ちAI相談 ── */}
      {currentStep === 4 && (
        <section className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
          <h2 className="text-base font-semibold text-gray-700 mb-2">壁打ちAI相談</h2>
          <p className="text-sm text-gray-500 mb-2">
            AIは答えを作るのではなく、あなたの思考を深めるサポートをします。
          </p>

          {/* 残り回数 */}
          <p className="text-sm mb-6">
            残り
            <span className={`font-bold mx-1 ${chatRemainingCount === 0 ? 'text-red-500' : 'text-blue-600'}`}>
              {chatRemainingCount}
            </span>
            回
          </p>

          {/* メッセージ一覧 */}
          {chatMessages.length > 0 && (
            <div className="space-y-3 mb-5">
              {chatMessages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs sm:max-w-md px-4 py-2.5 rounded-xl text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 相談例ボタン */}
          <div className="flex flex-wrap gap-2 mb-4">
            {CHAT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setChatInput(suggestion)}
                className="text-xs border border-gray-300 hover:border-blue-400 hover:text-blue-600 text-gray-500 rounded-full px-3 py-1 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>

          {/* ローディング */}
          {chatLoading && (
            <p className="text-sm text-gray-400 mb-4">AIが考えています...</p>
          )}

          {/* エラー */}
          {chatError && (
            <p className="text-sm text-red-500 mb-4">{chatError}</p>
          )}

          {/* 入力欄 */}
          <div className="flex gap-2 mb-8">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleChatSubmit(); }}
              placeholder="AIに相談したいことを入力してください"
              disabled={chatRemainingCount === 0 || chatLoading}
              className="flex-1 border border-slate-300 rounded-lg px-4 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleChatSubmit}
              disabled={!chatInput.trim() || chatRemainingCount === 0 || chatLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors"
            >
              {chatLoading ? '送信中...' : '相談する'}
            </button>
          </div>

          {reviewError && (
            <p className="text-sm text-red-500 mb-4">{reviewError}</p>
          )}
          {savedReview?.essayBodySnapshot !== undefined && essayBody !== savedReview.essayBodySnapshot && (
            <p className="text-xs text-amber-600 mb-3">
              本文が変更されています。前回の添削結果は古い可能性があります。
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleReviewEssay}
              disabled={reviewLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              {reviewLoading ? 'AIが添削中...' : 'AI添削する'}
            </button>
            {savedReview && (
              <button
                type="button"
                onClick={handleViewSavedReview}
                disabled={reviewLoading}
                className="bg-white hover:bg-gray-50 disabled:opacity-50 border border-blue-300 text-blue-600 font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
              >
                前回の添削結果を見る（{formatReviewDate(savedReview.updatedAt)}）
              </button>
            )}
            <button
              type="button"
              onClick={() => { setCurrentStep(3); setReviewError(''); }}
              disabled={reviewLoading}
              className="bg-white hover:bg-gray-50 disabled:opacity-50 border border-gray-300 text-gray-600 font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              本文に戻る
            </button>
          </div>
        </section>
      )}

      {/* ── ステップ5：AI添削結果 ── */}
      {currentStep === 5 && reviewResult && (
        <section className="mb-8">
          <h2 className="text-xl font-bold text-gray-800 mb-6">AI添削結果</h2>

          {/* 総合評価 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-4 mb-2">
              <span className="text-4xl font-bold text-blue-700">{reviewResult.totalScore}</span>
              <div>
                <p className="text-sm font-semibold text-blue-800">総合評価</p>
                <p className="text-xs text-blue-600">/ 100点</p>
              </div>
              <span className="ml-auto text-sm font-semibold text-blue-700 bg-blue-100 px-3 py-1 rounded-full">
                {reviewResult.verdict}
              </span>
            </div>
          </div>

          {/* 前回との比較（2回目以降の添削時のみ表示） */}
          {prevReviewResult && (() => {
            const scoreDiff = reviewResult.totalScore - prevReviewResult.totalScore;
            const diffLabel = scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff < 0 ? `${scoreDiff}` : '±0';
            const cardColor = scoreDiff > 0 ? 'bg-green-50 border-green-200' : scoreDiff < 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200';
            const titleColor = scoreDiff > 0 ? 'text-green-800' : scoreDiff < 0 ? 'text-red-800' : 'text-gray-700';
            const title = scoreDiff > 0 ? '成長しました' : scoreDiff < 0 ? '見直しが必要です' : '同じ水準です';

            // breakdown の差分リストを作る（label が一致する項目同士で比較）
            // currScore / prevScore も持たせて、後の表示ループで再検索しないようにする
            const breakdownDiffs = reviewResult.breakdown.map((curr) => {
              const prev = prevReviewResult.breakdown.find((b) => b.label === curr.label);
              return {
                label: curr.label,
                currScore: curr.score,
                prevScore: prev?.score ?? curr.score,
                diff: prev ? curr.score - prev.score : 0,
              };
            });

            // スコアが上がった中で最大の項目 / 下がった中で最小の項目を取得
            const mostImproved = breakdownDiffs.reduce((a, b) => (b.diff > a.diff ? b : a));
            const mostDropped = breakdownDiffs.reduce((a, b) => (b.diff < a.diff ? b : a));

            const message =
              scoreDiff > 0
                ? `特に「${mostImproved.label}」が +${mostImproved.diff} 点改善されています。`
                : scoreDiff < 0
                ? `特に「${mostDropped.label}」が ${mostDropped.diff} 点下がっています。本文の該当部分を見直しましょう。`
                : '大きな点数変化はありません。改善提案をもとに、次は具体例や反対意見への対応を強化しましょう。';

            return (
              <div className={`border rounded-xl p-5 mb-6 ${cardColor}`}>
                <h3 className={`text-sm font-bold mb-3 ${titleColor}`}>{title}</h3>

                {/* totalScore 比較 */}
                <p className="text-sm text-gray-700 mb-3">
                  前回：<span className="font-semibold">{prevReviewResult.totalScore}点</span>
                  　→　今回：<span className="font-semibold">{reviewResult.totalScore}点</span>
                  　<span className={`font-bold ${scoreDiff > 0 ? 'text-green-600' : scoreDiff < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                    （{diffLabel}）
                  </span>
                </p>

                {/* breakdown 比較（breakdownDiffs を再利用して重複検索を避ける） */}
                <div className="space-y-1">
                  {breakdownDiffs.map(({ label, prevScore, currScore, diff }) => {
                    const diffStr = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '±0';
                    const diffColor = diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-500' : 'text-gray-400';
                    return (
                      <p key={label} className="text-xs text-gray-600">
                        {label}：{prevScore} → {currScore}
                        <span className={`ml-1 font-semibold ${diffColor}`}>（{diffStr}）</span>
                      </p>
                    );
                  })}
                </div>

                <p className="text-xs text-gray-500 mt-3">{message}</p>
              </div>
            );
          })()}

          {/* 内訳 */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">内訳</h3>
            <div className="space-y-4">
              {reviewResult.breakdown.length === 0 ? (
                <p className="text-sm text-gray-400">内訳データを取得できませんでした。再度添削をお試しください。</p>
              ) : (
                reviewResult.breakdown.map((item) => {
                  const percentage = (item.score / 20) * 100;
                  const barColor =
                    percentage >= 80 ? 'bg-green-500' : percentage >= 60 ? 'bg-yellow-400' : 'bg-red-400';
                  return (
                    <div key={item.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-gray-700">{item.label}</span>
                        <span className="text-sm font-semibold text-gray-700">{item.score} / 20</span>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 改善提案 */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold text-yellow-800 mb-2">改善提案</h3>
            <p className="text-sm text-yellow-900 leading-relaxed">{reviewResult.improvement}</p>
          </div>

          {/* 良かった点
              ラッパー（bg-green-50 + h3）は raw 維持。リストだけ ImprovementList に置換。
              variant="success" は ✓ + text-green-700 で元の見た目とほぼ一致する
              （prefix span に shrink-0 が付く点だけ差分。長文折り返し時の整列が改善）。 */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold text-green-800 mb-2">良かった点</h3>
            <ImprovementList items={reviewResult.goodPoints} variant="success" />
          </div>

          {/* まだ弱い点 */}
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-8">
            <h3 className="text-sm font-semibold text-red-800 mb-2">まだ弱い点</h3>
            <ul className="space-y-1">
              {reviewResult.weakPoints.map((w, i) => (
                <li key={i} className="text-sm text-red-700 flex gap-2">
                  <span>△</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 添削履歴（2回以上添削した場合のみ表示） */}
          {reviewHistory.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">添削履歴</h3>
              <div className="space-y-1">
                {reviewHistory.map((item, index) => (
                  <p key={index} className="text-sm text-gray-600">
                    {index + 1}回目：
                    <span className="font-semibold text-gray-800">{item.totalScore}点</span>
                    　{item.verdict}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* アクションボタン */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setCurrentStep(3)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              改善して再提出する
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-600 font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              最初からやり直す
            </button>
          </div>
        </section>
      )}

    </div>
  );
}
