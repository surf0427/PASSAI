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
  | 'connect-failed';

type RemoteAudio = 'none' | 'playing' | 'autoplay-blocked';

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

  // 接続リソース（render に依存しない可変参照）。
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startingRef = useRef(false); // 多重 start 防止
  const sentInitialRef = useRef(false); // 初回 response.create の二重送信防止
  // connected 判定用の最新値（state は非同期のため ref で確実に評価）。
  const pcStateRef = useRef<RTCPeerConnectionState>('new');
  const dcOpenRef = useRef(false);
  const phaseRef = useRef<ConnPhase>('idle');

  const setPhaseSafe = useCallback((p: ConnPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  // ── teardown（全終了経路で冪等に呼ぶ。マイクを確実に解放する） ──────────────
  const teardown = useCallback(
    (next: 'ended' | 'error', reason?: string) => {
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
      if (reason) setEndedReason(reason);
      setPhaseSafe(next);
    },
    [setPhaseSafe],
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

  // oai-events を UI 表示用に取り込む（STEP4: transcript と主要質問の進捗のみ。保存・課金は STEP5+）。
  const handleEvent = useCallback((raw: string) => {
    const ev = parseRealtimeEvent(raw);
    switch (ev.kind) {
      case 'assistant-delta':
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
      case 'assistant-done':
        setTranscripts((prev) => {
          for (let i = prev.length - 1; i >= 0; i -= 1) {
            if (prev[i].role === 'ai' && !prev[i].final) {
              const copy = prev.slice();
              copy[i] = { ...copy[i], final: true, text: ev.text ?? copy[i].text };
              return copy;
            }
          }
          return ev.text
            ? [...prev, { role: 'ai', text: ev.text, final: true }]
            : prev;
        });
        break;
      case 'user-final':
        setTranscripts((prev) => [
          ...prev,
          { role: 'user', text: ev.text, final: true },
        ]);
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
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    if (phaseRef.current === 'connecting' || phaseRef.current === 'connected') return;
    if (!isWebrtcSupported()) {
      fail('unsupported');
      return;
    }
    startingRef.current = true;
    sentInitialRef.current = false;
    setErrorKind(null);
    setEndedReason(null);
    setEventsReceived(0);
    setTranscripts([]);
    setCompletedQuestions(0);

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
      if (body.error === 'in-progress-exists') return fail('in-progress-exists');
      return fail('token-failed');
    }
    const clientSecret = String(body.clientSecret ?? '');
    const callUrl = String(body.callUrl ?? '');
    const maxDurationMs =
      typeof body.maxDurationMs === 'number' ? body.maxDurationMs : 12 * 60 * 1000;
    if (!clientSecret || !callUrl) {
      startingRef.current = false;
      return fail('token-failed');
    }

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

  const endSession = useCallback(() => {
    setPhaseSafe('closing');
    teardown('ended', 'user');
  }, [setPhaseSafe, teardown]);

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
            {(phase === 'idle' || phase === 'ended' || phase === 'error') && (
              <Button onClick={start}>面接を始める</Button>
            )}
            {(connecting || phase === 'connected') && (
              <Button variant="secondary" onClick={endSession}>
                終了する
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

        {phase === 'ended' && (
          <p className="mt-3 text-sm text-slate-600">
            面接を終了しました{endedReason === 'maxduration' ? '（時間上限に達しました）' : ''}。
          </p>
        )}

        {phase === 'error' && errorKind && (
          <p className="mt-3 text-sm text-rose-700 bg-rose-50 px-3 py-2 rounded-lg">
            {ERROR_TEXT[errorKind]}
          </p>
        )}
      </Card>

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
    case 'ended':
      return '終了';
    case 'error':
      return 'エラー';
  }
}
