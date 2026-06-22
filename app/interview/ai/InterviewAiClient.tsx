'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { AlertBox } from '@/components/ui/AlertBox';
import {
  abandonSession,
  completeSession,
  createSession,
  getActiveSession,
  getSessionState,
  kickoff,
  prefetchNextQuestion,
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
import { INTERVIEW_AI_MAX_ANSWER_TURNS } from '@/lib/interviewAi/limits';
import {
  isInterviewSourceTypesEnabledByEnv,
  isInterviewSourceTypesEnabledByQuery,
  isInterviewSourceTypesEnabledClient,
  isInterviewSourceTypesDebugVisible,
  isInterviewPrefetchEnabled,
  isPrefetchAllowedForInterviewType,
  isInterviewTextFallbackEnabledByEnv,
  isInterviewTextFallbackEnabledClient,
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
// 開発者用テキスト回答フォールバック（env || Preview ?textMode=1）。一般ユーザーは常に false。
// ON のときだけ、エラー未発生でも音声/テキスト切替・テキスト入力を常時使える（QA・開発検証用）。
// query override は client のみのため useSyncExternalStore で hydration mismatch を回避する。
function useTextFallbackEnabled(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    isInterviewTextFallbackEnabledClient, // client snapshot（env || query）
    isInterviewTextFallbackEnabledByEnv, // server snapshot（env のみ）
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

// req ④: 質問生成（kickoff / followup）再試行の上限。これを超えたら同じ API を叩かせず、
// 中断してやり直す導線に切り替える（無限再試行・無限ループの防止）。
const MAX_QUESTION_RETRIES = 3;

// TTS 音声キャッシュの上限件数。1 セッションの質問数（≒5）には十分で、万一の暴走増加を防ぐ。
const TTS_CACHE_MAX = 12;

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

// 保存済みターン（turn_index 昇順 [Q, A, Q, A, …]）を「質問→回答」ペアの表示用 Exchange[] に畳む。
// 再開時に「これまでのやり取り」を復元するための表示専用変換（STEP2 req ②）。
// 末尾の未回答質問（= currentQuestion）はペアにしない（回答が来て初めて確定する）。
function buildExchangesFromTurns(
  turns?: { role: 'question' | 'answer'; content: string }[],
): Exchange[] {
  if (!turns || turns.length === 0) return [];
  const out: Exchange[] = [];
  let pendingQuestion: string | null = null;
  for (const t of turns) {
    if (t.role === 'question') {
      pendingQuestion = t.content;
    } else {
      out.push({ question: pendingQuestion ?? '', transcript: t.content });
      pendingQuestion = null;
    }
  }
  return out;
}

export function InterviewAiClient() {
  // env または Preview query override で有効化（client mount 後に query を含めて確定）。
  const sourceTypesEnabled = useSourceTypesEnabled();
  // 開発者用テキスト回答フォールバック。ON のときだけ音声/テキスト切替を一般表示する（QA・開発検証用）。
  const devTextFallback = useTextFallbackEnabled();
  const mounted = useMounted();

  // 常に setup（大学・学部選択）から始める。タイプ選択は setup 完了後（有効時のみ）。
  const [phase, setPhase] = useState<Phase>('setup');
  const [university, setUniversity] = useState('');
  const [faculty, setFaculty] = useState('');
  const [examType, setExamType] = useState('');

  // 元データ欠如の誘導カード（タイプ選択時に解決した結果。解決済みデータは startSession へ引数で渡す）。
  const [guidance, setGuidance] = useState<(SourceGuidance & { type: InterviewType }) | null>(null);

  const [session, setSession] = useState<AiSession | null>(null);
  // session の最新値を同期参照する ref。setSession の再レンダー前（kickoff 等の同期処理中）でも
  // sessionId / interviewType を確実に読むため、setSession と同じ箇所で eager に更新する。
  const sessionRef = useRef<AiSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  // exchanges は「画面に出す過去のやり取り」の表示専用バッファ。質問数のカウントには使わない（req ②）。
  // 質問数の唯一の正は server 側の countAnswerTurns（= answer ターン件数）であり、その client ミラーが
  // answeredCount。質問番号 / 残り数の算出は answeredCount だけから行う（exchanges.length では数えない）。
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  // これまでに受理（保存）された回答数 = 質問数の単一情報源（client ミラー / req ②）。
  // 質問番号表示（= answeredCount + 1）と残り数の算出に使う。通常フローは server 受理に同期して +1 し、
  // 再開時は exchanges を復元しないため server の answerCount から seed する（再開後も正しい番号を出す）。
  const [answeredCount, setAnsweredCount] = useState(0);
  const [done, setDone] = useState(false);
  const [questionError, setQuestionError] = useState(false);
  // req ④: kickoff / followup の再試行回数。MAX_QUESTION_RETRIES で打ち切る。
  // 新しい質問が出る（showQuestion）/ 最初から（resetToStart）でリセットする。
  const [retryCount, setRetryCount] = useState(0);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resume, setResume] = useState<AiSession | null>(null);
  const [result, setResult] = useState<Extract<CompleteResult, { kind: 'completed' }> | null>(null);

  // 回答の入力方法（現在の実効モード）。defaultInputMode() でセッション開始 / 再開時に初期化し、
  // 以降は質問が変わっても保持する（質問切替で勝手に変わらない / req ①）。2026-06 方針では
  // 一般ユーザーの実効モードは原則 voice。変わるのは
  //   (a) STT 失敗 / マイク拒否による voice→text 自動フォールバック（例外時のみテキスト解放 = 解釈A）
  //   (b) 開発者用 flag（devTextFallback）ON のときの明示トグル（QA・開発検証用）
  // の 2 経路のみ。TTS の成否は inputMode に一切影響しない（補助機能として分離 / req ⑥）。
  // 音声回答も最終的には STT 後の text answer として保存する（1セッション1課金は不変）。
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('text');
  // 音声入力のサブ状態。idle: 録音前 or 文字起こし結果待ち / recording: 録音中 / transcribing: STT 中。
  const [voiceStage, setVoiceStage] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  // マイク許可拒否（NotAllowedError 等）からの復帰 UI 用。Safari は一度拒否すると getUserMedia が
  // 自動で再プロンプトしないため、明示的な「再確認」導線を出す。ページ表示時に自動取得はしない
  // （ユーザーが「音声で回答」or「マイク許可を再確認する」を押した時だけ getUserMedia を呼ぶ）。
  const [micDenied, setMicDenied] = useState(false);
  const [micRecheckFailed, setMicRecheckFailed] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // 進行中 STT を無効化するためのトークン。録音リソース解放のたびに ++ し、
  // handleTranscribe は開始時の値と一致するときだけ結果を反映する（M-3: 編集不可仕様の死守）。
  const transcribeIdRef = useRef(0);

  // req ⑤: 二重送信ガード（連打対策）。送信系アクション（セッション作成 / 回答送信 / 再試行 /
  // 完了 / 中断 / 再開）は必ず beginSubmit() で開始し、finally で endSubmit() する。
  // loading（UI 無効化）と二重化することで、setState 反映前の同期連打も同期 ref で確実に弾く。
  const submittingRef = useRef(false);
  function beginSubmit(): boolean {
    if (submittingRef.current) return false;
    submittingRef.current = true;
    return true;
  }
  function endSubmit() {
    submittingRef.current = false;
  }

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
  // session 内の音声キャッシュ（Map<質問テキスト, 音声Blob>）。同じ質問の読み上げを再生成しない。
  // 保存は DB / Storage には一切しない（client メモリ上のみ。session を抜ける resetToStart で破棄）。
  // モードごとに話し方が変わるため、session（=同一モード）境界でのみ再利用し、reset で必ずクリアする。
  const ttsCacheRef = useRef<Map<string, Blob>>(new Map());

  // ── 自動再生アンロック（iOS Safari 対策 / 提案A） ─────────────────────
  // iOS Safari は「ユーザー操作の直接スタック外の audio.play()」をブロックする。初回質問は
  // 「開始」クリック → await（session作成/kickoff）後に play() するため、ジェスチャ外と判定され
  // blocked になりやすい。対策として開始/再開クリックの同期スタック内で audioRef の要素を一度
  // 無音再生して unlock し、以降の質問読み上げ（startPlayback）は同一要素を使い回す。
  //   - 音声は無音の空 WAV（data URI）。生成も保存もしない。TTS ロジック（tts.ts/route）は不変。
  const audioUnlockedRef = useRef(false);
  const unlockAudioPlayback = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true; // 多重 unlock を避ける（1ジェスチャ1回）
    // 0 サンプルの無音 WAV（44byte ヘッダのみ）。play 即 pause で要素を「許可済み」にする。
    const SILENT_WAV =
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    try {
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.src = SILENT_WAV;
      const p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          try {
            a.pause();
            a.currentTime = 0;
          } catch {
            /* ignore */
          }
        }).catch(() => {
          /* unlock 失敗時も面接は止めない（blocked 経由で手動再生に誘導） */
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  // ── 次質問の先読み（prefetch / 候補採用） ─────────────────────────────
  // 現在の質問を表示した直後、回答を待たずに「次に出す可能性が高い質問候補」を裏で1件生成しておく。
  // 回答時にこの候補を /turn の presetQuestion として即採用し、AI 生成の待機を消す。
  // 失敗 / 未生成なら候補 null のまま送信 → server が従来どおり生成（フォールバック）。
  // flag OFF（既定）では prefetchNext が即 return し、候補は常に null ＝ 従来挙動と完全同一。
  const [nextQuestionCandidate, setNextQuestionCandidate] = useState<string | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);
  // 進行中 prefetch を無効化するトークン。質問が変わる/リセットのたびに ++ し、古い候補を捨てる。
  const prefetchReqRef = useRef(0);

  // 先読み状態を初期化（質問切替・リセット・終了時）。in-flight 結果も破棄する。
  const resetPrefetch = useCallback(() => {
    prefetchReqRef.current += 1;
    setNextQuestionCandidate(null);
    setIsPreloading(false);
  }, []);

  // 次質問候補をバックグラウンドで先読みする（fire-and-forget）。flag OFF なら何もしない。
  // server が pending 質問なし / 上限到達 / 生成失敗のときは candidate なし → 候補 null（フォールバック）。
  const prefetchNext = useCallback((sessionId: string) => {
    if (!sessionId) return;
    // モード別ガード: 全体 flag ON かつ、このモードが先読み許可（free / pressure）のときだけ先読みする。
    // self_analysis / statement / essay は回答依存の深掘り精度を優先し、先読みしない（候補 null = 従来生成）。
    if (!isPrefetchAllowedForInterviewType(sessionRef.current?.interviewType)) return;
    const reqId = (prefetchReqRef.current += 1);
    setIsPreloading(true);
    void (async () => {
      const r = await prefetchNextQuestion(sessionId);
      if (reqId !== prefetchReqRef.current) return; // 質問が変わった後の結果は破棄
      setIsPreloading(false);
      setNextQuestionCandidate(r.kind === 'candidate' ? r.question : null);
    })();
  }, []);

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

  // ── ページ表示時の再開検出（STEP2 req ①） ──────────────────────────
  // mount 時に server の in_progress セッションを問い合わせ、あれば既存の再開ダイアログを出す。
  // localStorage 等の古い client 状態には依存しない（server が単一情報源）。
  // StrictMode の二重 mount でも多重 fetch しないよう ref で 1 回に限定する。
  const activeCheckedRef = useRef(false);
  useEffect(() => {
    if (activeCheckedRef.current) return;
    activeCheckedRef.current = true;
    let cancelled = false;
    void (async () => {
      const r = await getActiveSession();
      if (cancelled || r.kind !== 'active') return;
      // 既存の再開ダイアログ（resume）を表示。既にセット済み（create の 409 等）なら上書きしない。
      setResume((cur) => cur ?? r.session);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // AI 質問テキストを TTS で読み上げる（新規生成）。
  //   - 成功: 音声を取得 → object URL 化 → 自動再生（ブロックされたら 'blocked' で手動再生に誘導）。
  //   - 失敗: 面接は止めない。provider 未設定なら 'unavailable'（以降 fetch しない）、
  //           一時失敗なら 'failed' + 軽い案内（テキストで続行できる）。
  const speak = useCallback(
    async (text: string) => {
      // 正式公開まで TTS は flag ON（env true / vercel.app Preview の ?sourceTypes=1）限定。
      // flag false（= 本番 passai.jp / env 未設定）では provider env が設定されていても
      // 一切 fetch せず、従来どおりテキスト質問のみで進める。
      if (!sourceTypesEnabled) {
        setTtsStage('unavailable');
        return;
      }
      const t = (text || '').trim();
      if (!t) return;
      if (ttsUnavailableRef.current) {
        // provider 未設定が既知 → 無駄な fetch をしない。
        setTtsStage('unavailable');
        return;
      }
      releaseTtsResources(); // 進行中 fetch を無効化 + 前の音声を解放
      const reqId = ttsReqRef.current;

      // 取得済み（cache hit / 新規生成）の音声 Blob を object URL 化して自動再生する共通処理。
      // 質問が切り替わっていたら（reqId 不一致）鳴らさない（古い質問の音声を防ぐ）。
      const startPlayback = async (audioBlob: Blob) => {
        if (reqId !== ttsReqRef.current) return;
        const url = URL.createObjectURL(audioBlob);
        ttsUrlRef.current = url;
        // unlock 済みの audio 要素があれば使い回す（iOS Safari は同一要素なら以降の play が通る）。
        // 無ければ新規生成（unlock 前 / 非対応環境）。全プロパティを設定してから ref に格納する。
        const audio = audioRef.current ?? new Audio();
        audio.muted = false;
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
      };

      // session 内キャッシュ（Map<cacheKey, 音声Blob>）。同じ質問は再生成しない（loading も挟まない）。
      // key は `${interviewType}:${questionText}`。安定した questionId は client 状態に無く
      // （turnIndex は turn route 内部に留まり、retryFollowup 再生成で衝突しうる）、ターン制フローの
      // plumbing を変えずに使える text を採用。interviewType を前置してモード跨ぎの再利用を防ぐ。
      const mode = sessionRef.current?.interviewType ?? 'free';
      const cacheKey = `${mode}:${t}`;
      const cached = ttsCacheRef.current.get(cacheKey);
      if (cached) {
        await startPlayback(cached);
        return;
      }

      setTtsStage('loading');
      // モード別の話し方で読み上げる（session.interviewType を渡す。未確定なら本番モード相当）。
      const r = await synthesizeSpeech(t, mode);
      // 質問が変わった/解放された後の結果は破棄（古い質問の音声を鳴らさない）。
      if (reqId !== ttsReqRef.current) return;
      if (r.kind === 'error') {
        if (r.error === 'tts-unavailable') {
          ttsUnavailableRef.current = true;
          setTtsStage('unavailable');
        } else {
          // 一時失敗。TTS は補助機能なので面接は止めない。questionError / retryFollowup / 質問再生成は
          // 一切行わず、状態は interviewing のまま（req ①）。案内は致命エラー用の共有 errorMsg ではなく、
          // TTS コントロール脇のインライン軽案内（ttsStage='failed'）で出す＝質問生成失敗と混同しない（req ②）。
          console.error('[interview-ai] tts failed', r.error);
          setTtsStage('failed');
        }
        return;
      }
      // 生成成功 → session 内で再利用できるようキャッシュ（上限超過時は最古を1件捨てる）。
      if (ttsCacheRef.current.size >= TTS_CACHE_MAX) {
        const oldest = ttsCacheRef.current.keys().next().value;
        if (oldest !== undefined) ttsCacheRef.current.delete(oldest);
      }
      ttsCacheRef.current.set(cacheKey, r.audio);
      await startPlayback(r.audio);
    },
    [releaseTtsResources, sourceTypesEnabled],
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

  // ── 音声機能の有効判定（優先度C） ───────────────────────────────────
  // 音声は補助機能。available でなければ UI を出さず、面接はテキストだけで必ず完走できる。
  //
  // STT（録音）available 条件:
  //   feature flag ON（= env true / vercel.app Preview の ?sourceTypes=1。本番 passai.jp は常に false）
  //   かつ ブラウザが録音対応（MediaRecorder + getUserMedia）。
  //   ※ 録音権限拒否 / API 失敗（stt-unavailable / stt-failed）は実行時に判明するため、
  //     startRecording / handleTranscribe 側でテキスト入力へフォールバックする（既存挙動）。
  const sttAvailable = sourceTypesEnabled && mediaSupported;
  //
  // TTS（読み上げ）available 条件:
  //   feature flag ON。provider 未設定 / API 失敗は実行時（speak）に判明し ttsStage='unavailable'
  //   になってコントロールを隠す（API利用可否は実行時判定）。
  const ttsAvailable = sourceTypesEnabled;

  // 質問テキストの表示可否（2026-06 方針: 本番面接に近づけるため、通常は質問文を見せず音声で聞かせる）。
  // 通常時（loading/playing/ended/paused/idle）は非表示。ただし音声で聞けない/聞き直せない状況では
  // 安全側でテキストを自動表示する（フォールバックとして残す。手動トグルは置かない）。
  //   - !ttsAvailable        … TTS 無効環境（flag OFF / 旧テキスト面接）→ 常に表示（音声が無い）
  //   - 'unavailable'        … provider 未設定 → 表示（音声化不可）
  //   - 'failed'             … TTS 一時失敗 → 表示（聞けなかった）
  //   - 'blocked'            … 自動再生ブロック → 表示（手動再生ボタンと併せて救済）
  //   - devTextFallback ON   … 開発/QA debug → 常に表示
  // 評価・履歴・DB保存は currentQuestion state を使うため、この表示制御は一切影響しない。
  const showQuestionText =
    !ttsAvailable ||
    ttsStage === 'unavailable' ||
    ttsStage === 'failed' ||
    ttsStage === 'blocked' ||
    devTextFallback;

  // セッション開始 / 再開時の実効モード初期値（2026-06 方針: 一般ユーザーは音声のみ）。
  // STT 利用可（flag ON + 録音対応）なら voice を既定にする。録音できない環境（flag OFF /
  // 非対応ブラウザ）のみ text（安全側 / 音声が使えない人を排除しない = 解釈A）。質問切替では使わない（req ①）。
  function defaultInputMode(): 'voice' | 'text' {
    return sttAvailable ? 'voice' : 'text';
  }

  // 新しい質問を表示するときのリセット。質問固有の状態（回答テキスト・音声サブ状態）だけ初期化し、
  // inputMode は意図的に保持する（質問切替で実効モードが勝手に変わらない / req ①）。
  // テキスト表示は必ず行い（setCurrentQuestion）、その後に TTS で自動読み上げを試みる
  // （TTS は失敗しても面接を止めない / 質問はテキストで続行できる）。
  function showQuestion(q: string) {
    stopRecordingResources();
    resetPrefetch(); // 前の質問向けに用意した候補を破棄（この質問の「次」をこれから先読みする）
    setCurrentQuestion(q);
    setQuestionError(false);
    setRetryCount(0); // 新しい質問が出た → 再試行カウントをリセット（req ④）
    setAnswerText('');
    setVoiceStage('idle');
    void speak(q); // 自動再生（ブロック時は手動「🔊 読み上げ」に誘導）
    // この質問の「次」をバックグラウンド先読み（flag OFF なら no-op / server が上限時は候補なし）。
    const sid = sessionRef.current?.id;
    if (sid) prefetchNext(sid);
  }

  // 最初（= 大学・学部選択の setup）まで戻す。タイプ選択は setup の後段なので、戻り先は常に setup。
  function resetToStart(message?: string) {
    stopRecordingResources();
    releaseTtsResources();
    ttsCacheRef.current.clear(); // session を抜ける → 別モードの音声を再利用させない
    setTtsStage('idle');
    resetPrefetch(); // 先読み候補・進行中 prefetch を破棄
    setPhase('setup');
    setGuidance(null);
    sessionRef.current = null;
    setSession(null);
    setCurrentQuestion(null);
    setAnswerText('');
    setExchanges([]);
    setAnsweredCount(0);
    setDone(false);
    setQuestionError(false);
    setRetryCount(0);
    setVoiceStage('idle');
    setInputMode('text'); // setup へ戻る → 実効モードも既定（text）に戻す（req ①）
    setResult(null);
    setResume(null);
    setErrorMsg(message ?? null);
  }

  // setup（大学・学部選択）完了 → 次へ。
  //   - flag off: そのままフリー面接を開始（タイプ選択を出さない / 既存導線）。
  //   - flag on:  タイプ選択 phase へ進む。
  function handleSetupNext() {
    if (!sourceTypesEnabled) {
      unlockAudioPlayback(); // クリック（ジェスチャ）起点で TTS 自動再生を unlock（提案A）
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
    unlockAudioPlayback(); // クリック（ジェスチャ）起点で TTS 自動再生を unlock（提案A）
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
    if (!beginSubmit()) return; // req ⑤: 二重送信ガード
    setLoading(true);
    setErrorMsg(null);
    // 実効モードをセッション既定で初期化（以降は質問切替で変わらない / req ①）。
    setInputMode(defaultInputMode());
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
        sessionRef.current = res.session; // 同期参照を即更新（kickoff 内の showQuestion が読む）
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
      endSubmit();
    }
  }

  async function runKickoff(s: AiSession) {
    const q = await kickoff(s.id);
    if (q.kind === 'question') {
      setDone(false);
      setPhase('interviewing');
      showQuestion(q.question);
    } else {
      // kickoff 失敗。currentQuestion=null のまま「準備中…」で行き止まりにせず、
      // 再試行導線（questionError UI）を出す。answeredCount===0 なので handleRetry は
      // followup ではなく kickoff を再実行する（kickoff のリトライ経路を確保 / req ④・完走保証）。
      setErrorMsg('最初の質問の生成に失敗しました。再試行してください。');
      setPhase('interviewing');
      sessionRef.current = s;
      setSession(s);
      setDone(false);
      setQuestionError(true);
    }
  }

  // ── 再開（in_progress） ─────────────────────────────────────
  async function handleResume() {
    if (!resume) return;
    unlockAudioPlayback(); // クリック（ジェスチャ）起点で TTS 自動再生を unlock（提案A）
    if (!beginSubmit()) return; // req ⑤: 二重送信ガード
    setLoading(true);
    setErrorMsg(null);
    try {
      const st = await getSessionState(resume.id);
      if (st.kind !== 'ok') {
        resetToStart('面接の再開に失敗しました。');
        return;
      }
      sessionRef.current = resume; // 同期参照を即更新（再開直後の showQuestion が読む）
      setSession(resume);
      setResume(null);
      setPhase('interviewing');
      // 再開時の実効モード初期化（req ⑤）。STT 利用可なら voice、非対応環境なら text（解釈A）。
      // 音声が使えない例外時は面接画面側で自動的にテキスト入力へフォールバックする。
      setInputMode(defaultInputMode());
      // 質問数の単一情報源は server の answerCount（client ミラー = answeredCount）。
      setAnsweredCount(st.state.answerCount);
      // これまでのやり取りを表示用に復元（質問→回答ペア）。表示専用でカウントには使わない（req ②）。
      setExchanges(buildExchangesFromTurns(st.state.turns));
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
      endSubmit();
    }
  }

  // ── 回答結果の共通処理 ──────────────────────────────────────
  function applyAnswerResult(r: AnswerResult, answeredQuestion: string | null) {
    if (r.kind === 'next') {
      if (answeredQuestion) {
        setExchanges((prev) => [...prev, { question: answeredQuestion, transcript: r.transcript }]);
        setAnsweredCount((n) => n + 1); // 回答が受理された（server で保存・課金確定）
      }
      showQuestion(r.question);
    } else if (r.kind === 'question-error') {
      if (answeredQuestion) {
        setExchanges((prev) => [...prev, { question: answeredQuestion, transcript: r.transcript }]);
        setAnsweredCount((n) => n + 1); // 回答は保存済み（followup 生成のみ失敗）
      }
      releaseTtsResources(); // 回答済み質問の読み上げを止める
      setTtsStage('idle');
      resetPrefetch(); // 候補は無効（次質問は再試行で生成し直す）
      setCurrentQuestion(null);
      setAnswerText('');
      setVoiceStage('idle');
      setQuestionError(true); // 次の質問生成に失敗 → 再試行導線
    } else if (r.kind === 'done' || r.kind === 'limit') {
      if (answeredQuestion && r.kind === 'done') {
        setExchanges((prev) => [...prev, { question: answeredQuestion, transcript: r.transcript }]);
        setAnsweredCount((n) => n + 1); // 最後の回答が受理された
      }
      releaseTtsResources(); // 面接終了 → 読み上げを止める
      setTtsStage('idle');
      resetPrefetch(); // 終了 → 候補不要
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
    if (!beginSubmit()) return; // req ⑤: 二重送信ガード（回答の二重保存・二重課金を防ぐ）
    setLoading(true);
    setErrorMsg(null);
    try {
      // 先読み候補があれば presetQuestion として渡す（server が次質問に即採用 → AI 生成待ちを消す）。
      // 無ければ null ＝ server は従来どおり生成（フォールバック）。課金・保存仕様は不変。
      const r = await submitTextAnswer(session.id, answer, nextQuestionCandidate);
      applyAnswerResult(r, currentQuestion);
    } finally {
      setLoading(false);
      endSubmit();
    }
  }

  // ── 音声入力（録音 → STT → transcript を answerText に格納。保存はしない）──────
  async function startRecording() {
    setErrorMsg(null);
    // STT unavailable（flag OFF / 非対応ブラウザ）なら録音せずテキスト入力へ。UI 上は到達しないが防御的に。
    if (!sttAvailable) {
      setInputMode('text');
      setErrorMsg('この環境では録音できません。テキストで回答してください。');
      return;
    }
    try {
      // ユーザー操作（録音開始）起点でのみ getUserMedia を呼ぶ（自動取得はしない）。
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicDenied(false);
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
    } catch (err) {
      // getUserMedia 後に MediaRecorder 生成で失敗しても stream を取りこぼさない。
      stopRecordingResources();
      setInputMode('text');
      const name = (err as { name?: string })?.name ?? '';
      if (
        name === 'NotAllowedError' ||
        name === 'PermissionDeniedError' ||
        name === 'SecurityError'
      ) {
        // マイク拒否 → 復帰用 Alert（黄色）を出す。汎用 errorMsg は出さない（Alert 側で案内）。
        setMicDenied(true);
        setMicRecheckFailed(false);
        setErrorMsg(null);
      } else {
        setErrorMsg('マイクへのアクセスが許可されませんでした。テキストで回答してください。');
      }
    }
  }

  // マイク許可の再確認（Safari は一度拒否すると自動再プロンプトしないため、明示ボタンで再試行）。
  // ユーザー操作起点でのみ getUserMedia を呼ぶ。成功したら即 track.stop()（録音はしない）。
  async function recheckMic() {
    setMicRecheckFailed(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 許可確認のためだけに取得 → 即解放。
      stream.getTracks().forEach((t) => t.stop());
      setMicDenied(false);
      setErrorMsg(null);
      // 音声回答ボタンを再度使える状態に戻す。
      setInputMode('voice');
      setVoiceStage('idle');
    } catch {
      // まだ拒否のまま → Safari の再設定＋再読み込みを案内する。
      setMicRecheckFailed(true);
    }
  }

  function stopRecording() {
    // 連打 / 二重停止ガード（req ④）。録音中以外で stop() を呼ぶと MediaRecorder が
    // InvalidStateError を投げるため、state を見てから 1 回だけ停止する。
    const rec = recorderRef.current;
    if (!rec || rec.state !== 'recording') return;
    rec.stop();
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
    // STT 失敗時は保存も課金もしない（turn を作らない / answeredCount を増やさない / 次の質問へ進まない）。
    // 録音リソースを解放（マイクを残さない / req ⑥）し、面接を止めず同じ質問のままテキスト入力へ
    // フォールバックする（req ①②）。currentQuestion は維持。answerText は空のまま（STT 失敗＝transcript 無し）
    // → ユーザーがテキストで回答 → 既存の text turn（/turn）に流す＝初回回答として 1 回だけ課金（req ③）。
    stopRecordingResources();
    setVoiceStage('idle');
    setAnswerText('');
    setInputMode('text');
    if (r.error === 'stt-unavailable') {
      // provider 無効 → 録り直しても無駄。テキスト入力へ誘導。
      setErrorMsg('音声認識が利用できません。テキストで回答してください。');
    } else {
      // 一時失敗（stt-failed / stt-empty 等）→ 同じ質問のままテキスト入力で続行できるようにする。
      setErrorMsg(
        '音声の文字起こしに失敗しました。お手数ですが、この質問への回答をテキストで入力してください。',
      );
    }
  }

  // ── followup 再試行 ─────────────────────────────────────────
  async function handleRetry() {
    if (!session) return;
    if (!beginSubmit()) return; // req ⑤: 二重送信ガード
    // req ④: 再試行回数に上限を設ける。上限を超えたら同じ API を叩かせない（無限再試行・無限ループ防止）。
    if (retryCount >= MAX_QUESTION_RETRIES) {
      setErrorMsg(
        '質問の生成を複数回試みましたが失敗しました。お手数ですが面接を中断して、もう一度お試しください。',
      );
      endSubmit();
      return;
    }
    setRetryCount((n) => n + 1);
    setLoading(true);
    setErrorMsg(null);
    try {
      // answeredCount===0 = 「最初の質問（kickoff）すら生成できていない」状態。
      // この場合は followup ではなく kickoff を再実行する（kickoff 失敗の行き止まり防止）。
      // 成功時は runKickoff→showQuestion が retryCount をリセットする。
      if (answeredCount === 0) {
        await runKickoff(session);
        return;
      }
      const r = await retryFollowup(session.id);
      if (r.kind === 'next') {
        showQuestion(r.question); // showQuestion が retryCount をリセット
      } else if (r.kind === 'done' || r.kind === 'limit') {
        setQuestionError(false);
        setRetryCount(0);
        setDone(true);
      } else if (r.kind === 'question-error') {
        setErrorMsg('再試行しましたが、まだ次の質問を生成できませんでした。もう一度お試しください。');
      } else {
        setErrorMsg('再試行に失敗しました。');
      }
    } finally {
      setLoading(false);
      endSubmit();
    }
  }

  // ── 完了 ────────────────────────────────────────────────────
  async function handleComplete() {
    if (!session) return;
    if (!beginSubmit()) return; // req ⑤: 二重送信ガード
    stopRecordingResources();
    releaseTtsResources();
    setTtsStage('idle');
    resetPrefetch();
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
      endSubmit();
    }
  }

  // ── 中断（明示キャンセル） ──────────────────────────────────
  async function handleAbandon(sessionId: string) {
    if (!window.confirm('この面接を中断しますか？（再開できなくなります）')) return;
    if (!beginSubmit()) return; // req ⑤: 二重送信ガード
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
      endSubmit();
    }
  }

  // 質問数 / 残り表示用の派生値。現在表示中の質問の番号 = 受理済み回答数 + 1（上限でクランプ）。
  // 残り = 上限 − 現在番号（この質問より後に出る質問数）。0 なら最後の質問。
  const totalQuestions = INTERVIEW_AI_MAX_ANSWER_TURNS;
  const questionNumber = Math.min(answeredCount + 1, totalQuestions);
  const remainingAfter = Math.max(totalQuestions - questionNumber, 0);

  // ── 描画 ────────────────────────────────────────────────────
  return (
    <div>
      {/* 診断用 debug 表示。**本番ホスト（passai.jp / www.passai.jp）では常に非表示**
          （isInterviewSourceTypesDebugVisible が本番ホストで false を返す）。
          本番で NEXT_PUBLIC_ENABLE_INTERVIEW_SOURCE_TYPES=true にしても本番ユーザーには出ない。
          localhost / vercel.app Preview の sourceTypes 有効時のみ env/query/hostname/phase を内訳表示する。 */}
      {mounted && isInterviewSourceTypesDebugVisible() && (
        <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 break-all">
          <div>debug: SOURCE_TYPES_ENABLED = {String(sourceTypesEnabled)}</div>
          <div>env flag = {String(isInterviewSourceTypesEnabledByEnv())}</div>
          <div>query override = {String(isInterviewSourceTypesEnabledByQuery())}</div>
          <div>
            hostname ={' '}
            {typeof window !== 'undefined' ? window.location.hostname : '(ssr)'}
          </div>
          <div>phase = {phase}</div>
          {/* 先読み（prefetch）の状態。本番ホストでは debug box ごと非表示なので出ない。 */}
          <div>prefetch flag = {String(isInterviewPrefetchEnabled())}</div>
          <div>
            prefetch allowed({session?.interviewType ?? '-'}) ={' '}
            {String(isPrefetchAllowedForInterviewType(session?.interviewType))}
          </div>
          <div>
            prefetch = {isPreloading ? 'loading…' : nextQuestionCandidate ? 'candidate ready' : 'none'}
          </div>
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

          {/* 2026-06 方針: 一般ユーザーの回答方法は「音声のみ」。setup での音声/テキスト切替は廃止した。
              音声が使えない例外時（マイク拒否 / Safari 不具合 / STT 障害）のみ、面接画面側で自動的に
              テキスト入力へフォールバックする。開発者用 flag（devTextFallback）の時だけ切替を出す。 */}
          {sttAvailable && (
            <div className="mb-5 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
              <p className="text-sm text-blue-900">
                🎤 この面接は<strong>音声で回答</strong>します。本番の大学面接のように、声に出して答えてください。
              </p>
            </div>
          )}

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
            {loading && <p className="text-sm text-gray-500 mb-3">🤖 AIが考えています…</p>}

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
                {/* 質問番号 / 全質問数 / 残り質問数。answeredCount から算出し、再開時も正しく出る。 */}
                <div className="flex items-center justify-between mb-1 gap-2">
                  <p className="text-xs font-semibold text-gray-500">面接官からの質問</p>
                  <span className="shrink-0 text-xs font-semibold text-gray-500 bg-gray-100 rounded-full px-2.5 py-0.5">
                    質問 {questionNumber} / {totalQuestions}
                    {remainingAfter > 0 ? `・残り${remainingAfter}問` : '・最後の質問'}
                  </span>
                </div>
                {/* 通常は質問文を見せず音声で聞かせる（本番面接に近づける）。音声で聞けない/聞き直せない
                    状況（showQuestionText）では質問文を自動表示する（フォールバック）。 */}
                {showQuestionText ? (
                  <p className="text-base text-gray-800 mb-2">{currentQuestion}</p>
                ) : (
                  <p className="text-base font-medium text-gray-600 mb-2">
                    🗣️{' '}
                    {ttsStage === 'playing' || ttsStage === 'loading'
                      ? '面接官が質問しています…'
                      : '質問は音声で流れます（「もう一度聞く」で再生できます）'}
                  </p>
                )}

                {/* AI 質問読み上げ（TTS）。正式公開まで flag ON 限定で表示する
                    （flag false の本番導線では一切出さず、従来どおりテキスト質問のみ）。
                    provider 未設定（unavailable）時もコントロールを出さない。
                    自動再生がブロックされた場合は「🔊 読み上げ」ボタンで手動再生できる。 */}
                {ttsAvailable && ttsStage !== 'unavailable' && (
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {ttsStage === 'loading' ? (
                      <span className="text-xs text-gray-500">🔊 読み上げ準備中…</span>
                    ) : ttsStage === 'playing' ? (
                      <>
                        <span className="text-xs font-semibold text-blue-700">
                          🔊 AIが話しています…
                        </span>
                        <button
                          type="button"
                          onClick={stopSpeech}
                          className="text-sm text-gray-700 border border-gray-300 hover:border-gray-400 font-semibold px-3 py-1.5 rounded-lg"
                        >
                          ⏸ 停止
                        </button>
                      </>
                    ) : ttsStage === 'ended' || ttsStage === 'paused' ? (
                      <button
                        type="button"
                        onClick={replaySpeech}
                        className="text-sm text-blue-600 border border-blue-300 hover:border-blue-400 font-semibold px-3 py-1.5 rounded-lg"
                      >
                        🔊 もう一度聞く
                      </button>
                    ) : ttsStage === 'blocked' ? (
                      // 自動再生がブラウザにブロックされた（iOS Safari 等）。タップ起点で再生できる。
                      // 質問文も showQuestionText により自動表示されるため、読めない行き止まりにはならない。
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={replaySpeech}
                          className="self-start text-sm text-white bg-blue-600 hover:bg-blue-700 font-semibold px-4 py-2 rounded-lg"
                        >
                          🔊 質問を再生する（タップ）
                        </button>
                        <span className="text-xs text-gray-500">
                          ブラウザの設定で自動再生がブロックされました。タップで質問を再生できます。
                        </span>
                      </div>
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
                    {/* TTS 一時失敗の軽い案内（req ②）。致命エラー（赤）ではなくグレーの補足。
                        質問文は有効・回答はそのまま可能で、読み上げ再試行は任意（必須にしない）。 */}
                    {ttsStage === 'failed' && (
                      <span className="text-xs text-gray-500">
                        音声読み上げに失敗しました。質問文を読んで回答してください。
                      </span>
                    )}
                  </div>
                )}

                {/* マイク拒否からの復帰 Alert（黄色）。
                    表示条件は STT API 可否（sttAvailable）ではなく、
                    SOURCE_TYPES_ENABLED（sourceTypesEnabled）かつブラウザのマイク対応（mediaSupported）に紐づける。
                    理由: これはブラウザのマイク権限状態に対する復帰 UI であり、sttAvailable が
                    内部状態 / 一時エラーで false になっても Safari 設定を直す導線を失わせないため。
                    ページ表示時に自動 getUserMedia はしない（ボタン押下時のみ）。 */}
                {sourceTypesEnabled && mediaSupported && micDenied && (
                  <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
                    <p className="text-sm font-semibold text-amber-800">
                      マイクへのアクセスが許可されませんでした
                    </p>
                    <p className="mt-1 text-xs text-amber-700 leading-relaxed">
                      Safari をお使いの場合: アドレスバー左の「ぁあ」/ サイト設定アイコンをタップ →
                      「Webサイトの設定」→「マイク」を「許可」に変更してください。変更後、下のボタンで再確認できます。
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={recheckMic}
                        className="text-sm text-amber-800 border border-amber-400 hover:border-amber-500 hover:bg-amber-100 font-semibold px-4 py-2 rounded-lg transition-colors"
                      >
                        マイク許可を再確認する
                      </button>
                    </div>
                    {micRecheckFailed && (
                      <p className="mt-2 text-xs text-amber-800 leading-relaxed">
                        Safariのアドレスバー左の設定からマイクを許可に変更して、ページを再読み込みしてください。
                      </p>
                    )}
                  </div>
                )}

                {/* sttAvailable を必ず併せて判定（Production では録音 UI を絶対に出さない）。 */}
                {inputMode === 'voice' && sttAvailable ? (
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
                          音声回答は文字起こし後、そのまま保存されます（本番の面接を想定し、編集はできません）。
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
                    {/* 一般ユーザーには音声→テキストの自発切替を出さない（2026-06 方針: 逃げ道を作らない）。
                        開発者用 flag（devTextFallback）ON のときだけ表示する。
                        文字起こし中は出さない（編集不可仕様の死守 / M-3）。切替時はマイクを止める（H-1）。 */}
                    {devTextFallback && voiceStage !== 'transcribing' && (
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
                        テキストで回答に切り替え（開発用）
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* テキスト入力は「内部フォールバック」。一般ユーザーには音声が使えない例外時
                        （マイク拒否 / Safari 不具合 / STT 障害 / 非対応ブラウザ）にだけ自動で出る。
                        この案内は sourceTypes ON（= 音声面接が有効な環境）かつ開発者 flag OFF の
                        フォールバック時にだけ出す。flag OFF の旧テキスト面接 / 開発者 flag ON では出さない。 */}
                    {sourceTypesEnabled && !devTextFallback && (
                      <AlertBox variant="warning" className="mb-3">
                        <p>音声が利用できないため、テキスト回答に切り替えました。</p>
                      </AlertBox>
                    )}
                    <label className="block text-xs font-semibold text-gray-500 mb-1">
                      回答（送信前に自由に編集できます）
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
                      {/* 音声への切替は一般ユーザーには出さない（2026-06 方針）。
                          開発者用 flag（devTextFallback）ON かつ STT 利用可のときだけ表示する。 */}
                      {devTextFallback && sttAvailable && (
                        <button
                          type="button"
                          onClick={() => {
                            setInputMode('voice');
                            setAnswerText('');
                            setVoiceStage('idle');
                          }}
                          className="text-sm text-blue-600 hover:text-blue-700 border border-blue-300 hover:border-blue-400 font-semibold px-4 py-2 rounded-lg"
                        >
                          🎤 音声で回答（開発用）
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
