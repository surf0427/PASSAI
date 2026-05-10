// localStorage の安全なラッパー。
// SSR（typeof window === 'undefined'）と JSON パースエラーを吸収する。
// すべての storage ファイルはこのヘルパーを通じて localStorage を操作する。

export function safeGetStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const item = localStorage.getItem(key);
    if (!item) return fallback;
    return JSON.parse(item) as T;
  } catch {
    return fallback;
  }
}

export function safeSetStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存失敗時もアプリは落とさない
  }
}

export function safeRemoveStorage(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    // 削除失敗時もアプリは落とさない
  }
}
