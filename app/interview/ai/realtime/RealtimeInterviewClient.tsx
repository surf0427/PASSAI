'use client';

/**
 * STEP-INTERVIEW-AI-REALTIME-PR2: リアルタイム音声面接クライアント（WebRTC 接続確認のみ）。
 *
 * スコープ（pr2_webrtc.md）:
 *   token 取得 → getUserMedia → RTCPeerConnection → data channel 'oai-events' → SDP 交換 →
 *   接続状態 / マイク許可 / dc open / error を UI 表示。明示終了と完全な teardown。12 分タイマ。
 *
 * やらない（STEP3+）:
 *   面接ロジック / transcript 取得・表示 / turn 保存 / 課金 / complete。
 *   dc.onmessage は購読するだけ（受信件数のみ表示）。
 *
 * connected 判定 = pcState==='connected' AND dcState==='open'。
 * teardown は unmount / pagehide / error / 明示終了 の全経路で冪等に呼ぶ（マイク確実解放）。
 * 既存 /interview/ai（InterviewAiClient）とは一切コードを共有しない。
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useQuotaDialog } from '@/components/billing/QuotaExceededDialog';
import { INTERVIEW_AI_MAX_ANSWER_TURNS } from '@/lib/interviewAi/limits';
import {
  isRealtimeInterviewEnabled,
  isRealtimeInterviewEnabledClient,
} from '@/lib/interviewAi/realtimeFeatureFlag';
import {
  isWebrtcSupported,
  openRealtimeConnection,
  type RealtimeConnection,
} from './connection';
import { parseRealtimeEvent } from './events';

type TranscriptEntry = { role: 'ai' | 'user'; text: string; final: boolean };

type ConnPhase =
  | 'idle'
  | 'requesting-token'
  | 'requesting-mic'
  | 'connecting'
  | 'connected'
  | 'closing'
  | 'completing'
  | 'result'
  | 'ended'
  | 'error';

type ErrorKind =
  | 'unsupported'
  | 'realtime-disabled'
  | 'not-allowlisted'
  | 'in-progress-exists'
  | 'unauthenticated'
  | 'token-failed'
  | 'mic-denied'
  | 'mic-unavailable'
  | 'connect-failed'
  | 'complete-failed';

type RemoteAudio = 'none' | 'playing' | 'autoplay-blocked';

type RealtimeResult = {
  overall: string;
  strengths: string[];
  improvements: string[];
  nextPractice: string[];
};

const CONNECT_TIMEOUT_MS = 15_000;

const ERROR_TEXT: Record<ErrorKind, string> = {
  unsupported: 'この環境では音声接続を利用できません。別のブラウザでお試しいただくか、テキスト面接をご利用ください。',
  'realtime-disabled': '現在この機能は無効です。',
  'not-allowlisted': '許可されたアカウントのみ利用できます。',
  'in-progress-exists': '進行中の面接があります。先に終了してから開始してください。',
  unauthenticated: 'ログインが必要です。',
  'token-failed': '接続準備に失敗しました。時間をおいて再度お試しください。',
  'mic-denied': 'マイクの使用が許可されませんでした。ブラウザの設定でマイクを許可してください。',
  'mic-unavailable': 'マイクが見つからない、または使用中です。接続を確認して再度お試しください。',
  'connect-failed': '接続に失敗しました。ネットワークを確認して再度お試しください。',
  'complete-failed': '結果の生成に失敗しました。もう一度お試しください。',
};

// flag 判定（hydration 安全）: SSR は env のみ、client は env || ?realtime=1。
function useRealtimeEnabled(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => isRealtimeInterviewEnabledClient(),
    () => isRealtimeInterviewEnabled(),
  );
}

export function RealtimeInterviewClient() {
  const enabled = useRealtimeEnabled();
  const { handleResponse, dialog } = useQuotaDialog();

  const [phase, setPhase] = useState<ConnPhase>('idle');
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [pcState, setPcState] = useState<RTCPeerConnectionState>('new');
  const [iceState, setIceState] = useState<RTCIceConnectionState>('new');
  const [dcOpen, setDcOpen] = useState(false);
  const [remoteAudio, setRemoteAudio] = useState<RemoteAudio>('none');
  const [eventsReceived, setEventsReceived] = useState(0);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [completedQuestions, setCompletedQuestions] = useState(0);
  const [result, setResult] = useState<RealtimeResult | null>(null);
  // in-progress-exists（前回の realtime セッションが残存）時の復旧用。
  const [staleSessionId, setStaleSessionId] = useState<string | null>(null);

  // 接続リソース（render に依存しない可変参照）。
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startingRef = useRef(false); // 多重 start 防止
  const sentInitialRef = useRef(false); // 初回 response.create の二重送信防止
  const sessionIdRef = useRef<string | null>(null); // turn 保存 / complete 用
  const assistantBufferRef = useRef(''); // AI 発話 delta の蓄積（done で確定保存）
  const pendingSavesRef = useRef<Promise<unknown>[]>([]); // 進行中の turn 保存（complete 前に待つ）
  // connected 判定用の最新値（state は非同期のため ref で確実に評価）。
  const pcStateRef = useRef<RTCPeerConnectionState>('new');
  const dcOpenRef = useRef(false);
  const phaseRef = useRef<ConnPhase>('idle');

  const setPhaseSafe = useCallback((p: ConnPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  // ── WebRTC リソースを解放する（phase は変えない。冪等。マイクを確実に止める） ──────
  // complete 生成時にも接続だけ閉じる（DB session は in_progress のまま complete が completed にする）。
  const closeConnection = useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    try {
      dcRef.current?.close();
    } catch {
      /* noop */
    }
    try {
      pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    } catch {
      /* noop */
    }
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      /* noop */
    }
    try {
      pcRef.current?.close();
    } catch {
      /* noop */
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    dcRef.current = null;
    pcRef.current = null;
    streamRef.current = null;
    dcOpenRef.current = false;
    startingRef.current = false;
    setDcOpen(false);
    setRemoteAudio('none');
  }, []);

  // ── teardown（全終了経路で冪等に呼ぶ）。接続解放 + phase 遷移。 ──────────────
  const teardown = useCallback(
    (next: 'ended' | 'error', reason?: string) => {
      closeConnection();
      if (reason) setEndedReason(reason);
      setPhaseSafe(next);
    },
    [closeConnection, setPhaseSafe],
  );

  const fail = useCallback(
    (kind: ErrorKind) => {
      setErrorKind(kind);
      teardown('error');
    },
    [teardown],
  );

  // pc / dc 両方が確立したら connected に遷移し、12 分タイマを開始する。
  const evaluateConnected = useCallback(
    (maxDurationMs: number) => {
      if (phaseRef.current === 'connected') return;
      if (pcStateRef.current === 'connected' && dcOpenRef.current) {
        if (connectTimerRef.current) {
          clearTimeout(connectTimerRef.current);
          connectTimerRef.current = null;
        }
        setPhaseSafe('connected');
        // 12 分（maxDurationMs）で必ず teardown。STEP2 は締め発話なしの単純終了。
        maxDurationTimerRef.current = setTimeout(() => {
          teardown('ended', 'maxduration');
        }, maxDurationMs);
      }
    },
    [setPhaseSafe, teardown],
  );

  const attachRemote = useCallback((stream: MediaStream) => {
    const el = audioRef.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().then(
      () => setRemoteAudio('playing'),
      () => setRemoteAudio('autoplay-blocked'),
    );
  }, []);

  const enableAudioManually = useCallback(() => {
    audioRef.current?.play().then(
      () => setRemoteAudio('playing'),
      () => setRemoteAudio('autoplay-blocked'),
    );
  }, []);

  // 接続成立後に 1 度だけ response.create を送り、AI 面接官の挨拶〜1問目を起動する。
  const maybeSendInitial = useCallback(() => {
    if (sentInitialRef.current) return;
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') return;
    try {
      dc.send(JSON.stringify({ type: 'response.create' }));
      sentInitialRef.current = true;
    } catch {
      /* 送信失敗は致命ではない（VAD でユーザー発話起点でも会話は始まる） */
    }
  }, []);

  // transcript を interview_ai_turns に逐次保存（fire-and-forget。失敗は会話を止めない）。
  // 音声は送らない（transcript テキストのみ）。AI 発話=question / ユーザー発話=answer。
  const saveTurn = useCallback((role: 'question' | 'answer', content: string) => {
    const sessionId = sessionIdRef.current;
    const text = content.trim();
    if (!sessionId || !text) return;
    const p = fetch('/api/interview-ai/realtime/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, role, content: text }),
    }).catch(() => {
      /* 保存失敗は会話を止めない（次ターンで継続） */
    });
    // complete 前に「保存中の最後のターン」を取りこぼさないよう追跡する。
    pendingSavesRef.current.push(p);
    void p.finally(() => {
      pendingSavesRef.current = pendingSavesRef.current.filter((x) => x !== p);
    });
  }, []);

  // oai-events を取り込む（STEP4: transcript / 進捗の表示, STEP5: 確定発話を turn 保存。課金は STEP7）。
  const handleEvent = useCallback(
    (raw: string) => {
      const ev = parseRealtimeEvent(raw);
      switch (ev.kind) {
        case 'assistant-delta':
          assistantBufferRef.current += ev.text;
          setTranscripts((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'ai' && !last.final) {
              const copy = prev.slice();
              copy[copy.length - 1] = { ...last, text: last.text + ev.text };
              return copy;
            }
            return [...prev, { role: 'ai', text: ev.text, final: false }];
          });
          break;
        case 'assistant-done': {
          const finalText = ev.text ?? assistantBufferRef.current;
          assistantBufferRef.current = '';
          setTranscripts((prev) => {
            for (let i = prev.length - 1; i >= 0; i -= 1) {
              if (prev[i].role === 'ai' && !prev[i].final) {
                const copy = prev.slice();
                copy[i] = { ...copy[i], final: true, text: finalText || copy[i].text };
                return copy;
              }
            }
            return finalText
              ? [...prev, { role: 'ai', text: finalText, final: true }]
              : prev;
          });
          saveTurn('question', finalText);
          break;
        }
        case 'user-final':
          setTranscripts((prev) => [
            ...prev,
            { role: 'user', text: ev.text, final: true },
          ]);
          saveTurn('answer', ev.text);
          break;
        case 'question-complete':
          setCompletedQuestions((n) => {
            const next = ev.questionNumber ?? n + 1;
            return Math.min(Math.max(next, n), INTERVIEW_AI_MAX_ANSWER_TURNS);
          });
          break;
        default:
          break;
      }
    },
    [saveTurn],
  );

  const start = useCallback(async () => {
    if (startingRef.current) return;
    if (phaseRef.current === 'connecting' || phaseRef.current === 'connected') return;
    if (!isWebrtcSupported()) {
      fail('unsupported');
      return;
    }
    startingRef.current = true;
    sentInitialRef.current = false;
    sessionIdRef.current = null;
    assistantBufferRef.current = '';
    setErrorKind(null);
    setEndedReason(null);
    setEventsReceived(0);
    setTranscripts([]);
    setCompletedQuestions(0);
    setResult(null);
    setStaleSessionId(null);
    pendingSavesRef.current = [];

    // 1. token 取得（quota は既存 useQuotaDialog で処理）。
    setPhaseSafe('requesting-token');
    let res: Response;
    try {
      res = await fetch('/api/interview-ai/realtime/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interviewType: 'free' }),
      });
    } catch {
      startingRef.current = false;
      fail('token-failed');
      return;
    }
    // 402 quota-exceeded → 既存ダイアログ表示して idle に戻す。
    if (await handleResponse(res)) {
      startingRef.current = false;
      setPhaseSafe('idle');
      return;
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status !== 201) {
      startingRef.current = false;
      if (res.status === 401) return fail('unauthenticated');
      if (body.error === 'realtime-disabled') return fail('realtime-disabled');
      if (body.error === 'not-allowlisted') return fail('not-allowlisted');
      if (body.error === 'in-progress-exists') {
        const s = body.session as { id?: string } | undefined;
        if (s?.id) setStaleSessionId(s.id);
        return fail('in-progress-exists');
      }
      return fail('token-failed');
    }
    const clientSecret = String(body.clientSecret ?? '');
    const callUrl = String(body.callUrl ?? '');
    const sessionId = String(body.sessionId ?? '');
    const maxDurationMs =
      typeof body.maxDurationMs === 'number' ? body.maxDurationMs : 12 * 60 * 1000;
    if (!clientSecret || !callUrl || !sessionId) {
      startingRef.current = false;
      return fail('token-failed');
    }
    sessionIdRef.current = sessionId;

    // 2. マイク許可（SDP の前に取得 → 送出 track を確保）。
    setPhaseSafe('requesting-mic');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      startingRef.current = false;
      const name = (err as { name?: string })?.name ?? '';
      setMicPermission('denied');
      if (name === 'NotAllowedError' || name === 'SecurityError') return fail('mic-denied');
      return fail('mic-unavailable');
    }
    streamRef.current = stream;
    setMicPermission('granted');

    // 3. 接続（PC + dc + SDP 交換）。
    setPhaseSafe('connecting');
    setPcState('new');
    setIceState('new');
    let conn: RealtimeConnection;
    try {
      conn = await openRealtimeConnection({
        clientSecret,
        callUrl,
        stream,
        onRemoteTrack: attachRemote,
        onDataChannelOpen: () => {
          dcOpenRef.current = true;
          setDcOpen(true);
          evaluateConnected(maxDurationMs);
          maybeSendInitial();
        },
        onDataChannelClose: () => {
          dcOpenRef.current = false;
          setDcOpen(false);
        },
        onDataChannelMessage: (raw) => {
          setEventsReceived((n) => n + 1);
          handleEvent(raw);
        },
        onConnectionStateChange: (s) => {
          pcStateRef.current = s;
          setPcState(s);
          if (s === 'failed') {
            fail('connect-failed');
            return;
          }
          if (s === 'disconnected' && phaseRef.current === 'connected') {
            teardown('ended', 'disconnected');
            return;
          }
          evaluateConnected(maxDurationMs);
        },
        onIceStateChange: (s) => setIceState(s),
      });
    } catch {
      startingRef.current = false;
      return fail('connect-failed');
    }
    pcRef.current = conn.pc;
    dcRef.current = conn.dc;
    startingRef.current = false;
    // dc が return 前に既に open していた場合の取りこぼし防止。
    maybeSendInitial();

    // 一定時間 connected に到達しなければ失敗扱い。
    connectTimerRef.current = setTimeout(() => {
      if (phaseRef.current !== 'connected') fail('connect-failed');
    }, CONNECT_TIMEOUT_MS);
  }, [
    attachRemote,
    evaluateConnected,
    fail,
    handleEvent,
    handleResponse,
    maybeSendInitial,
    setPhaseSafe,
    teardown,
  ]);

  // 既存 /api/interview-ai/abandon で session を abandoned にし、one-in-progress 枠を解放する。
  const abandonSession = useCallback(async (id: string) => {
    try {
      await fetch('/api/interview-ai/abandon', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: id }),
      });
    } catch {
      /* best-effort（次回の in-progress-exists 復旧で回収可能） */
    }
  }, []);

  // 中断: 接続を閉じ、DB session も abandoned にして詰まりを残さない。
  const endSession = useCallback(() => {
    const sid = sessionIdRef.current;
    setPhaseSafe('closing');
    if (sid) void abandonSession(sid);
    teardown('ended', 'user');
  }, [abandonSession, setPhaseSafe, teardown]);

  // in-progress-exists 復旧: 残存 session を abandoned にしてから新規開始する。
  const recoverAndStart = useCallback(async () => {
    const id = staleSessionId;
    setStaleSessionId(null);
    if (id) await abandonSession(id);
    void start();
  }, [abandonSession, staleSessionId, start]);

  // 面接を終えて結果を見る: 接続を閉じ、保存中の turn を待ってから既存 complete を呼ぶ。
  // 既存 /api/interview-ai/complete をそのまま再利用（realtime session でも turns から生成可能）。
  const showResult = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    // 接続だけ閉じる（DB session は in_progress のまま。complete が completed にする）。
    closeConnection();
    setPhaseSafe('completing');
    // 直近の turn 保存（fire-and-forget）が complete の listTurns に間に合うよう待つ。
    try {
      await Promise.allSettled(pendingSavesRef.current);
    } catch {
      /* noop */
    }
    let res: Response;
    try {
      res = await fetch('/api/interview-ai/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      setErrorKind('complete-failed');
      setPhaseSafe('error');
      return;
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && body.status === 'completed') {
      const feedback = (body.feedback ?? {}) as Record<string, unknown>;
      setResult({
        overall:
          typeof feedback.overallEvaluation === 'string'
            ? feedback.overallEvaluation
            : '',
        strengths: Array.isArray(body.strengths) ? (body.strengths as string[]) : [],
        improvements: Array.isArray(body.improvements)
          ? (body.improvements as string[])
          : [],
        nextPractice: Array.isArray(body.nextPractice)
          ? (body.nextPractice as string[])
          : [],
      });
      setPhaseSafe('result');
    } else {
      // 失敗時は session を in_progress のまま残す（再試行可能）。
      setErrorKind('complete-failed');
      setPhaseSafe('error');
    }
  }, [closeConnection, setPhaseSafe]);

  // unmount / ページ離脱（タブ閉じ・リロード）でも teardown（マイク確実解放）。
  useEffect(() => {
    const onPageHide = () => teardown('ended', 'pagehide');
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      teardown('ended', 'unmount');
    };
    // teardown は冪等。マウント時 1 回だけ登録する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!enabled) {
    return (
      <Card padding="md">
        <p className="text-sm text-slate-600">
          リアルタイム音声面接は現在ご利用いただけません。
        </p>
      </Card>
    );
  }

  const connecting =
    phase === 'requesting-token' ||
    phase === 'requesting-mic' ||
    phase === 'connecting';

  return (
    <div className="space-y-4">
      <Card padding="md">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-800">接続状態</p>
            <p className="text-xs text-slate-500 mt-0.5">{phaseLabel(phase)}</p>
          </div>
          <div className="flex gap-2">
            {(phase === 'idle' ||
              phase === 'ended' ||
              phase === 'error' ||
              phase === 'result') && (
              <Button onClick={start}>
                {phase === 'idle' ? '面接を始める' : 'もう一度面接する'}
              </Button>
            )}
            {phase === 'connected' && (
              <Button onClick={showResult}>面接を終えて結果を見る</Button>
            )}
            {(connecting || phase === 'connected') && (
              <Button variant="secondary" onClick={endSession}>
                中断する
              </Button>
            )}
          </div>
        </div>

        {/* 接続サブステータス（可観測性） */}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
          <Stat label="フェーズ" value={phase} />
          <Stat label="マイク許可" value={micPermission} />
          <Stat label="PC 状態" value={pcState} />
          <Stat label="ICE 状態" value={iceState} />
          <Stat label="data channel" value={dcOpen ? 'open' : 'closed'} />
          <Stat label="AI 音声" value={remoteAudio} />
          <Stat label="受信イベント数" value={String(eventsReceived)} />
        </dl>

        {phase === 'connected' && (
          <p className="mt-3 text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">
            接続できました。AI面接官と音声で会話できます。
          </p>
        )}

        {remoteAudio === 'autoplay-blocked' && (
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={enableAudioManually}>
              🔊 音声を有効化
            </Button>
          </div>
        )}

        {phase === 'connected' && completedQuestions >= INTERVIEW_AI_MAX_ANSWER_TURNS && (
          <p className="mt-3 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
            主要質問が一通り終わりました。「面接を終えて結果を見る」で講評を生成できます。
          </p>
        )}

        {phase === 'completing' && (
          <p className="mt-3 text-sm text-slate-600">結果を生成しています…</p>
        )}

        {phase === 'ended' && (
          <p className="mt-3 text-sm text-slate-600">
            面接を{endedReason === 'maxduration' ? '終了しました（時間上限に達しました）' : '中断しました'}。
          </p>
        )}

        {phase === 'error' && errorKind && (
          <p className="mt-3 text-sm text-rose-700 bg-rose-50 px-3 py-2 rounded-lg">
            {ERROR_TEXT[errorKind]}
          </p>
        )}

        {phase === 'error' && errorKind === 'in-progress-exists' && staleSessionId && (
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={recoverAndStart}>
              前回の面接を中断して新しく始める
            </Button>
          </div>
        )}
      </Card>

      {/* 結果（既存 complete route の出力を表示） */}
      {phase === 'result' && result && (
        <Card padding="md">
          <p className="text-sm font-bold text-slate-800 mb-2">面接フィードバック</p>
          {result.overall && (
            <p className="text-sm text-slate-700 leading-relaxed mb-3">{result.overall}</p>
          )}
          <ResultList title="良かった点" items={result.strengths} />
          <ResultList title="改善点" items={result.improvements} />
          <ResultList title="次の練習" items={result.nextPractice} />
        </Card>
      )}

      {/* 文字起こし（live transcript）。STEP4 は表示のみ。保存は STEP5。 */}
      {(transcripts.length > 0 || phase === 'connected') && (
        <Card padding="md">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-sm font-bold text-slate-800">会話の文字起こし</p>
            <p className="text-xs text-slate-500">
              主要質問 {completedQuestions} / {INTERVIEW_AI_MAX_ANSWER_TURNS}
            </p>
          </div>
          {transcripts.length === 0 ? (
            <p className="text-xs text-slate-400">
              話し始めると、ここに文字起こしが表示されます。
            </p>
          ) : (
            <ul className="space-y-2">
              {transcripts.map((t, i) => (
                <li key={i} className="text-sm">
                  <span
                    className={
                      t.role === 'ai'
                        ? 'font-semibold text-brand-700'
                        : 'font-semibold text-slate-700'
                    }
                  >
                    {t.role === 'ai' ? 'AI面接官' : 'あなた'}：
                  </span>
                  <span className="text-slate-700">
                    {t.text}
                    {!t.final && <span className="text-slate-400">…</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* リモート音声の出力先（保存しない / srcObject のみ） */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {dialog}
    </div>
  );
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-bold text-slate-500 mb-1">{title}</p>
      <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-mono text-slate-700">{value}</dd>
    </div>
  );
}

function phaseLabel(phase: ConnPhase): string {
  switch (phase) {
    case 'idle':
      return '待機中';
    case 'requesting-token':
      return '接続準備中…';
    case 'requesting-mic':
      return 'マイクの許可を待っています…';
    case 'connecting':
      return '接続中…';
    case 'connected':
      return '接続済み';
    case 'closing':
      return '終了処理中…';
    case 'completing':
      return '結果生成中…';
    case 'result':
      return '結果';
    case 'ended':
      return '終了';
    case 'error':
      return 'エラー';
  }
}
