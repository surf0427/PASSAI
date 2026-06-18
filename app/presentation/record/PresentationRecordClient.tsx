'use client';

// プレゼン録画 UI。録画 → 「次へ進む」で Storage upload → /attempt → /transcribe → /evaluate
// → /presentation/result へ遷移まで接続済み。
//
// 設計（docs/presentation/pr0_design.md §7 / §11 / §12）:
//   - MediaRecorder。mimeType は isTypeSupported() でランタイム判定（MVP は Chrome 優先）。
//   - 録画と同時に「音声のみ blob」も二重録音し、transcribe へ送る（動画は Storage、音声は
//     Whisper。サーバ ffmpeg 不採用）。
//   - 録り直し / unmount で MediaStream track を stop（カメラランプを残さない）。
//   - 資料（任意）が session に登録済みなら signed URL を取得し、左=資料 / 右=カメラの 2 カラム表示。

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useCurrentUserId } from '@/app/components/AuthProvider';
import { getBrowserSupabaseClient } from '@/lib/supabase/browserClient';
import { PRESENTATION_MATERIAL_BUCKET } from '@/lib/presentation/material';
import { MaterialPdfViewer } from './MaterialPdfViewer';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';

import { PresentationPremiumGate } from '../PresentationPremiumGate';

type Status = 'idle' | 'ready' | 'recording' | 'recorded' | 'error';

const STORAGE_BUCKET = 'presentation-recordings';

// 動画 MIME（base）→ Storage パス拡張子。API（/attempt）の許可セットと一致させる。
const VIDEO_MIME_EXT: Record<string, string> = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

function baseMime(type: string): string {
  return (type || '').split(';')[0].trim().toLowerCase();
}

const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];
const AUDIO_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

const DEFAULT_LIMIT_SEC = 300;

function pickMime(candidates: string[]): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

function formatTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function PresentationRecordClient() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId') ?? '';
  const limitSec = (() => {
    const raw = Number(searchParams.get('limit'));
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_LIMIT_SEC;
  })();

  const router = useRouter();
  const userId = useCurrentUserId();

  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(limitSec);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [durationSec, setDurationSec] = useState(0);

  // 発表資料（任意）。session に登録済みなら signed URL を取得して表示する。
  const [materialUrl, setMaterialUrl] = useState<string | null>(null);
  const [materialMime, setMaterialMime] = useState<string | null>(null);

  // 「次へ進む」処理中の状態（段階表示 / エラー / 完了後の遷移ガード）。
  const [submitting, setSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const startedAtRef = useRef<number>(0);
  // 同一録画（同一 attempt_id）内の再試行で各ステップを冪等に再開するためのフラグ。
  const attemptIdRef = useRef<string | null>(null);
  const uploadedRef = useRef(false);
  const attemptRegisteredRef = useRef(false);
  const transcribedRef = useRef(false);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<BlobPart[]>([]);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const livePreviewRef = useRef<HTMLVideoElement | null>(null);
  const recordedUrlRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopStreamTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const revokeRecordedUrl = useCallback(() => {
    if (recordedUrlRef.current) {
      URL.revokeObjectURL(recordedUrlRef.current);
      recordedUrlRef.current = null;
    }
  }, []);

  // カメラ・マイク取得（idle/error → ready）。
  const startCamera = useCallback(async () => {
    setErrorMsg(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setErrorMsg('お使いのブラウザはカメラ録画に対応していません（Chrome 推奨）。');
      return;
    }
    if (pickMime(VIDEO_MIME_CANDIDATES) === null) {
      setStatus('error');
      setErrorMsg('お使いのブラウザは録画（MediaRecorder）に対応していません（Chrome 推奨）。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      streamRef.current = stream;
      setStatus('ready');
    } catch {
      setStatus('error');
      setErrorMsg('カメラ／マイクの使用が許可されませんでした。ブラウザの権限設定をご確認ください。');
    }
  }, []);

  // 録画停止（recording → recorded）。recorder.onstop が blob を組み立てる。
  const stopRecordingInternal = useCallback(() => {
    clearTimer();
    const v = videoRecorderRef.current;
    const a = audioRecorderRef.current;
    try {
      if (a && a.state !== 'inactive') a.stop();
    } catch {
      // ignore
    }
    try {
      if (v && v.state !== 'inactive') v.stop();
    } catch {
      // ignore
    }
  }, [clearTimer]);

  // 録画開始（ready → recording）。動画＋音声を二重録音する。
  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const videoMime = pickMime(VIDEO_MIME_CANDIDATES);
    if (!videoMime) {
      setStatus('error');
      setErrorMsg('お使いのブラウザは録画に対応していません（Chrome 推奨）。');
      return;
    }

    videoChunksRef.current = [];
    audioChunksRef.current = [];
    setVideoBlob(null);
    setAudioBlob(null);
    revokeRecordedUrl();
    setRecordedUrl(null);
    // 新しい録画 = 新しい attempt。アップロード/送信フラグをリセット。
    attemptIdRef.current = null;
    uploadedRef.current = false;
    attemptRegisteredRef.current = false;
    transcribedRef.current = false;
    setSubmitError(null);
    setSubmitPhase(null);
    startedAtRef.current = Date.now();

    let videoRecorder: MediaRecorder;
    try {
      videoRecorder = new MediaRecorder(stream, { mimeType: videoMime });
    } catch {
      setStatus('error');
      setErrorMsg('録画の初期化に失敗しました（Chrome 推奨）。');
      return;
    }
    videoRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) videoChunksRef.current.push(e.data);
    };
    videoRecorder.onstop = () => {
      const blob = new Blob(videoChunksRef.current, { type: videoMime });
      if (blob.size === 0) {
        setStatus('error');
        setErrorMsg('録画データが空でした。もう一度お試しください。');
        return;
      }
      setVideoBlob(blob);
      const elapsed = Math.max(
        1,
        Math.round((Date.now() - startedAtRef.current) / 1000),
      );
      setDurationSec(elapsed);
      const url = URL.createObjectURL(blob);
      recordedUrlRef.current = url;
      setRecordedUrl(url);
      setStatus('recorded');
    };
    videoRecorderRef.current = videoRecorder;

    // 音声のみ blob（将来 transcribe 用）。動画コンテナにも音声は含まれるが、Whisper に
    // 小さく送れるよう audio track だけの blob を別取りする。失敗しても録画は継続。
    const audioMime = pickMime(AUDIO_MIME_CANDIDATES);
    const audioTracks = stream.getAudioTracks();
    if (audioMime && audioTracks.length > 0) {
      try {
        const audioStream = new MediaStream(audioTracks);
        const audioRecorder = new MediaRecorder(audioStream, { mimeType: audioMime });
        audioRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        audioRecorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: audioMime });
          if (blob.size > 0) setAudioBlob(blob);
        };
        audioRecorderRef.current = audioRecorder;
        audioRecorder.start();
      } catch {
        audioRecorderRef.current = null;
      }
    }

    videoRecorder.start();
    setStatus('recording');
    setRemaining(limitSec);
    clearTimer();
    timerRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          // 制限時間に到達 → 自動停止。
          stopRecordingInternal();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [limitSec, clearTimer, revokeRecordedUrl, stopRecordingInternal]);

  // 録り直し: 現在の track/recorder を止め、blob を破棄してカメラを取り直す。
  const handleRetake = useCallback(() => {
    clearTimer();
    stopRecordingInternal();
    stopStreamTracks();
    revokeRecordedUrl();
    setRecordedUrl(null);
    setVideoBlob(null);
    setAudioBlob(null);
    setRemaining(limitSec);
    setStatus('idle');
    void startCamera();
  }, [
    clearTimer,
    stopRecordingInternal,
    stopStreamTracks,
    revokeRecordedUrl,
    limitSec,
    startCamera,
  ]);

  // 「次へ進む」: Storage upload → attempt 登録 → transcribe → evaluate → result へ遷移。
  // 同一録画の再試行では attemptId と各フラグを保持し、完了済みステップはスキップする
  //（録り直し上限 3 を無駄に消費しない）。
  const handleProceed = useCallback(async () => {
    setSubmitError(null);

    // 前提チェック
    if (!userId) {
      setSubmitError('ログイン情報を取得できませんでした。再度ログインしてください。');
      return;
    }
    if (!videoBlob) {
      setSubmitError('録画データがありません。録り直してください。');
      return;
    }
    if (!audioBlob) {
      // MVP: 音声 blob が無ければ文字起こしできない（動画からのサーバ抽出はしない）。
      setSubmitError('音声を取得できませんでした。お手数ですが録り直してください。');
      return;
    }
    const vMime = baseMime(videoBlob.type);
    const ext = VIDEO_MIME_EXT[vMime];
    if (!ext) {
      setSubmitError('この録画形式には対応していません（Chrome 推奨）。');
      return;
    }

    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setSubmitError('ストレージに接続できませんでした。時間をおいて再度お試しください。');
      return;
    }

    if (!attemptIdRef.current) attemptIdRef.current = crypto.randomUUID();
    const attemptId = attemptIdRef.current;
    const storagePath = `${userId}/${sessionId}/${attemptId}.${ext}`;

    setSubmitting(true);
    try {
      // 1. 動画を Storage にアップロード（upsert:false。重複は既存扱いで継続）。
      if (!uploadedRef.current) {
        setSubmitPhase('動画を保存しています…');
        const { error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, videoBlob, { upsert: false, contentType: vMime });
        if (error) {
          const dup =
            // 同一 path が既にある = 実質アップロード済み（冪等扱い）。
            (error as { statusCode?: string }).statusCode === '409' ||
            /exist/i.test(error.message ?? '');
          if (!dup) {
            setSubmitError('動画の保存に失敗しました。通信環境をご確認のうえ再度お試しください。');
            return;
          }
        }
        uploadedRef.current = true;
      }

      // 2. attempt 登録（storage_path は送らない。server が正準生成）。
      if (!attemptRegisteredRef.current) {
        setSubmitPhase('録画情報を登録しています…');
        const res = await fetch('/api/presentation/attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            attempt_id: attemptId,
            video_mime_type: vMime,
            video_size_bytes: videoBlob.size,
            duration_sec: durationSec,
          }),
        });
        if (!res.ok) {
          if (res.status === 409) {
            setSubmitError('録り直しの上限に達しました。新しいセッションで再度お試しください。');
          } else {
            setSubmitError('録画情報の登録に失敗しました。再度お試しください。');
          }
          return;
        }
        attemptRegisteredRef.current = true;
      }

      // 3. 文字起こし（音声 blob を multipart 送信）。
      if (!transcribedRef.current) {
        setSubmitPhase('文字起こししています…');
        const form = new FormData();
        form.append('attempt_id', attemptId);
        form.append('audio_file', audioBlob, `audio.${ext}`);
        form.append('audio_mime_type', audioBlob.type || 'audio/webm');
        form.append('duration_sec', String(durationSec));
        const res = await fetch('/api/presentation/transcribe', {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          setSubmitError(
            '文字起こしに失敗しました。再度お試しいただくか、録り直してください。',
          );
          return;
        }
        transcribedRef.current = true;
      }

      // 4. AI 評価（課金消費は evaluate route 内で発生。画面側は usage を触らない）。
      setSubmitPhase('AI評価を作成しています…');
      const res = await fetch('/api/presentation/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempt_id: attemptId }),
      });
      if (!res.ok) {
        if (res.status === 402) {
          setSubmitError(
            'プレゼン機能は Premium 限定です（または今月の利用上限に達しています）。プランをご確認ください。',
          );
        } else {
          setSubmitError('AI評価の作成に失敗しました。少し時間をおいて再度お試しください。');
        }
        return;
      }

      // 5. 完了 → result へ遷移。
      setSubmitPhase('完了しました。結果へ移動します…');
      router.push(`/presentation/result?attemptId=${encodeURIComponent(attemptId)}`);
    } catch {
      setSubmitError('通信エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setSubmitting(false);
      setSubmitPhase(null);
    }
  }, [userId, videoBlob, audioBlob, sessionId, durationSec, router]);

  // unmount 時のクリーンアップ（track stop / timer / URL）。カメラ取得はユーザー操作で行う
  // （effect 内での setState 連鎖を避ける）。
  useEffect(() => {
    return () => {
      clearTimer();
      stopStreamTracks();
      revokeRecordedUrl();
    };
  }, [clearTimer, stopStreamTracks, revokeRecordedUrl]);

  // live preview に stream を接続。
  useEffect(() => {
    if (
      (status === 'ready' || status === 'recording') &&
      livePreviewRef.current &&
      streamRef.current
    ) {
      livePreviewRef.current.srcObject = streamRef.current;
    }
  }, [status]);

  // 資料の signed URL を取得（session に material があれば。RLS owner で本人のみ）。
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    async function loadMaterial() {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) return;
      const { data: session } = await supabase
        .from('presentation_sessions')
        .select('material_path, material_mime_type')
        .eq('id', sessionId)
        .maybeSingle();
      if (cancelled || !session?.material_path) return;
      const { data: signed } = await supabase.storage
        .from(PRESENTATION_MATERIAL_BUCKET)
        .createSignedUrl(session.material_path as string, 600);
      if (cancelled || !signed?.signedUrl) return;
      setMaterialUrl(signed.signedUrl);
      setMaterialMime((session.material_mime_type as string) ?? null);
    }

    void loadMaterial();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // sessionId 不足 → 案内。
  if (!sessionId) {
    return (
      <Card padding="lg" className="space-y-4">
        <AlertBox variant="error">
          セッションが指定されていません。テーマ設定からやり直してください。
        </AlertBox>
        <LinkButton href="/presentation/setup" variant="primary">
          テーマ設定へ戻る
        </LinkButton>
      </Card>
    );
  }

  return (
    <PresentationPremiumGate>
      <div className="space-y-4">
        <AlertBox variant="info">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>録画は後から見返せます。</li>
            <li>AI評価は録画後に行います。</li>
            <li>発表中に AI が口を挟むことはありません。</li>
          </ul>
        </AlertBox>

        <Card padding="lg" className="space-y-4">
          {/* 制限時間 / 残り時間 */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">
              制限時間: <strong>{formatTime(limitSec)}</strong>
            </span>
            <span
              className={
                status === 'recording'
                  ? 'font-bold text-red-600'
                  : 'text-slate-600'
              }
            >
              残り: {formatTime(status === 'recording' ? remaining : limitSec)}
            </span>
          </div>

          {/* プレビュー / 再生（資料があれば 2 カラム: 左=資料 / 右=カメラ） */}
          <div
            className={
              materialUrl ? 'grid gap-3 lg:grid-cols-2' : ''
            }
          >
            {materialUrl && materialMime && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-500">発表資料</p>
                <MaterialViewer url={materialUrl} mime={materialMime} />
              </div>
            )}
            <div className={materialUrl ? 'space-y-1' : ''}>
              {materialUrl && (
                <p className="text-xs font-semibold text-slate-500">カメラ映像</p>
              )}
              <div className="overflow-hidden rounded-lg bg-black aspect-video">
                {status === 'recorded' && recordedUrl ? (
                  <video
                    key="playback"
                    src={recordedUrl}
                    controls
                    playsInline
                    className="h-full w-full"
                  />
                ) : (
                  <video
                    key="live"
                    ref={livePreviewRef}
                    autoPlay
                    muted
                    playsInline
                    className="h-full w-full"
                  />
                )}
              </div>
            </div>
          </div>

          {status === 'recording' && (
            <p className="flex items-center gap-2 text-sm font-medium text-red-600">
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
              録画中…
            </p>
          )}

          {errorMsg && <AlertBox variant="error">{errorMsg}</AlertBox>}

          {/* 操作ボタン */}
          <div className="flex flex-wrap gap-3">
            {status === 'idle' && (
              <Button variant="primary" onClick={() => void startCamera()}>
                カメラを開始
              </Button>
            )}

            {status === 'ready' && (
              <Button variant="primary" onClick={startRecording}>
                録画開始
              </Button>
            )}

            {status === 'recording' && (
              <Button variant="danger" onClick={stopRecordingInternal}>
                録画停止
              </Button>
            )}

            {status === 'recorded' && (
              <>
                <Button
                  variant="secondary"
                  onClick={handleRetake}
                  disabled={submitting}
                >
                  録り直す
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void handleProceed()}
                  disabled={submitting}
                >
                  {submitting ? '処理中…' : '次へ進む'}
                </Button>
              </>
            )}

            {status === 'error' && (
              <Button variant="primary" onClick={() => void startCamera()}>
                カメラを再試行
              </Button>
            )}
          </div>

          {status === 'recorded' && submitting && submitPhase && (
            <p className="flex items-center gap-2 text-sm font-medium text-indigo-700">
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-indigo-600" />
              {submitPhase}
            </p>
          )}

          {status === 'recorded' && submitError && (
            <AlertBox variant="error">{submitError}</AlertBox>
          )}

          {status === 'recorded' && !submitting && (
            <p className="text-xs text-slate-500">
              録画データを取得しました
              {videoBlob ? `（動画 ${Math.round(videoBlob.size / 1024)}KB` : '（動画 -'}
              {audioBlob ? ` / 音声 ${Math.round(audioBlob.size / 1024)}KB）` : ' / 音声 なし）'}
              。「次へ進む」で文字起こしと AI 評価を行います。
            </p>
          )}
        </Card>
      </div>
    </PresentationPremiumGate>
  );
}

