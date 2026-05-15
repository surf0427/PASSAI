'use client';

import { useState, useEffect, useRef } from 'react';
import { getConfig, TOTAL_QUESTIONS } from '@/lib/qualityDeepDive';
import type { QualityType, QualityMessage } from '@/lib/qualityDeepDive';
import { Button } from '@/components/ui/Button';

type Props = {
  qualityType: QualityType;
  onInsert: (text: string) => void;
  onClose: () => void;
};

export function QualityDeepDive({ qualityType, onInsert, onClose }: Props) {
  const config = getConfig(qualityType);
  const firstQuestion = config.questions[0].question;

  const [messages, setMessages] = useState<QualityMessage[]>([
    { role: 'ai', content: firstQuestion },
  ]);
  const [input, setInput] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);

  const isComplete = questionIndex >= TOTAL_QUESTIONS;

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || isComplete) return;

    const currentQ = config.questions[questionIndex];
    const nextIndex = questionIndex + 1;
    const nextQ = config.questions[nextIndex] ?? null;

    setMessages((prev) => {
      const updated: QualityMessage[] = [
        ...prev,
        { role: 'user', content: trimmed },
        { role: 'feedback', content: currentQ.feedbackAfterAnswer },
      ];
      if (nextQ) {
        updated.push({ role: 'ai', content: nextQ.question });
      }
      return updated;
    });

    setQuestionIndex(nextIndex);
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function buildInsertText(): string {
    const answers = messages
      .filter((m) => m.role === 'user')
      .map((m) => `・${m.content}`)
      .join('\n');
    return `▼ 深掘りで出てきた内容\n${answers}`;
  }

  return (
    <div className="border border-blue-200 rounded-lg mt-2 overflow-hidden">
      {/* ヘッダー */}
      <div className="bg-blue-50 px-4 py-2.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-blue-700">
          深掘りワーク（{Math.min(questionIndex, TOTAL_QUESTIONS)} / {TOTAL_QUESTIONS} 問）
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-blue-500 hover:text-blue-700"
        >
          閉じる
        </button>
      </div>

      {/* 進捗バー */}
      <div className="h-1 bg-blue-100">
        <div
          className="h-1 bg-blue-400 transition-all"
          style={{
            width: `${(Math.min(questionIndex, TOTAL_QUESTIONS) / TOTAL_QUESTIONS) * 100}%`,
          }}
        />
      </div>

      {/* メッセージ一覧 */}
      <div className="bg-white px-4 py-4 space-y-3 max-h-72 overflow-y-auto">
        {messages.map((msg, i) => {
          if (msg.role === 'feedback') {
            return (
              <div key={i} className="text-center">
                <span className="text-xs text-gray-400 italic">{msg.content}</span>
              </div>
            );
          }
          return (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                  msg.role === 'ai'
                    ? 'bg-blue-50 text-blue-900'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {msg.content}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* 入力欄 or 完了画面 */}
      {isComplete ? (
        <div className="bg-green-50 border-t border-green-200 px-4 py-4 space-y-3">
          <p className="text-xs font-semibold text-green-800">書き方ヒント</p>
          <p className="text-sm text-green-700 leading-relaxed">
            {config.writingHint}
          </p>
          <button
            type="button"
            onClick={() => { onInsert(buildInsertText()); onClose(); }}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors"
          >
            この内容を本文に反映する
          </button>
        </div>
      ) : (
        <div className="bg-white border-t border-gray-100 px-4 py-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="回答を入力（Enter で送信 / Shift+Enter で改行）"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
          <div className="flex justify-end mt-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!input.trim()}
            >
              送信
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
