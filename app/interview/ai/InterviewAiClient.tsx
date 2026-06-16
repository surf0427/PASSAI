'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
  synthesizeSpeech,
  transcribeVoice,
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
import {
  isInterviewSourceTypesEnabledByEnv,
  isInterviewSourceTypesEnabledByQuery,
  isInterviewSourceTypesEnabledClient,
} from '@/lib/interviewAi/featureFlag';

// 機能別データ連動面接の有効化判定（env または Preview query override）。
// SSR では env のみ（query は client のみ）。client mount 後に query を含めて再評価するため
// useSyncExternalStore を使う（getServerSnapshot=env / getSnapshot=env||query → hydration mismatch 回避）。
const emptySubscribe = () => () => {};
const getTrue = () => true;
const getFalse = () => false;
function useSourceTypesEnabled(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    isInterviewSourceTypesEnabledClient, // client snapshot（env || query）
    isInterviewSourceTypesEnabledByEnv, // server snapshot（env のみ）
  );
}
// mount 後だけ true（SSR=false）。debug バナーを client 専用に描画して hydration mismatch を避ける。
function useMounted(): boolean {
  return useSyncExternalStore(emptySubscribe, getTrue, getFalse);
}

type Phase = 'type' | 'setup' | 'interviewing' | 'result';
type Exchange = { question: string; transcript: string };
type AvailableSource = Extract<ResolvedSource, { available: true }>;

const INPUT_CLASS =
  'w-full border border-slate-300 rounded-lg px-4 py-2 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400';

// タイプ選択カードの説明文（2026-06 方針）。
const TYPE_CARD_DESC: Record<InterviewType, string> = {
  self_analysis: '自己分析・活動整理をもとに深掘り質問を行います。',
  statement: '志望理由書との一貫性を確認しながら質問します。',
  essay: '小論文の内容を口頭で説明する練習をします。',
  free: 'PASSAI内の記録を総合して、本番を想定した面接を行います。',
  pressure: '本番より少し厳しめの質問を行います。',
};

// カード見出しの emoji。
const TYPE_CARD_EMOJI: Record<InterviewType, string> = {
  self_analysis: '⭐',
  statement: '⭐',
  essay: '📝',
  free: '🎯',
  pressure: '😈',
};

