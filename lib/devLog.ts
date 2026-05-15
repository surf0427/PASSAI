// STEP6.14: dev 専用 console wrapper。
//   各 page / handler 側に散在していた `if (process.env.NODE_ENV !== 'production')` guard を
//   ここに集約することで、呼び出し側を 1 行に縮約し、将来 observability layer
//   (Sentry / Datadog 等) への差し替え時の touch ポイントを 1 箇所にする。
//
// 設計判断:
//   - eager API (`devLog(label, data)`) を採用。引数は呼び出し側で評価されるため、production でも
//     引数式 (object literal 等) は毎回 alloc される。ただし console 出力自体は guard で抑止される。
//     遅延評価が欲しければ将来 `devLog(() => [...])` lazy 形式を別 export として足せる。
//   - guard は build time に `process.env.NODE_ENV` が文字列リテラルへ inline されるため、
//     production build では `if ('production' !== 'production') { ... }` の dead code として
//     bundler の DCE で console 呼び出しが除去される。
//   - console API は元の呼び出し (log / warn) を温存。error は production でも catch ログとして
//     残す責務があるため本 helper の対象外 (page.tsx 側で直接 console.error を呼ぶ運用を維持)。

export function devLog(...args: unknown[]): void {
  if (process.env.NODE_ENV !== 'production') {
    console.log(...args);
  }
}

export function devWarn(...args: unknown[]): void {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(...args);
  }
}