// 発表資料ビューア。
//   - PDF: pdf.js（MaterialPdfViewer）で canvas 描画。総ページ数 / ページ送り / 拡大縮小 / ページ番号入力。
//   - 画像（PNG/JPG/JPEG）: 従来どおり <img> をズーム表示（現状維持）。
// ページ送り履歴は保存しない（ローカル state のみ）。Storage / DB / AI / TTL には触れない。
function MaterialViewer({ url, mime }: { url: string; mime: string }) {
  const isPdf = mime === 'application/pdf';
  if (isPdf) {
    // key={url} で signed URL 更新時に再マウントし、state を初期化する。
    return <MaterialPdfViewer key={url} url={url} />;
  }
  return <MaterialImageViewer url={url} />;
}

// 画像資料ビューア（現状維持のズーム表示）。
function MaterialImageViewer({ url }: { url: string }) {
  const [zoom, setZoom] = useState(100);
  const dec = () => setZoom((z) => Math.max(50, z - 25));
  const inc = () => setZoom((z) => Math.min(300, z + 25));

  return (
    <div className="space-y-2">
      <div className="aspect-video overflow-auto rounded-lg border border-slate-200 bg-slate-100">
        <div className="flex h-full w-full items-start justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="発表資料"
            style={{ width: `${zoom}%` }}
            className="max-w-none"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={dec} disabled={zoom <= 50}>
          縮小
        </Button>
        <span className="text-xs text-slate-500">{zoom}%</span>
        <Button variant="secondary" size="sm" onClick={inc} disabled={zoom >= 300}>
          拡大
        </Button>
      </div>
    </div>
  );
}
