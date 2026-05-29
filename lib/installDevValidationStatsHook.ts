// dev devtools 経由で validation stats を即読みできるようにする hook。
//
// 役割:
//   `window.__PASSAI_VALIDATION_STATS__` に getValidationStats / resetValidationStats への
//   薄い参照を貼る。dev 中に DevTools の Console から:
//     __PASSAI_VALIDATION_STATS__.get()
//     __PASSAI_VALIDATION_STATS__.reset()
//   を呼べる。SaaS / persistence / UI は持たない。
//
// production no-op:
//   NODE_ENV !== 'development' で即 return。window へのプロパティ書き込みも行わない。
//   Next.js は build 時に NODE_ENV を文字列リテラルへ inline するため、production build では
//   関数本体が dead code として tree-shake 対象になる。
//
// SSR ガード:
//   `typeof window !== 'undefined'` で defensive guard。本来 useEffect 内からしか呼ばれない
//   想定だが、呼び出し位置のミスがあっても SSR で爆発しない構造にしておく。
//
// 関連:
//   - lib/devValidationStats.ts
//   - lib/aiValidationLog.ts

import {
  getValidationCostEstimate,
  getValidationDerivedMetrics,
  getValidationStats,
  resetValidationStats,
} from './devValidationStats';
import { aggregateRouteEconomics } from './devRouteEconomics';

declare global {
  interface Window {
    __PASSAI_VALIDATION_STATS__?: {
      get: typeof getValidationStats;
      metrics: typeof getValidationDerivedMetrics;
      cost: typeof getValidationCostEstimate;
      getRouteEconomics: typeof aggregateRouteEconomics;
      reset: typeof resetValidationStats;
    };
  }
}

export function installDevValidationStatsHook(): void {
  if (process.env.NODE_ENV !== 'development') return;
  if (typeof window === 'undefined') return;
  window.__PASSAI_VALIDATION_STATS__ = {
    get: getValidationStats,
    metrics: getValidationDerivedMetrics,
    cost: getValidationCostEstimate,
    getRouteEconomics: aggregateRouteEconomics,
    reset: resetValidationStats,
  };
}
