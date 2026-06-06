# Sentry Error Tracking（運用ガイド）

PASSAI の本番 client/server/edge エラーを Sentry に送るための最小安全構成。
実装は STEP-OBSERVABILITY-SENTRY-01。

---

## 1. 構成ファイル

| ファイル | 役割 |
|---|---|
| `instrumentation-client.ts` | client(ブラウザ) 用 init。Next.js 16 の file convention（旧 `sentry.client.config.ts` 後継）。Session Replay 設定もここ。 |
| `sentry.server.config.ts` | server(nodejs) 用 init。`instrumentation.ts` の `register()` から読み込む。 |
| `sentry.edge.config.ts` | edge 用 init。同上。 |
| `instrumentation.ts` | runtime 別に server/edge config を読み込み + `onRequestError` を export。既存 undici 設定は不変。 |
| `next.config.ts` | `withSentryConfig` で source map upload をラップ。 |
| `lib/sentry/options.ts` | DSN・enabled・sample rate の共通値。 |
| `lib/sentry/scrub.ts` | `beforeSend` / `beforeBreadcrumb` の PII・自由記述本文スクラバ。 |
| `lib/sentry/capture.ts` | `captureRouteException`（重要 route 用ラッパ。tags/extra を構造的に制限）。 |

---

## 2. 安全設計（要点）

- **本番のみ送信**: `SENTRY_ENABLED = process.env.NODE_ENV === 'production'`。
  非本番では `enabled=false` かつ `tracesSampleRate=0`。
- **DSN 2 系統**: server/edge は `SENTRY_DSN`、client は `NEXT_PUBLIC_SENTRY_DSN`。
- **sendDefaultPii: false**（cookie/IP/headers の自動添付を抑止）。
- **Session Replay**: 通常 0 / エラー時のみ 1.0（本番のみ）。`maskAllText/maskAllInputs/blockAllMedia` 全有効。
- **scrub**（`lib/sentry/scrub.ts`）が送信直前に email・token・自由記述本文（essay/statement/selfPR/tutor message/content/prompt/answer 等）を `[Filtered]`/`[Redacted]` に置換。
- **captureException の extra は `status/code/durationMs/retryCount` のみ**。本文・AI 出力は型レベルで入らない。

---

## 3. ローカル限定の疎通確認手順

> Sentry は本番（`NODE_ENV=production`）でのみ送信が有効。ローカル確認は production ビルドで一時的に行い、**テスト用 throw / テスト route をコードに残さない**こと。

### 3.1 準備
1. `.env.local` に Sentry の DSN を一時設定（`SENTRY_DSN` と `NEXT_PUBLIC_SENTRY_DSN`）。
2. production ビルドで起動:
   ```bash
   npm run build && npm run start
   ```
   （`next start` は `NODE_ENV=production` で動くため `SENTRY_ENABLED` が true になる。）

### 3.2 server エラー（captureException 経路）
- テスト用 throw を足さず、**実在のエラー経路**を使う:
  - 例: `.env.local` の `ANTHROPIC_API_KEY` を一時的に不正値にして `/tutor` でメッセージ送信
    → route が `AI_REQUEST_FAILED`(502) を返し `captureRouteException` が発火。
- Sentry Issues に `tags: route=api/tutor, feature=tutor, status=502` 付きで届くこと、
  かつ payload に **email / token / メッセージ本文 / prompt / AI 応答が含まれない**ことを確認。
- 確認後、`ANTHROPIC_API_KEY` を元に戻す。

### 3.3 client エラー（Replay 経路）
- ブラウザの DevTools Console で一時的に `throw new Error('local sentry check')` を実行
  （ソースには残さない）。
- Issue が届き、Replay が **エラー時のみ**記録され、テキストが全マスクされていることを確認。

### 3.4 scrub の確認ポイント
- Sentry の Issue 詳細 → JSON で `request` / `extra` / `breadcrumbs` を開き、
  `email` / `*token*` / 本文系 key が `[Filtered]`、文字列中の email/JWT/Bearer が `[Redacted]` になっていること。

---

## 4. 注意

- ローカル確認のための DSN 値や不正 API key は **コミットしない**（`.env.local` は gitignore 済）。
- 疎通確認用の一時 route / テスト throw は本番コードに残さない。
- 本番の環境変数（DSN/ORG/PROJECT/AUTH_TOKEN）は Vercel 側で設定する。
