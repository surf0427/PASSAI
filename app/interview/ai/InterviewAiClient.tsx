'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { AlertBox } from '@/components/ui/AlertBox';
import {
  abandonSession,
  completeSession,
  createSession,
  getSessionState,
  kickoff,
  retryFollowup,
  submitTextAnswer,
  submitVoiceAnswer,
  type AiSession,
  type AnswerResult,
  type CompleteResult,
} from './api';
import { resolveSource, type ResolvedSource, type SourceGuidance } from './sourceData';
import {
  INTERVIEW_TYPES,
  INTERVIEW_TYPE_LABELS,
  type InterviewType,
} from '@/lib/interviewAi/interviewTypes';
import { isInterviewSourceTypesEnabled } from '@/lib/interviewAi/featureFlag';

// 機能別データ連動面接の feature flag。false（本番デフォルト）では従来のフリー面接のみ。
const SOURCE_TYPES_ENABLED = isInterviewSourceTypesEnabled();

type Phase = 'type' | 'setup' | 'interviewing' | 'result';
type Exchange = { question: string; transcript: string };
type AvailableSource = Extract<ResolvedSource, { available: true }>;

const INPUT_CLASS =
  'w-full border border-slate-300 rounded-lg px-4 py-2 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400';

// タイプ選択カードの説明文（item 2）。
const TYPE_CARD_DESC: Record<InterviewType, string> = {
  self_analysis: '自己分析で整理した価値観・強み・経験をもとに深掘りします。',
  activity: '入力済みの活動内容をもとに、行動・困難・工夫・学びを質問します。',
  statement: '作成した志望理由書をもとに、面接官が突っ込みそうな点を質問します。',
  matching: '志望校・学部との相性や選択理由を深掘りします。',
  essay: '小論文で扱ったテーマについて、考え方や意見を口頭で説明する練習をします。',
  free: 'データ連動なしで、一般的な総合型選抜の面接練習をします。',
};

