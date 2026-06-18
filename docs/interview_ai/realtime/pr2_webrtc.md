# PR2 (STEP2): WebRTC 接続のみ — 設計メモ

> STEP2 は「token を取り、ブラウザ↔OpenAI の WebRTC を確立し、接続状態を UI に出す」ところまで。
> **面接ロジック・transcript 取得・turn 保存・課金・complete 連携は含めない**（STEP3 以降）。
> 前提ルート契約は [pr1_token.md](./pr1_token.md)、設計監査は STEP0（会話）を正本とする。
> 本メモは設計のみ。コードはまだ追加しない。

## 0. 検証済み OpenAI WebRTC 事実（2026-06 / pr1 で確認）

- token: `POST /api/interview-ai/realtime/token` → `{ sessionId, clientSecret(ek_...), expiresAt, model, maxDurationMs, callUrl }`。
- SDP 交換: ブラウザが offer.sdp を `POST {callUrl}`（= `https://api.openai.com/v1/realtime/calls`）へ。
  - headers: `Authorization: Bearer {clientSecret}`, `Content-Type: application/sdp`。
  - レスポンス body = answer SDP（text）。`setRemoteDescription({ type:'answer', sdp })`。
- data channel 名は `oai-events`（JSON イベント送受信）。STEP2 では「open したか」だけ使う。
- token TTL=120s は**接続開始の猶予のみ**。接続後は最大 60 分（OpenAI）/ 自前 12 分（`maxDurationMs`）。

## 1. STEP2 スコープ

### やる
- `/interview/ai/realtime` ページ追加（client flag 配下。SSR は何も出さない）。
- `RealtimeInterviewClient.tsx`（`'use client'`）追加。
- token 取得 → `getUserMedia({audio:true})` → `RTCPeerConnection` 作成 → `oai-events` data channel 作成
  → offer 作成/`setLocalDescription` → `POST callUrl`（application/sdp）→ answer を `setRemoteDescription`。
- リモート音声トラックの再生（`<audio>` に attach、autoplay ブロックは手動再生に倒す）。
- 接続状態 / マイク許可 / data channel open / error を UI 表示。
- 明示終了ボタン（接続を teardown）。
- teardown の完全性（track stop / pc close / dc close / audio 解放）。

### やらない（STEP3 以降）
- AI 面接官プロンプト / 5 問アーク（mint 側は STEP3 で拡充。STEP2 は pr1 のベースライン instructions のまま）。
- transcript 取得・表示、turn 逐次保存、課金（最初の発話 CAS）、complete/result 連携、再開、abandon の DB 連携。
- 12 分タイマの「締め発話→自動終了」挙動（STEP2 は接続だけ。タイマ枠は §6 に置くが、発火時は単純 teardown）。

### 触らない
- 既存 `/interview/ai`、`InterviewAiClient.tsx`、`session/turn/complete/abandon` 各 route、課金・DB。

## 2. 追加予定ファイル（実装は STEP2 本実装で）

| ファイル | 役割 |
|---|---|
| `app/interview/ai/realtime/page.tsx` | flag 判定 + `<RealtimeInterviewClient/>` を載せるだけの薄い page。flag OFF（SSR/本番）は案内 or 404 相当。 |
| `app/interview/ai/realtime/RealtimeInterviewClient.tsx` | 接続ライフサイクル本体（§4・§5）。 |
| `app/interview/ai/realtime/connection.ts`（任意） | WebRTC 接続の純関数（token→PC→SDP）を React から分離。テスト容易性のため検討。 |

> 既存 [featureFlag.ts](../../lib/interviewAi/featureFlag.ts) と同様、表示は client flag、発行は server flag が最終。
> client flag は [lib/interviewAi/realtimeFeatureFlag.ts](../../lib/interviewAi/realtimeFeatureFlag.ts) の
> `isRealtimeInterviewEnabledClient()`（vercel.app Preview の `?realtime=1` 可 / passai.jp は無効）。

## 3. UI 状態設計（接続ライフサイクルの単一の真実）

### 3.1 メイン状態 `connPhase`

```
idle              … 開始前（「面接を始める」ボタン待ち）
requesting-token  … POST /token 中
requesting-mic    … getUserMedia 中（ブラウザのマイク許可ダイアログ）
connecting        … RTCPeerConnection 構築 + SDP 交換 + ICE + dc open 待ち
connected         … pc connected かつ dc open（会話可能。STEP2 はここまで到達が成功条件）
closing           … 明示終了 / タイマ / アンマウントで teardown 中
ended             … 正常終了（teardown 完了）
error             … 失敗（errorKind を併記、§3.2）
```

