'use client';

// 小論文 Supabase mirror の状態ストア（UI フィードバック用）。
//
// 役割:
//   essayWorkspaceRepository の debounce mirror が「保存中 / 保存済み / 失敗」を本ストアに
//   publish し、UI（app/essay/components/EssayMirrorStatusBadge.tsx）が subscribe して
//   最低限の保存状態を表示する。他機能（statement 等）は完全 silent best-effort だが、
//   essay は要件により保存失敗を console.error だけでなく UI 上でも分かるようにする。
//
// 設計:
//   - Supabase / localStorage に依存しない純粋な pub/sub。依存方向を片方向に保つため
//     repository（書き手）と UI component（読み手）の両方から安全に import できる。
//   - 'idle'    … 未保存 or 関心なし（badge 非表示）
//   - 'saving'  … mirror 実行中（控えめ表示）
//   - 'saved'   … 直近の mirror 成功（数秒だけ表示）
//   - 'error'   … 直近の mirror 失敗（端末には保存済み。明示表示）
//   - 'no-env'  … Supabase 未設定（dev。badge 非表示扱い = idle と同等）

export type EssayMirrorStatus = 'idle' | 'saving' | 'saved' | 'error' | 'no-env';

let current: EssayMirrorStatus = 'idle';
const listeners = new Set<(s: EssayMirrorStatus) => void>();

export function getEssayMirrorStatus(): EssayMirrorStatus {
  return current;
}

export function setEssayMirrorStatus(next: EssayMirrorStatus): void {
  if (current === next) return;
  current = next;
  for (const fn of listeners) {
    try {
      fn(next);
    } catch {
      // listener の例外は他 listener / 書き手に伝播させない。
    }
  }
}

export function subscribeEssayMirrorStatus(
  fn: (s: EssayMirrorStatus) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
