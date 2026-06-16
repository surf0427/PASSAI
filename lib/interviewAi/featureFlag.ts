// STEP-INTERVIEW-AI-TYPE: 機能別データ連動面接の feature flag。
//
// NEXT_PUBLIC_ENABLE_INTERVIEW_SOURCE_TYPES が "true" / "1" / "yes"（trim + 小文字化で比較）の
// ときだけ新機能（タイプ選択カード / 各機能ベース面接 / データ欠如誘導 / 履歴の type 表示）を有効化する。
// 既存 flag（lib/examDiagnosis/flag.ts）と同じ寛容なパースにし、"TRUE" / " true " 等の取りこぼしを防ぐ。
//
// 未設定 / 上記以外は **無効**（本番デフォルト）。一般ユーザーには既存のフリー面接のみが見える。
//
// NEXT_PUBLIC_ プレフィクスのため build 時に client バンドルへインライン化される。server / client
// どちらからも安全に参照できる純関数。'server-only' は付けない。

const ENABLED_VALUES: ReadonlySet<string> = new Set(['true', '1', 'yes']);

export function isInterviewSourceTypesEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_ENABLE_INTERVIEW_SOURCE_TYPES;
  if (typeof raw !== 'string') return false;
  return ENABLED_VALUES.has(raw.trim().toLowerCase());
}