許可される遷移:
```
idle → requesting-token → requesting-mic → connecting → connected → closing → ended
（各段から error へ分岐可。connected/closing からは ended）
```
> マイク許可を SDP 前に取る理由: 許可が下りないと送る audio track が無く、接続しても無音になるため。
> getUserMedia を先に通し、トラック確保後に PC へ addTrack する。

### 3.2 `errorKind`（error 時の内訳と UI 文言の出し分け）

| errorKind | 起点 | UI 方針 |
|---|---|---|
| `unsupported` | `RTCPeerConnection`/`mediaDevices` 不在 | 「この環境では利用できません」+ ターン制 `/interview/ai` へ誘導 |
| `realtime-disabled` | /token 403 | 「現在この機能は無効です」（通常は flag で導線自体を隠すので保険） |
| `quota-exceeded` | /token 402 | 既存 `useQuotaDialog()` の dialog を再利用（feature='interview-ai-realtime'） |
| `not-allowlisted` | /token 403 | 「許可されたアカウントのみ利用できます」 |
| `in-progress-exists` | /token 200 | 「進行中の面接があります」。STEP2 は中断/再開導線は出さず案内のみ（DB 連携は STEP7） |
| `token-failed` | /token 502/500/network | 「接続準備に失敗しました」+ 再試行 |
| `mic-denied` | getUserMedia `NotAllowedError`/`SecurityError` | 「マイクの使用が許可されませんでした」+ 許可手順 + ターン制誘導 |
| `mic-unavailable` | `NotFoundError`/`NotReadableError` | 「マイクが見つかりません/使用中です」+ 再試行 |
| `connect-failed` | SDP POST 失敗 / ICE failed / dc が一定時間 open しない | 「接続に失敗しました」+ 再試行。session は STEP2 では放置（STEP7 で abandon 連携） |

### 3.3 補助ステータス（デバッグ/可観測性のため副表示）

- `micPermission`: `'prompt' | 'granted' | 'denied'`
- `pcState`: `RTCPeerConnectionState`（`new|connecting|connected|disconnected|failed|closed`）
- `iceState`: `RTCIceConnectionState`
- `dcState`: `'connecting' | 'open' | 'closing' | 'closed'`
- `remoteAudio`: `'none' | 'playing' | 'autoplay-blocked'`

> connected の判定は **pcState==='connected' かつ dcState==='open'** の AND。どちらか片方では会話不可。

## 4. 接続ライフサイクル（手順）

```
start():
  guard: 多重起動防止（connecting/connected 中は無視）
  connPhase = requesting-token
  res = POST /api/interview-ai/realtime/token  (credentials: same-origin)
    402 → useQuotaDialog で処理し error(quota-exceeded)
    200 in-progress-exists → error(in-progress-exists)
    403/500/502/throw → error(realtime-disabled|not-allowlisted|token-failed)
  { sessionId, clientSecret, callUrl, model, maxDurationMs } を保持

  connPhase = requesting-mic
  stream = await getUserMedia({ audio: true })   // 失敗 → error(mic-denied|mic-unavailable)

  connPhase = connecting
  pc = new RTCPeerConnection()                   // 必要なら { iceServers: [] }（OpenAI は STUN 不要想定。実装時確認）
  pc.addEventListener('connectionstatechange', …)  // pcState 反映。failed → error(connect-failed)
  pc.addEventListener('iceconnectionstatechange', …)
  pc.addEventListener('track', e => attach e.streams[0] to <audio>)  // リモート音声
  for (track of stream.getAudioTracks()) pc.addTrack(track, stream)  // マイク送出
  dc = pc.createDataChannel('oai-events')
  dc.onopen/onclose/onmessage → dcState 反映（STEP2 は message は購読するだけ/未処理）

  offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  // ICE は trickle ではなく、setLocalDescription 後の offer.sdp をそのまま送る簡易方式で可
  sdpRes = await fetch(callUrl, {
    method:'POST', body: pc.localDescription.sdp,
    headers:{ Authorization:`Bearer ${clientSecret}`, 'Content-Type':'application/sdp' }
  })                                              // !ok/throw → error(connect-failed)
  answer = await sdpRes.text()
  await pc.setRemoteDescription({ type:'answer', sdp: answer })

  // open 待ち（dc.onopen で connected に遷移）。一定時間（例 15s）open しなければ error(connect-failed)
  connectTimer = setTimeout(→ error(connect-failed), 15000)
  dc.onopen: clearTimeout; connPhase = connected; startMaxDurationTimer()
```

