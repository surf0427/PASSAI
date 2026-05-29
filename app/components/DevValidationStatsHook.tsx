'use client';

// RootLayout から無条件にマウントされる空コンポーネント。useEffect で
// installDevValidationStatsHook を 1 回だけ呼び、`window.__PASSAI_VALIDATION_STATS__` を
// dev 中だけ提供する。production では install 関数自身が即 return するため、ここでも no-op。
//
// 描画は null。DOM / 視覚的副作用なし。

import { useEffect } from 'react';
import { installDevValidationStatsHook } from '@/lib/installDevValidationStatsHook';

export function DevValidationStatsHook(): null {
  useEffect(() => {
    installDevValidationStatsHook();
  }, []);
  return null;
}
