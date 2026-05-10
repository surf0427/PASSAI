'use client';

import { useState } from 'react';
import type { DeepDiveSession, CompletedDeepDive } from '@/hooks/useDeepDive';
import { getSummaryForPhrase } from '@/lib/deepDiveQuestions';
import { StructureMapping } from '@/components/StructureMapping';
import { Textarea } from '@/components/ui/Textarea';

// ── セッション進行中パネル ─────────────────────────────────────────

type SessionProps = {
  session: DeepDiveSession;
  isComplete: boolean;
  onAnswer: (answer: string) => void;
  onBack: () => void;
  onClose: () => void;
  onRewrite: () => void;
};

export function DeepDivePanel({ session, isComplete, onAnswer, onBack, onClose, onRewrite }: SessionProps) {
  return (
    <div className="border border-blue-200 rounded-lg mt-2 overflow-hidden">
      {isComplete ? (
        <CompletionView session={session} onClose={onClose} onRewrite={onRewrite} />
      ) : (
        <QuestionView session={session} onAnswer={onAnswer} onBack={onBack} onClose={onClose} />
      )}
    </div>
  );
}

// ── 1問ずつ表示 ───────────────────────────────────────────────────

function QuestionView({
  session,
  onAnswer,
  onBack,
  onClose,
}: {
  session: DeepDiveSession;
  onAnswer: (answer: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const { questions, currentIndex } = session;
  const total = questions.length;

  function handleNext() {
    if (!text.trim()) return;
    onAnswer(text);
    setText('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleNext();
    }
  }

  return (
    <>
      <div className="bg-blue-50 px-5 py-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-blue-700">
          具体化ワーク　{currentIndex + 1} / {total}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-blue-500 hover:text-blue-700"
        >
          閉じる
        </button>
      </div>

      <div className="h-1 bg-blue-100">
        <div
          className="h-1 bg-blue-400 transition-all"
          style={{ width: `${(currentIndex / total) * 100}%` }}
        />
      </div>

      <div className="bg-white px-5 py-5">
        <p className="text-sm font-semibold text-gray-800 mb-4 leading-relaxed">
          {questions[currentIndex]}
        </p>

        <Textarea
          key={currentIndex}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={4}
          placeholder="思ったことをそのまま書いてください。上手く書く必要はありません。"
          className="leading-relaxed resize-y"
        />

        <p className="text-xs text-gray-400 mt-1 mb-4">
          Cmd / Ctrl + Enter でも次へ進めます
        </p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleNext}
            disabled={!text.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors"
          >
            {currentIndex + 1 < total ? '次へ' : '完了'}
          </button>
          {currentIndex > 0 && (
            <button
              type="button"
              onClick={onBack}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              前の質問に戻る
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ── 完了後サマリー ────────────────────────────────────────────────

function CompletionView({
  session,
  onClose,
  onRewrite,
}: {
  session: DeepDiveSession;
  onClose: () => void;
  onRewrite: () => void;
}) {
  const summary = getSummaryForPhrase(session.phrase);

  return (
    <>
      <div className="bg-green-50 px-5 py-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-green-700">
          具体化ワーク　完了
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-green-600 hover:text-green-800"
        >
          閉じる
        </button>
      </div>

      <div className="bg-white px-5 py-6 space-y-6">

        {/* あなたが出した材料 */}
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-3">あなたが出した材料</p>
          <ul className="space-y-2">
            {session.answers.map((ans, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-800 leading-relaxed">
                <span className="text-gray-400 shrink-0 mt-0.5">・</span>
                <span className="whitespace-pre-wrap">{ans}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 追加すべき段落 */}
        <div className="border-t border-gray-100 pt-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">追加すべき段落</p>
          <p className="text-sm text-gray-800">{summary.recommendedParagraph}</p>
        </div>

        {/* 構造マッピング */}
        <div className="border-t border-gray-100 pt-5">
          <StructureMapping
            strengthened={summary.strengthenedElements}
            missing={summary.missingElements}
          />
        </div>

        {/* 書き直す時の注意点 */}
        <div className="border-t border-gray-100 pt-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">書き直す時の注意点</p>
          <p className="text-sm text-gray-700 leading-relaxed bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            {summary.caution}
          </p>
        </div>

        {/* チェックリスト */}
        <div className="border-t border-gray-100 pt-5">
          <p className="text-xs font-semibold text-gray-500 mb-3">
            この材料を本文に反映するためのチェックリスト
          </p>
          <ul className="space-y-2">
            {summary.checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id={`cl-${session.phrase}-${i}`}
                  className="mt-0.5 shrink-0 accent-blue-600"
                />
                <label
                  htmlFor={`cl-${session.phrase}-${i}`}
                  className="text-sm text-gray-700 cursor-pointer leading-relaxed"
                >
                  {item}
                </label>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-400 mt-3 leading-relaxed">
            上の材料と注意点をもとに、自分の言葉で志望理由書を書き直してみましょう。
          </p>
        </div>

        {/* 書き直しCTA */}
        <div className="border-t border-gray-100 pt-5">
          <button
            type="button"
            onClick={onRewrite}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
          >
            <span>▶</span>
            <span>この内容をもとに書き直す</span>
          </button>
          <p className="text-xs text-gray-400 text-center mt-2">
            入力欄へ移動し、書き直しガイドを表示します
          </p>
        </div>

      </div>
    </>
  );
}

// ── 過去の完了結果を確認するビュー ────────────────────────────────

export function DeepDiveReviewPanel({
  result,
  onClose,
  onRewrite,
}: {
  result: CompletedDeepDive;
  onClose: () => void;
  onRewrite: () => void;
}) {
  const summary = getSummaryForPhrase(result.phrase);

  return (
    <div className="border border-gray-200 rounded-lg mt-2 overflow-hidden">
      <div className="bg-gray-50 px-5 py-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600">過去の回答を確認</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          閉じる
        </button>
      </div>

      <div className="bg-white px-5 py-6 space-y-6">

        {/* Q&A まとめ */}
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-3">回答まとめ</p>
          <div className="space-y-3">
            {result.questions.map((q, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">{q}</p>
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {result.answers[i] ?? '（未回答）'}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* 追加すべき段落 */}
        <div className="border-t border-gray-100 pt-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">追加すべき段落</p>
          <p className="text-sm text-gray-800">{summary.recommendedParagraph}</p>
        </div>

        {/* 構造マッピング */}
        <div className="border-t border-gray-100 pt-5">
          <StructureMapping
            strengthened={summary.strengthenedElements}
            missing={summary.missingElements}
          />
        </div>

        {/* 書き直す時の注意点 */}
        <div className="border-t border-gray-100 pt-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">書き直す時の注意点</p>
          <p className="text-sm text-gray-700 leading-relaxed bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            {summary.caution}
          </p>
        </div>

        {/* チェックリスト */}
        <div className="border-t border-gray-100 pt-5">
          <p className="text-xs font-semibold text-gray-500 mb-3">
            この材料を本文に反映するためのチェックリスト
          </p>
          <ul className="space-y-2">
            {summary.checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id={`rv-${result.phrase}-${i}`}
                  className="mt-0.5 shrink-0 accent-blue-600"
                />
                <label
                  htmlFor={`rv-${result.phrase}-${i}`}
                  className="text-sm text-gray-700 cursor-pointer leading-relaxed"
                >
                  {item}
                </label>
              </li>
            ))}
          </ul>
        </div>

        {/* 書き直しCTA */}
        <div className="border-t border-gray-100 pt-5">
          <button
            type="button"
            onClick={onRewrite}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
          >
            <span>▶</span>
            <span>この内容をもとに書き直す</span>
          </button>
          <p className="text-xs text-gray-400 text-center mt-2">
            入力欄へ移動し、書き直しガイドを表示します
          </p>
        </div>

      </div>
    </div>
  );
}