export function InterviewAiClient() {
  // 常に setup（大学・学部選択）から始める。タイプ選択は setup 完了後（flag on のみ）。
  const [phase, setPhase] = useState<Phase>('setup');
  const [mode, setMode] = useState<'voice' | 'text'>('text');
  const [university, setUniversity] = useState('');
  const [faculty, setFaculty] = useState('');
  const [examType, setExamType] = useState('');

  // 元データ欠如の誘導カード（タイプ選択時に解決した結果。解決済みデータは startSession へ引数で渡す）。
  const [guidance, setGuidance] = useState<(SourceGuidance & { type: InterviewType }) | null>(null);

  const [session, setSession] = useState<AiSession | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [done, setDone] = useState(false);
  const [questionError, setQuestionError] = useState(false);
  const [sttGuidance, setSttGuidance] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resume, setResume] = useState<AiSession | null>(null);
  const [result, setResult] = useState<Extract<CompleteResult, { kind: 'completed' }> | null>(null);

  // voice 録音
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // 最初（= 大学・学部選択の setup）まで戻す。タイプ選択は setup の後段なので、戻り先は常に setup。
  function resetToStart(message?: string) {
    setPhase('setup');
    setGuidance(null);
    setSession(null);
    setCurrentQuestion(null);
    setAnswerText('');
    setExchanges([]);
    setDone(false);
    setQuestionError(false);
    setSttGuidance(false);
    setResult(null);
    setResume(null);
    setErrorMsg(message ?? null);
  }

  // setup（大学・学部選択）完了 → 次へ。
  //   - flag off: そのままフリー面接を開始（タイプ選択を出さない / 既存導線）。
  //   - flag on:  タイプ選択 phase へ進む。
  function handleSetupNext() {
    if (!SOURCE_TYPES_ENABLED) {
      void startSession('free', null);
      return;
    }
    setErrorMsg(null);
    setGuidance(null);
    setPhase('type');
  }

  // タイプ選択（flag on, 大学選択後）→ 元データ解決。あれば即開始、無ければ誘導カード。
  function handleSelectType(type: InterviewType) {
    setErrorMsg(null);
    setGuidance(null);
    const r = resolveSource(type);
    if (!r.available) {
      setGuidance({ ...r.guidance, type });
      return;
    }
    void startSession(type, r);
  }

  function buildTargetRef(): Record<string, unknown> {
    const ref: Record<string, unknown> = { version: 1 };
    if (university.trim()) ref.universityName = university.trim();
    if (faculty.trim()) ref.faculty = faculty.trim();
    if (examType.trim()) ref.examType = examType.trim();
    return ref;
  }

  // ── セッション開始 ───────────────────────────────────────────
  //   大学情報（buildTargetRef）+ interview_type / source 情報を両方入れて作成する。
  //   type / resolvedSrc は引数で受け取り、setState の非同期反映を待たずに確定値を使う。
  async function startSession(
    type: InterviewType,
    resolvedSrc: AvailableSource | null,
  ) {
    setLoading(true);
    setErrorMsg(null);
    setSttGuidance(false);
    try {
      const res = await createSession({
        source: mode,
        targetRef: buildTargetRef(),
        interviewType: type,
        sourceType: resolvedSrc ? resolvedSrc.sourceType : null,
        sourceId: resolvedSrc ? resolvedSrc.sourceId : null,
        sourceContext: resolvedSrc ? resolvedSrc.sourceContext : '',
      });
      if (res.kind === 'created') {
        setSession(res.session);
        await runKickoff(res.session);
      } else if (res.kind === 'in-progress-exists') {
        setResume(res.session); // 409 IN_PROGRESS_EXISTS → 再開ダイアログ
      } else if (res.kind === 'quota-exceeded') {
        setErrorMsg('今月の面接AIの利用上限に達しました。プランの確認をお願いします。');
      } else if (res.kind === 'unauthenticated') {
        setErrorMsg('ログインが必要です。');
      } else {
        setErrorMsg('面接の開始に失敗しました。時間をおいて再試行してください。');
      }
    } finally {
      setLoading(false);
    }
  }

  async function runKickoff(s: AiSession) {
    const q = await kickoff(s.id);
    if (q.kind === 'question') {
      setCurrentQuestion(q.question);
      setQuestionError(false);
      setDone(false);
      setPhase('interviewing');
    } else {
      setErrorMsg('最初の質問の生成に失敗しました。再試行してください。');
      setPhase('interviewing');
      setSession(s);
    }
  }

  // ── 再開（in_progress） ─────────────────────────────────────
  async function handleResume() {
    if (!resume) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const st = await getSessionState(resume.id);
      if (st.kind !== 'ok') {
        resetToStart('面接の再開に失敗しました。');
        return;
      }
      setSession(resume);
      setMode(st.state.source);
      setResume(null);
      setPhase('interviewing');
      if (st.state.done) {
        setDone(true);
        setCurrentQuestion(null);
      } else if (st.state.needsKickoff) {
        await runKickoff(resume);
      } else if (st.state.needsRetry) {
        setQuestionError(true);
        setCurrentQuestion(null);
      } else {
        setCurrentQuestion(st.state.currentQuestion);
        setQuestionError(false);
      }
    } finally {
      setLoading(false);
    }
  }

  // ── 回答結果の共通処理 ──────────────────────────────────────
  function applyAnswerResult(r: AnswerResult, answeredQuestion: string | null) {
    if (r.kind === 'next') {
      if (answeredQuestion) {
        setExchanges((prev) => [...prev, { question: answeredQuestion, transcript: r.transcript }]);
      }
      setCurrentQuestion(r.question);
      setAnswerText('');
      setQuestionError(false);
    } else if (r.kind === 'question-error') {
      if (answeredQuestion) {
        setExchanges((prev) => [...prev, { question: answeredQuestion, transcript: r.transcript }]);
      }
      setCurrentQuestion(null);
      setAnswerText('');
      setQuestionError(true); // 次の質問生成に失敗 → 再試行導線
    } else if (r.kind === 'done' || r.kind === 'limit') {
      if (answeredQuestion && r.kind === 'done') {
        setExchanges((prev) => [...prev, { question: answeredQuestion, transcript: r.transcript }]);
      }
      setCurrentQuestion(null);
      setAnswerText('');
      setQuestionError(false);
      setDone(true);
    } else if (r.kind === 'stt-error') {
      // STT 未設定 → テキストモード誘導
      setSttGuidance(true);
      setErrorMsg(
        r.error === 'stt-unavailable'
          ? '音声認識が未設定です。テキストモードで面接を始め直してください。'
          : '音声認識に失敗しました。もう一度録音するか、テキストモードをご利用ください。',
      );
    } else {
      setErrorMsg('回答の送信に失敗しました。再試行してください。');
    }
  }

  // ── テキスト回答 ────────────────────────────────────────────
  async function handleSubmitText() {
    if (!session || !currentQuestion) return;
    const answer = answerText.trim();
    if (!answer) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const r = await submitTextAnswer(session.id, answer);
      applyAnswerResult(r, currentQuestion);
    } finally {
      setLoading(false);
    }
  }

  // ── 音声回答（録音 → STT） ──────────────────────────────────
  async function startRecording() {
    setErrorMsg(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErrorMsg('この環境では録音できません。テキストモードをご利用ください。');
      setSttGuidance(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        void handleSubmitVoice(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setErrorMsg('マイクへのアクセスが許可されませんでした。テキストモードをご利用ください。');
      setSttGuidance(true);
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setIsRecording(false);
  }

  async function handleSubmitVoice(blob: Blob) {
    if (!session || !currentQuestion) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const r = await submitVoiceAnswer(session.id, blob);
      applyAnswerResult(r, currentQuestion);
    } finally {
      setLoading(false);
    }
  }

  // ── followup 再試行 ─────────────────────────────────────────
  async function handleRetry() {
    if (!session) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const r = await retryFollowup(session.id);
      if (r.kind === 'next') {
        setCurrentQuestion(r.question);
        setQuestionError(false);
      } else if (r.kind === 'done' || r.kind === 'limit') {
        setQuestionError(false);
        setDone(true);
      } else if (r.kind === 'question-error') {
        setErrorMsg('再試行しましたが、まだ次の質問を生成できませんでした。もう一度お試しください。');
      } else {
        setErrorMsg('再試行に失敗しました。');
      }
    } finally {
      setLoading(false);
    }
  }

  // ── 完了 ────────────────────────────────────────────────────
  async function handleComplete() {
    if (!session) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const r = await completeSession(session.id);
      if (r.kind === 'completed') {
        setResult(r);
        setPhase('result');
      } else if (r.kind === 'feedback-error') {
        setErrorMsg('結果の生成に失敗しました。もう一度「結果を見る」を押してください。');
      } else {
        setErrorMsg('完了処理に失敗しました。再試行してください。');
      }
    } finally {
      setLoading(false);
    }
  }

  // ── 中断（明示キャンセル） ──────────────────────────────────
  async function handleAbandon(sessionId: string) {
    if (!window.confirm('この面接を中断しますか？（再開できなくなります）')) return;
    setLoading(true);
    try {
      const r = await abandonSession(sessionId);
      if (r.kind === 'abandoned') {
        resetToStart('面接を中断しました。');
      } else {
        setErrorMsg('中断に失敗しました。');
      }
    } finally {
      setLoading(false);
    }
  }

  // ── 描画 ────────────────────────────────────────────────────
  return (
    <div>
      {errorMsg && (
        <AlertBox variant="warning" className="mb-6">
          <p>{errorMsg}</p>
        </AlertBox>
      )}

      {/* 再開ダイアログ（409 IN_PROGRESS_EXISTS） */}
      {resume && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h2 className="text-base font-bold text-slate-800 mb-2">進行中の面接があります</h2>
            <p className="text-sm text-slate-600 mb-5">
              前回の面接が途中のままです。続きから再開しますか？
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={handleResume} disabled={loading}>
                続きから再開する
              </Button>
              <button
                type="button"
                onClick={() => handleAbandon(resume.id)}
                disabled={loading}
                className="text-sm text-gray-500 hover:text-red-600 border border-gray-300 hover:border-red-300 font-semibold px-5 py-2 rounded-lg transition-colors"
              >
                この面接を中断して新しく始める
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TYPE SELECT（大学選択後に表示。どの内容をもとに面接するか） */}
      {phase === 'type' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold text-gray-800">
              どの内容をもとに面接練習しますか？
            </h2>
            <button
              type="button"
              onClick={() => {
                setGuidance(null);
                setPhase('setup');
              }}
              className="text-xs text-gray-500 hover:text-gray-800 border border-gray-300 rounded-lg px-3 py-1"
            >
              ← 大学・学部選択へ戻る
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            選んだ機能のデータをもとに、面接AIが深掘り質問を行います。
          </p>

          {/* データ欠如の誘導カード */}
          {guidance && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-4">
              <p className="text-sm text-amber-900 mb-3">{guidance.message}</p>
              <div className="flex gap-2">
                <Link
                  href={guidance.href}
                  className="inline-block bg-amber-600 hover:bg-amber-700 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  {guidance.ctaLabel}
                </Link>
                <button
                  type="button"
                  onClick={() => setGuidance(null)}
                  className="text-sm text-gray-600 border border-gray-300 hover:border-gray-400 font-semibold px-4 py-2 rounded-lg"
                >
                  別のタイプを選ぶ
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {INTERVIEW_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleSelectType(type)}
                className="text-left bg-white border border-gray-200 hover:border-blue-400 rounded-xl p-5 transition-colors"
              >
                <p className="text-sm font-bold text-gray-800 mb-1">
                  {INTERVIEW_TYPE_LABELS[type]}
                </p>
                <p className="text-xs text-gray-600 leading-relaxed">{TYPE_CARD_DESC[type]}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* SETUP */}
      {phase === 'setup' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-700 mb-1">面接の設定</h2>
          <p className="text-sm text-gray-500 mb-4">
            面接対象の大学・学部・受験方式を選んでください（任意）。
          </p>

          <div className="mb-5">
            <span className="block text-sm font-semibold text-gray-700 mb-2">回答方法</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('text')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
                  mode === 'text'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300'
                }`}
              >
                テキスト
              </button>
              <button
                type="button"
                onClick={() => setMode('voice')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
                  mode === 'voice'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300'
                }`}
              >
                音声（録音）
              </button>
            </div>
            {mode === 'voice' && (
              <p className="text-xs text-amber-700 mt-2">
                ※ 音声認識が未設定の環境では利用できません。その場合はテキストでお試しください。
              </p>
            )}
          </div>

          <div className="grid gap-3 mb-6">
            <input
              className={INPUT_CLASS}
              placeholder="志望大学（任意）"
              value={university}
              onChange={(e) => setUniversity(e.target.value)}
            />
            <input
              className={INPUT_CLASS}
              placeholder="学部（任意）"
              value={faculty}
              onChange={(e) => setFaculty(e.target.value)}
            />
            <input
              className={INPUT_CLASS}
              placeholder="受験方式（任意）"
              value={examType}
              onChange={(e) => setExamType(e.target.value)}
            />
          </div>

          {/* flag off: そのままフリー面接を開始 / flag on: 大学選択後にタイプ選択へ進む */}
          <Button onClick={handleSetupNext} disabled={loading}>
            {loading
              ? '準備中…'
              : SOURCE_TYPES_ENABLED
                ? '次へ（面接タイプを選ぶ）'
                : '面接を始める'}
          </Button>
        </div>
      )}

      {/* INTERVIEWING */}
      {phase === 'interviewing' && (
        <div>
          {/* これまでのやり取り */}
          {exchanges.length > 0 && (
            <div className="mb-6 flex flex-col gap-3">
              {exchanges.map((ex, i) => (
                <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs font-semibold text-gray-500 mb-1">質問 {i + 1}</p>
                  <p className="text-sm text-gray-800 mb-2">{ex.question}</p>
                  <p className="text-xs font-semibold text-gray-500 mb-1">あなたの回答</p>
                  <p className="text-sm text-gray-700 whitespace-pre-line">{ex.transcript}</p>
                </div>
              ))}
            </div>
          )}

          {/* 現在の質問 / 回答 */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4">
            {loading && <p className="text-sm text-gray-500 mb-3">処理中…</p>}

            {questionError ? (
              <div>
                <p className="text-sm text-gray-700 mb-3">
                  次の質問の生成に失敗しました。再試行してください。
                </p>
                <Button onClick={handleRetry} disabled={loading}>
                  再試行する
                </Button>
              </div>
            ) : done ? (
              <div>
                <p className="text-sm text-gray-700 mb-3">面接が一通り終わりました。</p>
                <Button onClick={handleComplete} disabled={loading}>
                  {loading ? '結果を生成中…' : '結果を見る'}
                </Button>
              </div>
            ) : currentQuestion ? (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">面接官からの質問</p>
                <p className="text-base text-gray-800 mb-4">{currentQuestion}</p>

                {mode === 'text' || sttGuidance ? (
                  <>
                    {sttGuidance && (
                      <p className="text-xs text-amber-700 mb-2">
                        音声が使えないため、テキストで回答してください。
                      </p>
                    )}
                    <label className="block text-xs font-semibold text-gray-500 mb-1">
                      回答（送信前に確認・編集できます）
                    </label>
                    <textarea
                      className={`${INPUT_CLASS} min-h-[120px] resize-y mb-3`}
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      placeholder="回答を入力してください"
                    />
                    <Button onClick={handleSubmitText} disabled={loading || !answerText.trim()}>
                      次へ
                    </Button>
                  </>
                ) : (
                  <div className="flex flex-col gap-2">
                    {!isRecording ? (
                      <Button onClick={startRecording} disabled={loading}>
                        録音開始
                      </Button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopRecording}
                        className="px-5 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white"
                      >
                        録音停止して送信
                      </button>
                    )}
                    <p className="text-xs text-gray-400">
                      録音を停止すると音声認識して回答を保存します。
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">準備中…</p>
            )}
          </div>

          {/* 中断（明示キャンセル） */}
          {session && (
            <button
              type="button"
              onClick={() => handleAbandon(session.id)}
              disabled={loading}
              className="text-sm text-gray-500 hover:text-red-600 border border-gray-300 hover:border-red-300 font-semibold px-5 py-2 rounded-lg transition-colors"
            >
              面接を中断する
            </button>
          )}
        </div>
      )}

      {/* RESULT */}
      {phase === 'result' && result && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-700 mb-4">面接フィードバック</h2>
          {result.feedbackText && (
            <p className="text-sm text-gray-800 whitespace-pre-line mb-5">{result.feedbackText}</p>
          )}
          <ResultList title="良かった点" items={result.strengths} color="green" />
          <ResultList title="改善点" items={result.improvements} color="orange" />
          <ResultList title="次に練習すること" items={result.nextPractice} color="blue" />
          <div className="flex gap-3 mt-6">
            <Link
              href="/interview/history"
              className="text-sm font-semibold text-blue-600 border border-blue-300 hover:border-blue-400 px-5 py-2 rounded-lg"
            >
              履歴を見る
            </Link>
            <button
              type="button"
              onClick={() => resetToStart()}
              className="text-sm font-semibold text-gray-700 border border-gray-300 hover:border-gray-400 px-5 py-2 rounded-lg"
            >
              もう一度
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultList({
  title,
  items,
  color,
}: {
  title: string;
  items: string[];
  color: 'green' | 'orange' | 'blue';
}) {
  if (items.length === 0) return null;
  const heading =
    color === 'green' ? 'text-green-700' : color === 'orange' ? 'text-orange-700' : 'text-blue-700';
  return (
    <div className="mb-4">
      <p className={`text-xs font-semibold mb-1 ${heading}`}>{title}</p>
      <ul className="list-disc pl-5 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-sm text-gray-700 leading-relaxed">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