### リモート音声の再生
- `pc.ontrack` の `event.streams[0]` を `audioRef.current.srcObject` に設定。
- `<audio autoPlay playsInline>` を 1 つ用意。autoplay がブロックされたら `remoteAudio='autoplay-blocked'` にして
  「音声を有効化」ボタンで `audio.play()` を user gesture 下で実行。

## 5. teardown（最重要 / リーク防止）

`teardown(reason)` を **明示終了 / connect-failed / maxDuration / アンマウント / ページ離脱** すべてで必ず呼ぶ:

```
teardown(reason):
  clear connectTimer / maxDurationTimer
  dc?.close()
  pc?.getSenders().forEach(s => s.track?.stop())   // 送信トラック停止
  stream?.getTracks().forEach(t => t.stop())        // マイク解放（端末のマイク表示を消す）
  pc?.close()
  audioRef.srcObject = null
  refs（pc/dc/stream）= null
  connPhase = (reason==='user'|'maxduration') ? 'ended' : 'error' か、明示終了は 'ended'
```

- `useEffect` の cleanup で teardown（アンマウント）。
- `window` の `pagehide`/`beforeunload` でも teardown（タブ閉じ/リロードでマイクを確実に解放）。
- 多重 teardown 安全（既に null なら no-op）。
- **token の clientSecret / SDP はログに出さない**（devLog にも payload 本文を出さない既存方針に合わせる）。

## 6. 12 分タイマ（STEP2 は最小）

- `connected` で `maxDurationTimer = setTimeout(teardown('maxduration'), maxDurationMs)`（= /token が返す 720000）。
- STEP2 では発火時は**単純 teardown→ended**（締め発話や result 生成は STEP3+）。
- これにより STEP2 時点でも「12 分で必ず接続が切れる」コスト上限が物理的に効く。

## 7. feature flag / 本番制御（STEP2 追加分）

- page/client は `isRealtimeInterviewEnabledClient()` で表示判定（passai.jp は `?realtime=1` 無効）。
- **発行の最終ゲートは /token の server flag**（`REALTIME_INTERVIEW_ENABLED`）。client flag を改変されても token は出ない＝接続不可。
- マイページ等への導線追加は STEP8（UX 調整）。STEP2 は直 URL アクセス中心で可。

## 8. リスクと対策（STEP2 固有）

| リスク | 対策 |
|---|---|
| マイク未解放（track stop 漏れ） | teardown を全終了経路 + `pagehide`/unmount で必ず呼ぶ。多重安全。 |
| autoplay ブロックで無音に見える | `remoteAudio='autoplay-blocked'` → user gesture 再生ボタン。 |
| Safari/iOS の WebRTC 差異 | `playsInline` 指定、getUserMedia は user gesture 起点、失敗時はターン制誘導。 |
| token 120s 切れ前に SDP 完了せず | start→SDP を直列・即時実行。低速時は connect-failed→再試行で新規 token。 |
| ICE failed の取りこぼし | `connectionstatechange`/`iceconnectionstatechange` 両方を監視し failed→error。 |
| dc が open しない | 15s タイマで connect-failed。 |
| connect-failed 時に session が in_progress で残る | STEP2 では許容（次回 token は in-progress-exists で検出）。**STEP7 で abandon 連携**して詰まり解消。 |
| 二重 start / 二重 teardown | ref フラグで多重起動防止、teardown は null チェックで冪等。 |
| 秘匿値の漏洩 | clientSecret/SDP をログ・Sentry に出さない。 |

## 9. STEP2 完了条件（実装時の受け入れ基準・先出し）

- flag ON の Preview で `/interview/ai/realtime` を開き「始める」→ マイク許可 → `connected` に到達。
- 接続後、AI 側の音声トラックが `<audio>` で再生される（または autoplay-blocked から手動再生で鳴る）。
- マイク拒否で `mic-denied`、未対応ブラウザで `unsupported`、/token 402 で quota dialog、が出る。
- 明示終了 / タブ閉じ / 12 分で **マイクが解放**され、pc/dc が close される（端末のマイク表示が消える）。
- `connected` 到達後 720000ms で自動 teardown される。
- transcript/turn/課金/complete は**まだ動かない**（スコープ外であることを確認）。

## 10. STEP3 への引き継ぎ（このメモで前提化しておくこと）

- `oai-events` の onmessage は STEP2 で購読だけ用意 → STEP3 で
  `response.*` / `conversation.item.input_audio_transcription.completed` をハンドルする土台にする。
- mint の instructions/tools（5 問アーク / `mark_main_question_complete`）は STEP3 で /token 側を拡充。
- 課金（最初の有効発話で CAS）と turn 逐次保存は STEP5/STEP7。STEP2 の sessionId をそのまま使う。
