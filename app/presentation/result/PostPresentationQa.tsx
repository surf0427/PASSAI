'use client';

// 発表後 Q&A 練習（result 画面内）。/api/presentation/qa の generate / review に接続。
// 音声入力なし・課金なし。
//
// 仕様: 質問は 5 問固定。1 問ごとに「質問 → テキスト回答 → AI フィードバック → DB 保存」。
//   5 問目の回答が終わったら新しい質問は生成せず「Q&A練習は終了しました。」と既存導線を表示する。
//
// 状態管理（セッション単位）: 各交換は review 成功時にサーバが presentation_qa_reviews へ保存する
//   （1 行 = 1 交換）。本コンポーネントはマウント時にその保存済み行を読み込んで復元するため、
//   途中リロードしても「回答済みの問数」から再開できる（Q3 なら Q3 から、Q5 なら終了画面）。
//   質問数の正準値は DB の保存件数で、クライアントだけに依存しない（サーバも 5 問で打ち切る）。

import { useCallback, useEffect, useRef, useState } from 'react';

import { getBrowserSupabaseClient } from '@/lib/supabase/browserClient';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';
import { Textarea } from '@/components/ui/Textarea';

import { PresentationFinalReport } from './PresentationFinalReport';

type Review = {
  goodPoints: string[];
  improvements: string[];
  modelAnswerDirection: string;
};

type Pair = { question: string; answer: string; review: Review };

type QaStatus = 'idle' | 'question' | 'reviewing' | 'reviewed';

type Level = 'weak' | 'normal' | 'strong';

// Q&A 全体（5問）の総合評価（presentation_results.qa_summary）。
type QaSummary = {
  categories: Record<string, unknown>;
  goodPoints: string[];
  improvements: string[];
  overallComment: string;
};

const ANSWER_MAX = 8000;
// Q&A は 5 問固定（サーバの PRESENTATION_QA_MAX_QUESTIONS と一致させる）。
const QA_MAX_QUESTIONS = 5;

// Q&A 総合評価の 5 軸（サーバの QA_SUMMARY_CATEGORY_KEYS と一致）。
const QA_SUMMARY_DIMENSIONS: { key: string; label: string }[] = [
  { key: 'understanding', label: '質問理解力' },
  { key: 'logic', label: '論理性' },
  { key: 'depth', label: '回答の深さ' },
  { key: 'responsiveness', label: '受け答え' },
  { key: 'persuasion', label: '説得力' },
];

const LEVEL_LABEL: Record<Level, string> = {
  weak: '要改善',
  normal: '標準',
  strong: '良い',
};
const LEVEL_CLASS: Record<Level, string> = {
  weak: 'bg-amber-100 text-amber-800',
  normal: 'bg-slate-100 text-slate-700',
  strong: 'bg-emerald-100 text-emerald-800',
};

