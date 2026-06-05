// 軽量レイテンシ計測ヘルパ（STEP-TUTOR-ROUTING-AUDIT-01 P0）。
//
// /api/tutor の各区間の所要時間を [TutorLatency] 構造化ログ（console.info）で 1 行出すための
// 最小ユーティリティ。出力速度改善の効果測定が目的で、Tutor の出力品質・口調・prompt には
// 一切影響しない（純粋に観測のみ）。
//
// ⚠️ プライバシー: 本ヘルパには durations と非 PII メタ（intent / cacheHit / 文字数 / token 数
//    / userId 末尾数文字など）のみを渡すこと。message 本文・AI 返答全文・生徒情報の中身は
//    絶対に渡さない（呼び出し側の責務）。
//
// 並列区間について: pre-Claude では quota 判定と context load を Promise.all で並列実行する。
//    そのため record() で各区間の「自己所要時間」を個別に測りつつ、別途その並列ブロック全体の
//    wall-clock も測れるよう、from 起点を呼び出し側が明示する設計にしている。
//
// 使い方:
//   const lat = createLatencyTracker();
//   const t = lat.now();
//   await something();
//   lat.record('auth_ms', t);
//   ...
//   lat.flush({ intent, contextCache: 'hit' });

export type LatencyTracker = {
  /** 計測開始点（区間直前に呼ぶ）。Date.now() のラッパ。 */
  now: () => number;
  /** from（now() の戻り値）からの経過 ms を name で記録する。 */
  record: (name: string, from: number) => void;
  /** 既算出済みの ms 値を直接記録する（offset など）。 */
  set: (name: string, ms: number) => void;
  /** request 開始からの経過 ms。 */
  sinceStart: () => number;
  /**
   * [TutorLatency] を console.info で 1 行出力する。
   * extra は非 PII メタのみ。total_ms（request 開始からの総経過）は自動付与する。
   */
  flush: (extra?: Record<string, unknown>) => void;
};

export function createLatencyTracker(): LatencyTracker {
  const start = Date.now();
  const marks: Record<string, number> = {};

  return {
    now() {
      return Date.now();
    },
    record(name, from) {
      marks[name] = Date.now() - from;
    },
    set(name, ms) {
      marks[name] = ms;
    },
    sinceStart() {
      return Date.now() - start;
    },
    flush(extra) {
      console.info(
        '[TutorLatency]',
        JSON.stringify({ ...marks, total_ms: Date.now() - start, ...extra }),
      );
    },
  };
}
