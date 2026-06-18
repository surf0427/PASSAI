'use client';

// 発表後 Q&A 練習（result 画面内）。/api/presentation/qa の generate / review に接続。
// 音声入力なし・課金なし。今セッションのやり取りは画面内 state で表示し、review 成功時は
// サーバ側で DB（presentation_qa_reviews）へ永続化される（保存失敗時も体験は止めない）。
// 過去の永続化分は別コンポーネント PastPresentationQaHistory が表示する。
//
// フロー: 質問を生成 → テキスト回答 → AI が短いフィードバック → DB保存 → 次の質問を出す。

import { useState } from 'react';

import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';

type Review = {
  goodPoints: string[];
  improvements: string[];
  modelAnswerDirection: string;
};

type Pair = { question: string; answer: string; review: Review };

type QaStatus = 'idle' | 'question' | 'reviewing' | 'reviewed';

const ANSWER_MAX = 8000;

export function PostPresentationQa({ attemptId }: { attemptId: string }) {
  const [qaStatus, setQaStatus] = useState<QaStatus>('idle');
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [history, setHistory] = useState<Pair[]>([]);
  const [askedQuestions, setAskedQuestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // review は成功したが DB 保存に失敗したときの通知（体験は止めない）。
  const [saveError, setSaveError] = useState(false);

  async function generateQuestion() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/presentation/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt_id: attemptId,
          action: 'generate',
          asked_questions: askedQuestions,
        }),
      });
      if (!res.ok) {
        setError('質問の生成に失敗しました。もう一度お試しください。');
        return;
      }
      const json = (await res.json()) as { question?: string };
      if (!json.question) {
        setError('質問の生成に失敗しました。もう一度お試しください。');
        return;
      }
      setCurrentQuestion(json.question);
      setAskedQuestions((prev) => [...prev, json.question as string]);
      setAnswer('');
      setQaStatus('question');
    } catch {
      setError('通信エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  async function reviewAnswer() {
    if (!currentQuestion) return;
    const trimmed = answer.trim();
    if (!trimmed) {
      setError('回答を入力してください。');
      return;
    }
    setError(null);
    setSaveError(false);
    setBusy(true);
    setQaStatus('reviewing');
    try {
      const res = await fetch('/api/presentation/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt_id: attemptId,
          action: 'review',
          question: currentQuestion,
          answer_text: trimmed,
        }),
      });
      if (!res.ok) {
        setError('回答の評価に失敗しました。もう一度お試しください。');
        setQaStatus('question');
        return;
      }
      const json = (await res.json()) as { review?: Review; saved?: boolean };
      if (!json.review) {
        setError('回答の評価に失敗しました。もう一度お試しください。');
        setQaStatus('question');
        return;
      }
      setHistory((prev) => [
        ...prev,
        { question: currentQuestion, answer: trimmed, review: json.review as Review },
      ]);
      // フィードバックは表示しつつ、永続化失敗だけを別途通知する（次の質問へは進める）。
      setSaveError(json.saved === false);
      setQaStatus('reviewed');
    } catch {
      setError('通信エラーが発生しました。時間をおいて再度お試しください。');
      setQaStatus('question');
    } finally {
      setBusy(false);
    }
  }

  function nextQuestion() {
    setCurrentQuestion(null);
    setAnswer('');
    setSaveError(false);
    void generateQuestion();
  }

  return (
    <Card padding="lg" className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">発表後Q&A練習</h2>
        <p className="mt-1 text-sm text-slate-600 leading-relaxed">
          発表後に聞かれやすい質問への対応を練習できます。回答後、AI が改善点を返します。
        </p>
      </div>

      {/* これまでの Q&A 履歴（画面内 state） */}
      {history.length > 0 && (
        <div className="space-y-3">
          {history.map((pair, i) => (
            <div
              key={i}
              className="space-y-2 rounded-lg border border-slate-200 p-3"
            >
              <p className="text-sm font-semibold text-slate-800">Q{i + 1}. {pair.question}</p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">
                <span className="text-slate-500">あなたの回答: </span>
                {pair.answer}
              </p>
              <ReviewView review={pair.review} />
            </div>
          ))}
        </div>
      )}

      {/* 進行中の質問 */}
      {qaStatus === 'question' || qaStatus === 'reviewing' ? (
        <div className="space-y-3">
          {currentQuestion && (
            <p className="text-sm font-semibold text-slate-800">
              Q{history.length + 1}. {currentQuestion}
            </p>
          )}
          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={ANSWER_MAX}
            rows={5}
            placeholder="質問への回答を入力してください。"
            disabled={busy}
          />
          <Button
            variant="primary"
            onClick={() => void reviewAnswer()}
            disabled={busy || !answer.trim()}
          >
            {qaStatus === 'reviewing' ? '評価中…' : '回答を評価する'}
          </Button>
        </div>
      ) : null}

      {error && <AlertBox variant="error">{error}</AlertBox>}
      {saveError && (
        <AlertBox variant="warning">
          履歴の保存に失敗しました。フィードバックはこのまま確認でき、次の質問にも進めます。
        </AlertBox>
      )}

      {/* 操作ボタン */}
      {qaStatus === 'idle' && (
        <Button variant="primary" onClick={() => void generateQuestion()} disabled={busy}>
          {busy ? '生成中…' : '質問を生成する'}
        </Button>
      )}
      {qaStatus === 'reviewed' && (
        <Button variant="secondary" onClick={nextQuestion} disabled={busy}>
          {busy ? '生成中…' : '次の質問を出す'}
        </Button>
      )}
    </Card>
  );
}

function ReviewView({ review }: { review: Review }) {
  return (
    <div className="space-y-2 rounded-md bg-slate-50 p-3">
      <ReviewList title="良かった点" items={review.goodPoints} />
      <ReviewList title="改善点" items={review.improvements} />
      <div>
        <p className="text-xs font-semibold text-slate-800">模範回答の方向性</p>
        <p className="text-sm leading-relaxed text-slate-700">
          {review.modelAnswerDirection}
        </p>
      </div>
    </div>
  );
}

function ReviewList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-slate-800">{title}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-sm leading-relaxed text-slate-700">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
