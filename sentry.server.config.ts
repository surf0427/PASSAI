// Sentry server (Node.js runtime) 設定。
//
// instrumentation.ts の register() が NEXT_RUNTIME==='nodejs' のときに import する。
//
// 方針（最小安全構成）:
//   - 送信は本番のみ（SENTRY_ENABLED）かつ SENTRY_DSN がある場合のみ。
//   - sendDefaultPii=false（要件 7）。request body / headers の自動添付を防ぐ。
//   - beforeSend / beforeBreadcrumb で PII・自由記述本文・AI 会話を除去（要件 8）。

import * as Sentry from '@sentry/nextjs';

import {
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
  SERVER_DSN,
  TRACES_SAMPLE_RATE,
} from '@/lib/sentry/options';
import { scrubBreadcrumb, scrubEvent } from '@/lib/sentry/scrub';

Sentry.init({
  dsn: SERVER_DSN,
  enabled: SENTRY_ENABLED && Boolean(SERVER_DSN),
  environment: SENTRY_ENVIRONMENT,

  tracesSampleRate: TRACES_SAMPLE_RATE,

  sendDefaultPii: false,

  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});
