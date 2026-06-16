// STEP-INTERVIEW-AI-TYPE: 機能別データ連動面接の feature flag。
//
// NEXT_PUBLIC_ENABLE_INTERVIEW_SOURCE_TYPES === 'true' のときだけ新機能（タイプ選択カード /
// 各機能ベース面接 / データ欠如誘導 / 履歴の type 表示）を有効化する。
//
// 未設定 / 'true' 以外は **無効**（本番デフォルト）。一般ユーザーには既存のフリー面接のみが見える。
//
// NEXT_PUBLIC_ プレフィクスのため build 時に client バンドルへインライン化される。server / client
// どちらからも安全に参照できる純関数。'server-only' は付けない。

export function isInterviewSourceTypesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_INTERVIEW_SOURCE_TYPES === 'true';
}
