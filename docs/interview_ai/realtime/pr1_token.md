# PR1 (STEP1): `/api/interview-ai/realtime/token` 詳細設計

> リアルタイム音声面接の最初の実装単位。既存ターン制 (`/interview/ai`, `session/turn/complete/abandon`) は無改変。
> 設計監査は [pr0_design.md](./pr0_design.md) を参照（未保存の場合は会話STEP0を正本とする）。

## 検証済みの OpenAI 公式仕様（2026-06 時点）

- client secret 発行: `POST https://api.openai.com/v1/realtime/client_secrets`（標準APIキーでサーバ認証）。
  レスポンス `{ value: "ek_...", expires_at, session }`。
- `expires_after.seconds` = 10–7200（既定600）。**TTLは接続開始の猶予のみ。接続中セッションは止めない。**
- セッション最大長 = **60分（OpenAIハードキャップ）**。→ 12分上限は自前強制。
- WebRTC: ブラウザが SDP offer を `POST https://api.openai.com/v1/realtime/calls`
  （`Authorization: Bearer ek_...`, `Content-Type: application/sdp`）へ。data channel `oai-events`。
- `OpenAI-Safety-Identifier`（ハッシュ済みuserId）はサーバmint時に設定 → トークンに束縛。
- モデル: `gpt-realtime` 系（`gpt-realtime`, `gpt-realtime-mini`, `gpt-realtime-2`）。
  実コスト ≈ $0.18–0.46/min（uncached）、$0.05–0.10/min（cached）。mini が安価。

## ルート契約

```
POST /api/interview-ai/realtime/token
Body: { interviewType?, targetRef?, sourceType?, sourceId?, sourceContext? }  // sourceContext ≤ 6500

201: { sessionId, clientSecret, expiresAt, model, maxDurationMs, callUrl }
403 {error:'realtime-disabled'}                    // サーバflag OFF（本番既定）
401                                                 // 認証失敗
403 {error:'not-allowlisted'}                       // REALTIME_DEV_USER_IDS 設定時、対象外
402 {error:'quota-exceeded', plan, feature, used, limit}
200 {error:'in-progress-exists', session}           // one_in_progress 衝突
400 {error:'invalid-body'|'invalid-source-context'}
502 {error:'token-mint-failed'}                     // OpenAI発行失敗（作成済みsessionはabandonへ）
```

## 処理フロー（fail-closed / 順序厳守）

1. `REALTIME_INTERVIEW_ENABLED === 'true'` でなければ 403 `realtime-disabled`。
2. `ensurePlanQuota('interview-ai-realtime')` → userId取得 + plan/quota。reject はそのまま返す。
3. `REALTIME_DEV_USER_IDS` 非空なら userId ∈ list、外なら 403 `not-allowlisted`。
4. body validate（既存 /session のバリデータ流用）。
5. session作成: `source='realtime'`, `status='in_progress'`, `usage_recorded=false`,
   `metadata={ realtime:true, model, maxDurationMs:720000 }`。23505 → 200 `in-progress-exists`。
6. session config 構築（STEP1は最小、STEP3で5問アーク注入）。
7. mint: `POST .../v1/realtime/client_secrets`、`OpenAI-Safety-Identifier: sha256(userId+salt)`,
   `expires_after.seconds=120`。失敗 → session を `abandoned` に戻し 502。
8. `logAiUsage`（route `api/interview-ai/realtime/token`）。**recordUsage は呼ばない**（課金はSTEP7）。
9. 201 を返す。

## 12分上限の多層強制

- クライアント: 接続成立で12分タイマ → 締め発話 → `pc.close()`。
- サーバ: `metadata.maxDurationMs`/`startedAt` を保存。turn逐次保存ルート（STEP5）が締切超過を拒否。
- バックストップ: OpenAI 60分ハードキャップ + Premium 5回/月 quota。

## 新規 env

| 変数 | 用途 | 既定 |
|---|---|---|
| `REALTIME_INTERVIEW_ENABLED` | サーバ最終ゲート | 未設定=無効 |
| `NEXT_PUBLIC_ENABLE_REALTIME_INTERVIEW` | クライアントUI表示flag | 未設定=非表示 |
| `REALTIME_DEV_USER_IDS` | 開発者allowlist（カンマ区切り） | 未設定=skip |
| `INTERVIEW_AI_REALTIME_MODEL` | realtimeモデルID | `gpt-realtime-mini` |
| `INTERVIEW_AI_REALTIME_VOICE` | 音声 | `alloy` |
| `REALTIME_SAFETY_ID_SALT` | safety-id ハッシュ用salt | 本番必須 |
| `OPENAI_API_KEY` | 既存・流用 | 既存 |

## feature key `interview-ai-realtime`

- `QUOTA_FEATURES` / `QUOTAS`(Free0/Basic0/Premium5) / `FEATURE_ROUTE_KEYS`(`['interview-ai-realtime']`) /
  `QuotaExceededDialog` の `FEATURE_LABELS` に追加。
- 課金は最初の有効発話で既存 CAS (`usage_recorded`) を流用（STEP7）。発行=未課金。

## STEP1 完了条件

- flag OFF → 403 `realtime-disabled`
- 非Premium / 上限超過 → 402 `quota-exceeded`
- allowlist外 → 403 `not-allowlisted`
- in_progress 既存あり → 200 `in-progress-exists`
- 正常時 `source='realtime'` session 作成 + `{clientSecret, expiresAt, model, maxDurationMs, callUrl}` 返却
- mint失敗時 session が `abandoned`
- `usage_records` は増えない

## スキーマ前提

`interview_ai_sessions.source` CHECK に `'realtime'` を**先行追加**（破壊的変更なし）。token route が
`source='realtime'` を書くため、ルート投入前に適用すること。
