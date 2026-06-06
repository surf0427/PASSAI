import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// Sentry (STEP-OBSERVABILITY-SENTRY-01)。
//   - source map upload と server 計測のための build 時ラッパ。
//   - org / project / authToken は環境変数から（未設定なら upload を skip するだけで
//     build は失敗しない。CI/本番で設定する想定）。
//   - source map はアップロード後に削除し、本番配信物に残さない。
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // ビルドログを静かに（CI 以外）。
  silent: !process.env.CI,

  // Sentry へのプロダクト利用テレメトリ送信を無効化。
  telemetry: false,

  // client 配信物まで source map upload 範囲を広げ、stack trace を正しく解決する。
  widenClientFileUpload: true,

  sourcemaps: {
    // upload 後に source map を削除し、本番配信物へ残さない（情報露出防止）。
    deleteSourcemapsAfterUpload: true,
  },
});
