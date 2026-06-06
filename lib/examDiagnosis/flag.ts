// 受験タイプ診断 9タイプ版の feature flag（runtime kill-switch / 即ロールバック）。
//
// 設計は lib/supabase/mirrorConfig.ts と同形（env を 1 回読んでキャッシュ・throw しない）。
//
// Env var:
//   `NEXT_PUBLIC_EXAM_DIAGNOSIS_ENABLED`
//     - "true" / "1" / "yes"（trim + 小文字化で比較）→ 9タイプ版を有効化。
//     - それ以外（未設定 / 空 / 不明値）→ **無効（= legacy 4タイプ診断を表示）**。
//
// Default-safe: 未設定なら legacy（現行4タイプ）。9タイプは明示 opt-in。
// NEXT_PUBLIC_ prefix のため client bundle にも inline される（/diagnosis は client component）。
// ⚠️ build 時に値が固定される。切替後は再 build / 再 deploy が必要。

const ENABLED_VALUES: ReadonlySet<string> = new Set(['true', '1', 'yes']);

let cachedEnabled: boolean | undefined;

function readEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_EXAM_DIAGNOSIS_ENABLED;
  if (typeof raw !== 'string') return false;
  return ENABLED_VALUES.has(raw.trim().toLowerCase());
}

export function isExamDiagnosisEnabled(): boolean {
  if (cachedEnabled === undefined) cachedEnabled = readEnabled();
  return cachedEnabled;
}
