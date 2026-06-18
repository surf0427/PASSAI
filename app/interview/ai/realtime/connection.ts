'use client';

/**
 * STEP-INTERVIEW-AI-REALTIME-PR2: WebRTC 接続の純ロジック（React 非依存）。
 *
 * 役割（STEP2 のみ）:
 *   - RTCPeerConnection を作る
 *   - マイク track を送出に追加する
 *   - data channel 'oai-events' を作る（STEP2 は購読のみ。面接ロジックは STEP3+）
 *   - SDP offer を作り、ephemeral token で callUrl(application/sdp) に POST → answer を適用する
 *
 * やらないこと（STEP2 スコープ外）:
 *   - transcript 取得 / turn 保存 / 課金 / complete / instructions・tool 制御。
 *   - 音声の保存（音声はブラウザ↔OpenAI 間のみ。サーバ・DB に渡さない）。
 *
 * server-only モジュールは import しない（client 安全）。秘匿値（clientSecret / SDP）はログに出さない。
 */

export type RealtimeConnection = {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
};

export type OpenRealtimeArgs = {
  clientSecret: string;
  callUrl: string;
  /** マイク stream（呼び出し側が getUserMedia 済み。track は呼び出し側が stop 管理する）。 */
  stream: MediaStream;
  onRemoteTrack: (stream: MediaStream) => void;
  onDataChannelOpen: () => void;
  onDataChannelClose: () => void;
  /** STEP2 では受信したことだけ使う（パースしない）。STEP3+ で event 処理を載せる土台。 */
  onDataChannelMessage: (raw: string) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onIceStateChange: (state: RTCIceConnectionState) => void;
};

/** ブラウザが WebRTC + マイク取得に対応しているか。 */
export function isWebrtcSupported(): boolean {
  return (
    typeof RTCPeerConnection !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/**
 * WebRTC 接続を確立する。成功で { pc, dc } を返す（dc.open は onDataChannelOpen で通知）。
 * SDP 交換に失敗したら pc を閉じて throw する（呼び出し側で teardown / error 表示）。
 */
export async function openRealtimeConnection(
  args: OpenRealtimeArgs,
): Promise<RealtimeConnection> {
  const pc = new RTCPeerConnection();

  pc.addEventListener('connectionstatechange', () => {
    args.onConnectionStateChange(pc.connectionState);
  });
  pc.addEventListener('iceconnectionstatechange', () => {
    args.onIceStateChange(pc.iceConnectionState);
  });
  pc.addEventListener('track', (e: RTCTrackEvent) => {
    if (e.streams && e.streams[0]) args.onRemoteTrack(e.streams[0]);
  });

  // マイク track を送出に追加（許可済み stream を呼び出し側から受け取る）。
  for (const track of args.stream.getAudioTracks()) {
    pc.addTrack(track, args.stream);
  }

  // 'oai-events' data channel（OpenAI Realtime のイベント用、固定名）。
  const dc = pc.createDataChannel('oai-events');
  dc.addEventListener('open', args.onDataChannelOpen);
  dc.addEventListener('close', args.onDataChannelClose);
  dc.addEventListener('message', (e: MessageEvent) => {
    args.onDataChannelMessage(typeof e.data === 'string' ? e.data : '');
  });

  // offer 作成 → setLocalDescription → そのまま SDP を送る（OpenAI は非 trickle 受理）。
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  let res: Response;
  try {
    res = await fetch(args.callUrl, {
      method: 'POST',
      body: pc.localDescription?.sdp ?? offer.sdp ?? '',
      headers: {
        Authorization: `Bearer ${args.clientSecret}`,
        'Content-Type': 'application/sdp',
      },
    });
  } catch {
    pc.close();
    throw new Error('sdp-exchange-failed');
  }

  if (!res.ok) {
    pc.close();
    throw new Error('sdp-exchange-failed');
  }

  const answerSdp = await res.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

  return { pc, dc };
}
