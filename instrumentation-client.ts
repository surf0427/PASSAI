// Sentry client (ブラウザ) 設定。
//
// Next.js 16 では client 側の計測初期化は `instrumentation-client.ts` に置く
// （旧 `sentry.client.config.ts` の後継。Next.js v15.3+ で導入された file convention）。
// このファイルが本プロジェクトの「client 用 Sentry config」である。
//
// 方針（最小安全構成）:
//   - 送信は本番のみ（SENTRY_ENABLED）かつ DSN がある場合のみ。
//   - sendDefaultPii=false（要件 7）。
//   - Session Replay は通常 0、エラー時のみ 1.0（要件 6）。Replay 内のテキスト・入力・
//     メディアは全マスク（本文/個人情報の録画流出を防ぐ）。
//   - beforeSend / beforeBreadcrumb で PII・自由記述本文を除去（要件 8）。

import * as Sentry from '@sentry/nextjs';

import {
  CLIENT_DSN,
  REPLAYS_ON_ERROR_SAMPLE_RATE,
  REPLAYS_SESSION_SAMPLE_RATE,
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
  TRACES_SAMPLE_RATE,
} from '@/lib/sentry/options';
import { scrubBreadcrumb, scrubEvent } from '@/lib/sentry/scrub';

Sentry.init({
  dsn: CLIENT_DSN,
  enabled: SENTRY_ENABLED && Boolean(CLIENT_DSN),
  environment: SENTRY_ENVIRONMENT,

  // Error Tracking 優先。performance trace は本番でも低率、非本番は 0。
  tracesSampleRate: TRACES_SAMPLE_RATE,

  // 個人情報（IP / cookie / headers 等）の自動添付を無効化。
  sendDefaultPii: false,

  // Session Replay: 通常セッション 0 / エラー時のみ 1.0（本番のみ）。
  replaysSessionSampleRate: REPLAYS_SESSION_SAMPLE_RATE,
  replaysOnErrorSampleRate: REPLAYS_ON_ERROR_SAMPLE_RATE,

  integrations: [
    // Replay 録画は全テキスト・全入力・全メディアをマスクする。
    // 自由記述本文 / 個人情報が録画として外部送信されることを防ぐ。
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],

  // PII / 自由記述本文の最終防衛線（送信直前に走査して除去）。
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});

// App Router のナビゲーション計測を Sentry に接続する（Next.js 16 client instrumentation）。
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