function isLevel(v: unknown): v is Level {
  return v === 'weak' || v === 'normal' || v === 'strong';
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function parseReview(v: unknown): Review {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return {
    goodPoints: toStringArray(o.goodPoints),
    improvements: toStringArray(o.improvements),
    modelAnswerDirection:
      typeof o.modelAnswerDirection === 'string' ? o.modelAnswerDirection : '',
  };
}

function parseSummary(v: unknown): QaSummary {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return {
    categories:
      o.categories && typeof o.categories === 'object'
        ? (o.categories as Record<string, unknown>)
        : {},
    goodPoints: toStringArray(o.goodPoints),
    improvements: toStringArray(o.improvements),
    overallComment:
      typeof o.overallComment === 'string' ? o.overallComment : '',
  };
}

export function PostPresentationQa({ attemptId }: { attemptId: string }) {
  // DB から保存済み交換を復元するまでは loaded=false（ボタンを出さない）。
  const [loaded, setLoaded] = useState(false);
  const [qaStatus, setQaStatus] = useState<QaStatus>('idle');
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [history, setHistory] = useState<Pair[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // review は成功したが DB 保存に失敗したときの通知（体験は止めない）。
  const [saveError, setSaveError] = useState(false);

  // Q&A 全体（5問）の総合評価。DB（presentation_results.qa_summary）から復元 or 5問完了時に生成。
  const [qaSummary, setQaSummary] = useState<QaSummary | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle',
  );
  // 総合評価の自動生成を 1 回だけに抑えるガード（再レンダ・StrictMode 二重実行の重複生成防止）。
  const summaryStartedRef = useRef(false);

  // 回答済みの問数 = 保存済み交換の数。これが質問番号・終了判定の正準値。
  const answeredCount = history.length;
  const finished = answeredCount >= QA_MAX_QUESTIONS;
  // 重複回避のため既出の質問文をサーバへ渡す（サーバも DB 側で重複除外する）。
  const askedQuestions = history.map((p) => p.question);

  // マウント時: 保存済みの Q&A 交換（presentation_qa_reviews）と総合評価（presentation_results.qa_summary）を
  // RLS owner SELECT で復元。リロード・履歴からの再表示でも結果が壊れない。
  useEffect(() => {
    let cancelled = false;
    async function loadExisting() {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) {
        if (!cancelled) setLoaded(true);
        return;
      }
      const { data } = await supabase
        .from('presentation_qa_reviews')
        .select('turn_index, question, answer_text, review')
        .eq('attempt_id', attemptId)
        .order('turn_index', { ascending: true });
      if (cancelled) return;
      const pairs: Pair[] = (data ?? []).map((r) => ({
        question: typeof r.question === 'string' ? r.question : '',
        answer: typeof r.answer_text === 'string' ? r.answer_text : '',
        review: parseReview(r.review),
      }));
      setHistory(pairs);

      // 総合評価（保存済みなら復元。列未適用・未保存は null のまま＝後で生成）。
      const { data: resultRow } = await supabase
        .from('presentation_results')
        .select('qa_summary')
        .eq('attempt_id', attemptId)
        .maybeSingle();
      if (cancelled) return;
      if (resultRow?.qa_summary) {
        setQaSummary(parseSummary(resultRow.qa_summary));
        // 既に存在するので自動生成は不要。
        summaryStartedRef.current = true;
      }
      setLoaded(true);
    }
    void loadExisting();
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  // Q&A 全体の総合評価を生成・保存する（サーバ側で冪等: 既存があれば AI を呼ばず返す）。
  const runSummary = useCallback(async () => {
    setSummaryStatus('loading');
    try {
      const res = await fetch('/api/presentation/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempt_id: attemptId, action: 'summary' }),
      });
      if (!res.ok) {
        setSummaryStatus('error');
        return;
      }
      const json = (await res.json()) as { summary?: unknown };
      if (!json.summary) {
        setSummaryStatus('error');
        return;
      }
      setQaSummary(parseSummary(json.summary));
      setSummaryStatus('idle');
    } catch {
      setSummaryStatus('error');
    }
  }, [attemptId]);

  // 5 問完了かつ総合評価が未取得なら、1 度だけ自動生成する。
  useEffect(() => {
    if (!loaded || !finished || qaSummary || summaryStartedRef.current) return;
    summaryStartedRef.current = true;
    void runSummary();
  }, [loaded, finished, qaSummary, runSummary]);

  async function generateQuestion() {
    if (finished) return;
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
      if (res.status === 409) {
        // 既に 5 問完了（別タブ等）。質問は出さず終了画面へ（finished は answeredCount 依存だが、
        // 念のため進行中の入力欄を閉じる）。
        setCurrentQuestion(null);
        setQaStatus('idle');
        return;
      }
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
      setAnswer('');
      setQaStatus('question');
    } catch {
      setError('通信エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  async function reviewAnswer() {
    if (!currentQuestion || finished) return;
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
      if (res.status === 409) {
        // 既に 5 問完了。終了状態へ倒す。
        setCurrentQuestion(null);
        setQaStatus('idle');
        return;
      }
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
      // 履歴に追加（answeredCount が +1 され、5 問目なら finished=true で終了画面に切り替わる）。
      setHistory((prev) => [
        ...prev,
        { question: currentQuestion, answer: trimmed, review: json.review as Review },
      ]);
      setCurrentQuestion(null);
      setAnswer('');
      // フィードバックは表示しつつ、永続化失敗だけを別途通知する。
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
    setSaveError(false);
    void generateQuestion();
  }

  // 進行中の質問番号（1始まり、最大 5）。
  const currentNumber = Math.min(answeredCount + 1, QA_MAX_QUESTIONS);

  return (
    <Card padding="lg" className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">発表後Q&A練習</h2>
          {loaded && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              {finished ? `全${QA_MAX_QUESTIONS}問完了` : `Q${currentNumber} / ${QA_MAX_QUESTIONS}`}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-600 leading-relaxed">
          発表後に聞かれやすい質問への対応を練習できます（全{QA_MAX_QUESTIONS}問）。回答後、AI
          が改善点を返します。
        </p>
      </div>

      {!loaded ? (
        <p className="text-sm text-slate-500">読み込み中…</p>
      ) : (
        <>
          {/* これまでの Q&A 履歴（DB 復元分 + 今セッション分） */}
          {history.length > 0 && (
            <div className="space-y-3">
              {history.map((pair, i) => (
                <div
                  key={i}
                  className="space-y-2 rounded-lg border border-slate-200 p-3"
                >
                  <p className="text-sm font-semibold text-slate-800">
                    Q{i + 1} / {QA_MAX_QUESTIONS}. {pair.question}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">
                    <span className="text-slate-500">あなたの回答: </span>
                    {pair.answer}
                  </p>
                  <ReviewView review={pair.review} />
                </div>
              ))}
            </div>
          )}

          {/* 進行中の質問（終了後は表示しない＝「回答を評価する」も出ない） */}
          {!finished &&
          (qaStatus === 'question' || qaStatus === 'reviewing') &&
          currentQuestion ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-800">
                Q{currentNumber} / {QA_MAX_QUESTIONS}. {currentQuestion}
              </p>
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

          {/* 終了後: Q&A 総合評価 → 導線 */}
          {finished ? (
            <>
              {qaSummary ? (
                <QaSummaryView summary={qaSummary} />
              ) : summaryStatus === 'loading' ? (
                <p className="flex items-center gap-2 text-sm font-medium text-indigo-700">
                  <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-indigo-600" />
                  Q&A総合評価を作成しています…
                </p>
              ) : summaryStatus === 'error' ? (
                <div className="space-y-2">
                  <AlertBox variant="warning">
                    Q&A総合評価の作成に失敗しました。
                  </AlertBox>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void runSummary()}
                  >
                    総合評価を再作成する
                  </Button>
                </div>
              ) : null}

              {/* 最終評価レポート（プレゼン + Q&A の締め） */}
              <PresentationFinalReport attemptId={attemptId} ready={finished} />

              <QaEndPanel />
            </>
          ) : qaStatus === 'idle' ? (
            <Button
              variant="primary"
              onClick={() => void generateQuestion()}
              disabled={busy}
            >
              {busy
                ? '生成中…'
                : answeredCount === 0
                  ? '質問を生成する'
                  : '次の質問を出す'}
            </Button>
          ) : qaStatus === 'reviewed' ? (
            <Button variant="secondary" onClick={nextQuestion} disabled={busy}>
              {busy ? '生成中…' : '次の質問を出す'}
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}

// Q&A 全体（5問）の総合評価。5 軸バッジ + 良かった点 / 改善点 / 総評。
function QaSummaryView({ summary }: { summary: QaSummary }) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div>
        <h3 className="text-base font-bold text-slate-900">Q&A総合評価</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          全{QA_MAX_QUESTIONS}問の質疑応答全体を通した評価です。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {QA_SUMMARY_DIMENSIONS.map(({ key, label }) => {
          const raw = summary.categories[key];
          const level: Level = isLevel(raw) ? raw : 'normal';
          return (
            <div
              key={key}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
            >
              <span className="text-sm text-slate-700">{label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL_CLASS[level]}`}
              >
                {LEVEL_LABEL[level]}
              </span>
            </div>
          );
        })}
      </div>

      <ReviewList title="良かった点" items={summary.goodPoints} />
      <ReviewList title="改善点" items={summary.improvements} />
      {summary.overallComment && (
        <div>
          <p className="text-xs font-semibold text-slate-800">総評</p>
          <p className="text-sm leading-relaxed text-slate-700">
            {summary.overallComment}
          </p>
        </div>
      )}
    </div>
  );
}

// 5 問完了後の終了パネル。新しい質問は出さず、既存導線のみ表示する。
function QaEndPanel() {
  return (
    <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div>
        <p className="text-sm font-bold text-emerald-800">Q&A練習は終了しました。</p>
        <p className="mt-1 text-sm text-emerald-700">
          全{QA_MAX_QUESTIONS}問の質疑応答が完了しました。お疲れさまでした。
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <LinkButton href="/presentation/setup" variant="primary">
          もう一度プレゼンする
        </LinkButton>
        <LinkButton href="/presentation/history" variant="secondary">
          履歴を見る
        </LinkButton>
        <LinkButton href="/presentation" variant="secondary">
          プレゼン対策トップへ
        </LinkButton>
      </div>
    </div>
  );
}

function ReviewView({ review }: { review: Review }) {
  return (
    <div className="space-y-2 rounded-md bg-slate-50 p-3">
      <ReviewList title="良かった点" items={review.goodPoints} />
      <ReviewList title="改善点" items={review.improvements} />
      {review.modelAnswerDirection && (
        <div>
          <p className="text-xs font-semibold text-slate-800">模範回答の方向性</p>
          <p className="text-sm leading-relaxed text-slate-700">
            {review.modelAnswerDirection}
          </p>
        </div>
      )}
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