export function InterviewAiClient() {
  // env または Preview query override で有効化（client mount 後に query を含めて確定）。
  const sourceTypesEnabled = useSourceTypesEnabled();
  const mounted = useMounted();

  // 常に setup（大学・学部選択）から始める。タイプ選択は setup 完了後（有効時のみ）。
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

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resume, setResume] = useState<AiSession | null>(null);
  const [result, setResult] = useState<Extract<CompleteResult, { kind: 'completed' }> | null>(null);

  // 回答の入力方法（ターン単位で切替可）。音声回答も最終的には text answer として保存する。
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('text');
  // 音声入力のサブ状態。idle: 録音前 or 文字起こし結果待ち / recording: 録音中 / transcribing: STT 中。
  const [voiceStage, setVoiceStage] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // 進行中 STT を無効化するためのトークン。録音リソース解放のたびに ++ し、
  // handleTranscribe は開始時の値と一致するときだけ結果を反映する（M-3: 編集不可仕様の死守）。
  const transcribeIdRef = useRef(0);

  // ── AI 質問読み上げ（TTS） ──────────────────────────────────────
  // TTS は「AI 質問テキストの読み上げ」だけを足す機能。テキスト表示は必ず残り、
  // TTS に失敗しても面接・回答入力は止めない（質問はテキストで続行できる）。
  //   - 'unavailable' = provider 未設定（読み上げ不可）→ コントロール自体を出さない。
  //   - 'blocked'     = 自動再生がブラウザにブロックされた → 手動「🔊 読み上げ」で再生。
  //   - 'ended'/'paused' = 再生済み/停止 → 「🔊 もう一度聞く」で同じ音声を再再生（再生成しない）。
  //   - 'failed'      = 一時失敗 → 「🔊 読み上げ」で再試行（再生成）。
  type TtsStage =
    | 'idle'
    | 'loading'
    | 'playing'
    | 'paused'
    | 'ended'
    | 'blocked'
    | 'failed'
    | 'unavailable';
  const [ttsStage, setTtsStage] = useState<TtsStage>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null); // 再生用 object URL（破棄対象）
  // 進行中 TTS を無効化するためのトークン。質問が変わる/解放のたびに ++ し、
  // 開始時の値と一致するときだけ結果（音声）を反映する（古い質問の音声を鳴らさない）。
  const ttsReqRef = useRef(0);
  // provider 未設定が一度わかったら以降は fetch せず即 'unavailable'（無駄な 502 を避ける）。
  const ttsUnavailableRef = useRef(false);

  // 録音リソース（MediaRecorder / MediaStream / chunks）を確実に解放する一元処理。
  // 録音中の切替・中断・リセット・結果遷移・unmount・STT失敗・録り直しなど、
  // 音声経路から離れるすべての地点で呼ぶ（H-1: マイク開きっぱなし防止）。
  //   - transcribeIdRef を ++ して進行中 STT の結果を破棄させる。
  //   - 解放専用なので onstop/ondataavailable を外してから stop する（handleTranscribe を誤発火させない）。
  //   - tracks.stop() でマイク（録音インジケータ）を確実に解放する。
  // refs のみを参照するため deps なしで安定（unmount cleanup から呼べる）。
  const stopRecordingResources = useCallback(() => {
    transcribeIdRef.current += 1;
    const rec = recorderRef.current;
    if (rec) {
      rec.ondataavailable = null;
      rec.onstop = null;
      if (rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
  }, []);

  // unmount 時にマイクを必ず解放する。
  useEffect(() => stopRecordingResources, [stopRecordingResources]);

  // TTS の再生リソース（audio 要素 / object URL / 進行中 fetch）を確実に解放する一元処理。
  // 質問が変わる・リセット・完了・unmount のたびに呼ぶ。
  //   - ttsReqRef を ++ して進行中 TTS fetch の結果を破棄させる（古い質問の音声を鳴らさない）。
  //   - 再生を止め、object URL を revoke する（音声は保存しない・残さない方針）。
  // refs のみ参照するため deps なしで安定（unmount cleanup から呼べる）。
  const releaseTtsResources = useCallback(() => {
    ttsReqRef.current += 1;
    const a = audioRef.current;
    if (a) {
      a.onended = null;
      a.onpause = null;
      try {
        a.pause();
      } catch {
        /* already paused */
      }
      a.removeAttribute('src');
      try {
        a.load();
      } catch {
        /* ignore */
      }
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
  }, []);

  // unmount 時に再生中の音声を必ず止め、object URL を破棄する。
  useEffect(() => releaseTtsResources, [releaseTtsResources]);

  // AI 質問テキストを TTS で読み上げる（新規生成）。
  //   - 成功: 音声を取得 → object URL 化 → 自動再生（ブロックされたら 'blocked' で手動再生に誘導）。
  //   - 失敗: 面接は止めない。provider 未設定なら 'unavailable'（以降 fetch しない）、
  //           一時失敗なら 'failed' + 軽い案内（テキストで続行できる）。
  const speak = useCallback(
    async (text: string) => {
      const t = (text || '').trim();
      if (!t) return;
      if (ttsUnavailableRef.current) {
        // provider 未設定が既知 → 無駄な fetch をしない。
        setTtsStage('unavailable');
        return;
      }
      releaseTtsResources(); // 進行中 fetch を無効化 + 前の音声を解放
      const reqId = ttsReqRef.current;
      setTtsStage('loading');
      const r = await synthesizeSpeech(t);
      // 質問が変わった/解放された後の結果は破棄（古い質問の音声を鳴らさない）。
      if (reqId !== ttsReqRef.current) return;
      if (r.kind === 'error') {
        if (r.error === 'tts-unavailable') {
          ttsUnavailableRef.current = true;
          setTtsStage('unavailable');
        } else {
          // 一時失敗。console.error は残しつつ、画面は軽い案内だけ（面接は続行）。
          console.error('[interview-ai] tts failed', r.error);
          setTtsStage('failed');
          setErrorMsg('音声読み上げに失敗しました。テキストで続行できます。');
        }
        return;
      }
      const url = URL.createObjectURL(r.audio);
      ttsUrlRef.current = url;
      // 毎回新しい Audio を作り、全プロパティを設定してから ref に格納する
      // （ref 格納後の mutation を避ける / 前の要素は release 済みなので GC される）。
      const audio = new Audio();
      audio.src = url;
      audio.onended = () => setTtsStage('ended');
      audioRef.current = audio;
      try {
        await audio.play();
        if (reqId !== ttsReqRef.current) return; // 再生開始直前に切り替わっていたら反映しない
        setTtsStage('playing');
      } catch {
        // ブラウザの自動再生制限（iPhone Safari 等）。音声は取得済みなので手動再生できる。
        setTtsStage('blocked');
      }
    },
    [releaseTtsResources],
  );

  // 取得済みの音声を頭から再生する（再生成しない）。無ければ作り直す。
  const replaySpeech = useCallback(() => {
    const audio = audioRef.current;
    if (audio && ttsUrlRef.current) {
      try {
        audio.currentTime = 0;
      } catch {
        /* ignore */
      }
      audio.onended = () => setTtsStage('ended');
      audio
        .play()
        .then(() => setTtsStage('playing'))
        .catch(() => setTtsStage('blocked'));
      return;
    }
    if (currentQuestion) void speak(currentQuestion);
  }, [currentQuestion, speak]);

  // 再生を止める（位置はリセット。「もう一度聞く」で頭から再生できる）。
  const stopSpeech = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
    setTtsStage('paused');
  }, []);

  // Preview 検証用デバッグログ。sourceTypesEnabled（= env true または vercel.app Preview の
  // ?sourceTypes=1）のときだけ出す。本番 passai.jp では常に false なので一切出ない。
  function debugLog(...args: unknown[]) {
    if (sourceTypesEnabled) console.log(...args);
  }

  // MediaRecorder / getUserMedia 対応判定（非対応なら最初からテキスト回答）。
  // mounted を噛ませて SSR/hydration では false に固定（hydration mismatch 回避）。client mount 後に確定。
  const mediaSupported =
    mounted &&
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;

  function defaultInputMode(): 'voice' | 'text' {
    return mode === 'voice' && mediaSupported ? 'voice' : 'text';
  }

  // 新しい質問を表示するときの入力状態リセット（入力方法を既定に戻す）。
  // テキスト表示は必ず行い（setCurrentQuestion）、その後に TTS で自動読み上げを試みる。
  // TTS は失敗しても面接を止めない（質問はテキストで続行できる）。
  function showQuestion(q: string) {
    stopRecordingResources();
    setCurrentQuestion(q);
    setQuestionError(false);
    setAnswerText('');
    setVoiceStage('idle');
    setInputMode(defaultInputMode());
    void speak(q); // 自動再生（ブロック時は手動「🔊 読み上げ」に誘導）
  }

  // 最初（= 大学・学部選択の setup）まで戻す。タイプ選択は setup の後段なので、戻り先は常に setup。
  function resetToStart(message?: string) {
    stopRecordingResources();
    releaseTtsResources();
    setTtsStage('idle');
    setPhase('setup');
    setGuidance(null);
    setSession(null);
    setCurrentQuestion(null);
    setAnswerText('');
    setExchanges([]);
    setDone(false);
    setQuestionError(false);
    setVoiceStage('idle');
    setResult(null);
    setResume(null);
    setErrorMsg(message ?? null);
  }

  // setup（大学・学部選択）完了 → 次へ。
  //   - flag off: そのままフリー面接を開始（タイプ選択を出さない / 既存導線）。
  //   - flag on:  タイプ選択 phase へ進む。
  function handleSetupNext() {
    if (!sourceTypesEnabled) {
      void startSession('free', null);
      return;
    }
    setErrorMsg(null);
    setGuidance(null);
    setPhase('type');
  }

  // タイプ選択（flag on, 大学選択後）→ 元データ解決。あれば即開始、無ければ誘導カード。
  //   - free（本番モード）/ pressure（圧迫面接）は常に available（sourceType=null 許容）。
  //   - resolveSource は localStorage 読み込みを伴うため、万一の例外でも「無反応」にせず
  //     必ずエラーを画面に出す（クリックして何も起きない状態を禁止 / req #4）。
  function handleSelectType(type: InterviewType) {
    setErrorMsg(null);
    setGuidance(null);
    try {
      debugLog('[interview-ai] selected type', type);
      const r = resolveSource(type);
      debugLog('[interview-ai] resolved source', r);
      if (!r.available) {
        // 連携データが必要なタイプ（self_analysis / statement / essay）だけ誘導する。
        setGuidance({ ...r.guidance, type });
        return;
      }
      // free / pressure を含む available なタイプは即セッション開始へ。
      void startSession(type, r);
    } catch (err) {
      console.error('[interview-ai] handleSelectType failed', err);
      setErrorMsg('面接の開始に失敗しました。もう一度お試しください。');
    }
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
    // 音声回答も STT 後に text answer として保存するため、session は常に source='text'。
    // free / pressure は sourceType=null / sourceId=null をそのまま許容して送る。
    const payload = {
      source: 'text' as const,
      targetRef: buildTargetRef(),
      interviewType: type,
      sourceType: resolvedSrc ? resolvedSrc.sourceType : null,
      sourceId: resolvedSrc ? resolvedSrc.sourceId : null,
      sourceContext: resolvedSrc ? resolvedSrc.sourceContext : '',
    };
    debugLog('[interview-ai] create session request', payload);
    try {
      const res = await createSession(payload);
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
        // 500 等（route の session-create-failed など）。握りつぶさず明示する（req #4）。
        console.error('[interview-ai] createSession failed', res);
        setErrorMsg('面接の開始に失敗しました。もう一度お試しください。');
      }
    } catch (err) {
      // fetch 例外 / runKickoff 例外などの想定外。unhandled rejection で無反応にしない（req #4）。
      console.error('[interview-ai] startSession threw', err);
      setErrorMsg('面接の開始に失敗しました。もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  }

  async function runKickoff(s: AiSession) {
    const q = await kickoff(s.id);
    if (q.kind === 'question') {
      setDone(false);
      setPhase('interviewing');
      showQuestion(q.question);
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
      } else if (st.state.currentQuestion) {
        showQuestion(st.state.currentQuestion);
      } else {
        setCurrentQuestion(null);
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
      showQuestion(r.question);
    } else if (r.kind === 'question-error') {
      if (answeredQuestion) {
        setExchanges((prev) => [...prev, { question: answeredQuestion, transcript: r.transcript }]);
      }
      releaseTtsResources(); // 回答済み質問の読み上げを止める
      setTtsStage('idle');
      setCurrentQuestion(null);
      setAnswerText('');
      setVoiceStage('idle');
      setQuestionError(true); // 次の質問生成に失敗 → 再試行導線
    } else if (r.kind === 'done' || r.kind === 'limit') {
      if (answeredQuestion && r.kind === 'done') {
        setExchanges((prev) => [...prev, { question: answeredQuestion, transcript: r.transcript }]);
      }
      releaseTtsResources(); // 面接終了 → 読み上げを止める
      setTtsStage('idle');
      setCurrentQuestion(null);
      setAnswerText('');
      setVoiceStage('idle');
      setQuestionError(false);
      setDone(true);
    } else {
      setErrorMsg('回答の送信に失敗しました。再試行してください。');
    }
  }

  // ── 回答送信（音声・テキスト共通で text answer として保存）─────────────
  //   音声回答も STT 後の transcript を answerText に入れ、本関数で text answer として送る。
  //   → 既存の text 回答フロー（/turn text）= 1セッション1カウントの課金仕様に合流する。
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

  // ── 音声入力（録音 → STT → transcript を answerText に格納。保存はしない）──────
  async function startRecording() {
    setErrorMsg(null);
    if (!mediaSupported) {
      setInputMode('text');
      setErrorMsg('この環境では録音できません。テキストで回答してください。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // mimeType は決め打ちしない（Safari/iOS は audio/mp4、Chrome は audio/webm）。
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        // この録音ぶんのマイクは即解放（transcribe は blob のみで進む）。
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        void handleTranscribe(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setVoiceStage('recording');
    } catch {
      // getUserMedia 後に MediaRecorder 生成で失敗しても stream を取りこぼさない。
      stopRecordingResources();
      setInputMode('text');
      setErrorMsg('マイクへのアクセスが許可されませんでした。テキストで回答してください。');
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    // onstop で handleTranscribe に進む。stage は transcribing へ。
    setVoiceStage('transcribing');
  }

  // 録音 blob を STT API でテキスト化。成功で answerText にセット（音声モードは読み取り専用で確認のみ）。
  // 失敗時は保存も課金もしない。STT 中にリソース解放（切替/中断/unmount 等）が起きたら結果は破棄する（M-3）。
  // 音声 blob はここで破棄。
  async function handleTranscribe(blob: Blob) {
    const reqId = (transcribeIdRef.current += 1);
    setVoiceStage('transcribing');
    const r = await transcribeVoice(blob);
    // 解放（切替/リセット/中断/unmount）で無効化された STT の結果は反映しない。
    if (reqId !== transcribeIdRef.current) return;
    if (r.kind === 'ok') {
      // inputMode は voice のまま（編集不可の readonly 欄に表示）。
      setAnswerText(r.transcript);
      setVoiceStage('idle');
      return;
    }
    // 失敗時は録音リソースを解放（マイクを残さない）。
    stopRecordingResources();
    if (r.error === 'stt-unavailable') {
      // provider 無効 → 録り直しても無駄なのでテキスト入力へ誘導。
      setVoiceStage('idle');
      setInputMode('text');
      setErrorMsg('音声認識が利用できません。テキストで回答してください。');
    } else {
      // 一時失敗 → 音声モードのまま idle に戻し「録音し直す / テキストで回答」の二択を残す（M-2）。
      setVoiceStage('idle');
      setErrorMsg('音声認識に失敗しました。録音し直すか、テキストで回答に切り替えてください。');
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
        showQuestion(r.question);
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
    stopRecordingResources();
    releaseTtsResources();
    setTtsStage('idle');
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
    stopRecordingResources();
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
      {/* 診断用 debug 表示。sourceTypesEnabled が true のとき（= env true または Preview query
          override）だけ描画。本番 passai.jp では query override が効かず env も未設定のため
          常に false → 一切表示されない。env / query / hostname / phase を内訳表示する。 */}
      {mounted && sourceTypesEnabled && (
        <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 break-all">
          <div>debug: SOURCE_TYPES_ENABLED = {String(sourceTypesEnabled)}</div>
          <div>env flag = {String(isInterviewSourceTypesEnabledByEnv())}</div>
          <div>query override = {String(isInterviewSourceTypesEnabledByQuery())}</div>
          <div>
            hostname ={' '}
            {typeof window !== 'undefined' ? window.location.hostname : '(ssr)'}
          </div>
          <div>phase = {phase}</div>
        </div>
      )}

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

      {/* TYPE SELECT（大学選択後に表示。flag on のみ。どの内容をもとに面接するか） */}
      {phase === 'type' && sourceTypesEnabled && (
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

          {loading && <p className="text-sm text-gray-500 mb-3">面接を準備中…</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            {INTERVIEW_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleSelectType(type)}
                disabled={loading}
                className={`text-left bg-white border border-gray-200 hover:border-blue-400 rounded-xl p-5 transition-colors ${
                  loading ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <p className="text-sm font-bold text-gray-800 mb-1">
                  <span className="mr-1">{TYPE_CARD_EMOJI[type]}</span>
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
            <span className="block text-sm font-semibold text-gray-700 mb-2">
              回答方法（既定・あとで切替できます）
            </span>
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
                disabled={!mediaSupported}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
                  mode === 'voice'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300'
                } ${!mediaSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                音声（録音）
              </button>
            </div>
            {!mediaSupported && (
              <p className="text-xs text-amber-700 mt-2">
                ※ この端末/ブラウザは録音に対応していないため、テキストで回答します。
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
              : sourceTypesEnabled
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
                {/* 質問テキストは必ず表示。TTS はこの下の読み上げコントロールで追加する。 */}
                <p className="text-base text-gray-800 mb-2">{currentQuestion}</p>

                {/* AI 質問読み上げ（TTS）。provider 未設定（unavailable）時はコントロールを出さない。
                    自動再生がブロックされた場合は「🔊 読み上げ」ボタンで手動再生できる。 */}
                {ttsStage !== 'unavailable' && (
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {ttsStage === 'loading' ? (
                      <span className="text-xs text-gray-500">🔊 読み上げ準備中…</span>
                    ) : ttsStage === 'playing' ? (
                      <button
                        type="button"
                        onClick={stopSpeech}
                        className="text-sm text-gray-700 border border-gray-300 hover:border-gray-400 font-semibold px-3 py-1.5 rounded-lg"
                      >
                        ⏸ 停止
                      </button>
                    ) : ttsStage === 'ended' || ttsStage === 'paused' ? (
                      <button
                        type="button"
                        onClick={replaySpeech}
                        className="text-sm text-blue-600 border border-blue-300 hover:border-blue-400 font-semibold px-3 py-1.5 rounded-lg"
                      >
                        🔊 もう一度聞く
                      </button>
                    ) : ttsStage === 'blocked' ? (
                      <button
                        type="button"
                        onClick={replaySpeech}
                        className="text-sm text-blue-600 border border-blue-300 hover:border-blue-400 font-semibold px-3 py-1.5 rounded-lg"
                      >
                        🔊 読み上げ
                      </button>
                    ) : (
                      // 'idle' / 'failed' → 読み上げ（再生成）。
                      <button
                        type="button"
                        onClick={() => void speak(currentQuestion)}
                        className="text-sm text-blue-600 border border-blue-300 hover:border-blue-400 font-semibold px-3 py-1.5 rounded-lg"
                      >
                        🔊 読み上げ
                      </button>
                    )}
                  </div>
                )}

                {inputMode === 'voice' ? (
                  <div className="flex flex-col gap-2">
                    {voiceStage === 'recording' ? (
                      <button
                        type="button"
                        onClick={stopRecording}
                        className="px-5 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white animate-pulse"
                      >
                        ⏹ 録音停止
                      </button>
                    ) : voiceStage === 'transcribing' ? (
                      <p className="text-sm text-gray-500">文字起こし中…</p>
                    ) : answerText ? (
                      <>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">
                          文字起こし結果（編集できません）
                        </label>
                        {/* 音声モードは本番再現のため編集不可（readonly 表示）。手動編集 / 言い換え不可。 */}
                        <textarea
                          readOnly
                          aria-readonly="true"
                          className={`${INPUT_CLASS} min-h-[120px] resize-y mb-1 bg-slate-50 text-slate-700`}
                          value={answerText}
                        />
                        <p className="text-xs text-amber-700 mb-2">
                          音声回答は本番の面接を想定しているため、文字起こし結果の編集はできません。
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={handleSubmitText} disabled={loading || !answerText.trim()}>
                            この内容で送信
                          </Button>
                          <button
                            type="button"
                            onClick={() => {
                              stopRecordingResources();
                              setAnswerText('');
                              setVoiceStage('idle');
                            }}
                            disabled={loading}
                            className="text-sm text-gray-600 border border-gray-300 hover:border-gray-400 font-semibold px-4 py-2 rounded-lg"
                          >
                            録音し直す
                          </button>
                        </div>
                      </>
                    ) : (
                      <Button onClick={startRecording} disabled={loading}>
                        🎤 録音開始
                      </Button>
                    )}
                    {/* 文字起こし中は切替を出さない（編集不可仕様の死守 / M-3）。
                        切替時は録音リソースを解放してマイクを止める（H-1）。 */}
                    {voiceStage !== 'transcribing' && (
                      <button
                        type="button"
                        onClick={() => {
                          stopRecordingResources();
                          setInputMode('text');
                          setAnswerText('');
                          setVoiceStage('idle');
                        }}
                        className="text-xs text-blue-600 hover:text-blue-700 underline self-start mt-1"
                      >
                        テキストで回答に切り替え
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">
                      回答（送信前に確認・編集できます）
                    </label>
                    <textarea
                      className={`${INPUT_CLASS} min-h-[120px] resize-y mb-1`}
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      placeholder="回答を入力してください"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={handleSubmitText} disabled={loading || !answerText.trim()}>
                        次へ
                      </Button>
                      {mediaSupported && (
                        <button
                          type="button"
                          onClick={() => {
                            setInputMode('voice');
                            setAnswerText('');
                            setVoiceStage('idle');
                          }}
                          className="text-sm text-blue-600 hover:text-blue-700 border border-blue-300 hover:border-blue-400 font-semibold px-4 py-2 rounded-lg"
                        >
                          🎤 音声で回答
                        </button>
                      )}
                    </div>
                  </>
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
