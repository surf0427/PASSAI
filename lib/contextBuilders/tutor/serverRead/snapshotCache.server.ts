// Exam Spine — per-user read snapshot cache（Phase 2）。
//
// 位置づけ:
//   Spine の **read 結果**を短期間だけ保持する層。
//   従来 lib/contextBuilders/tutorContext.ts に private で置かれていた
//   60 秒 per-user cache を、feature 非依存の形へ移設したもの。
//
// 方針（移設元の意味論をそのまま維持する）:
//   - key  : 呼び出し側が決める（Tutor は userId のみ）。
//   - TTL  : 呼び出し側が決める（Tutor は 60 秒）。
//   - store: **プロセス内 Map**。dev / serverless では永続もインスタンス間共有も
//            保証しない（複数インスタンス・cold start で空から始まる）。
//            同一インスタンス・短時間のベストエフォート最適化であり、
//            正しさは cache 無しでも成立する設計。
//   - 非キャッシュ条件: `shouldCache` が false を返す値は保存しない。
//            Tutor は「全 source 空」を保存しない。read は never-throw で一時的失敗も
//            空に倒れるため、空を TTL 間固定すると生徒情報を隠してしまうため。
//   - invalidation: TTL のみ（明示 invalidation なし）。
//   - quality: truncation / 要約 / tiering は一切しない。値をそのまま保持・返す。
//
// セキュリティ:
//   - key は呼び出し側が userId 等から作る。**cache hit は認可の代替ではない。**
//     呼び出し側は cache hit でも認証・認可を毎 request 評価すること（E-S7）。
//   - server プロセス内に他ユーザーの値が同居するため、browser bundle へ出さない。
//
// ⚠️ Redis / Vercel KV / Supabase 等の外部 store へ差し替えないこと。
//    Phase 2 は純粋な移設であり、store の性質を変えると失敗モードが変わる。
//
// 関連: lib/contextBuilders/tutor/serverRead/reader.server.ts

import 'server-only';

export type ExamSpineSnapshotCache<T> = {
  /**
   * 有効な値があれば返す。期限切れは掃除して null。
   * @param now Date.now()。**呼び出し側が 1 回だけ取得して get/set に同じ値を渡す**
   *            （load 前後で時刻がずれ、実効 TTL が伸びるのを防ぐため）。
   */
  get(key: string, now: number): T | null;
  /** shouldCache を満たす値だけを now + ttlMs まで保持する。 */
  set(key: string, value: T, now: number): void;
};

export function createExamSpineSnapshotCache<T>(options: {
  ttlMs: number;
  /** 保存してよい値か。false なら保存しない（次回も miss になる）。 */
  shouldCache: (value: T) => boolean;
}): ExamSpineSnapshotCache<T> {
  const store = new Map<string, { value: T; expiresAt: number }>();

  return {
    get(key, now) {
      if (!key) return null;
      const cached = store.get(key);
      if (cached && cached.expiresAt > now) return cached.value;
      if (cached) store.delete(key); // 期限切れの掃除
      return null;
    },
    set(key, value, now) {
      if (!key) return;
      if (!options.shouldCache(value)) return;
      store.set(key, { value, expiresAt: now + options.ttlMs });
    },
  };
}
