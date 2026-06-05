'use client';

// STEP-SUPABASE-COMPLETE-06B: statementReviewHistory repository layer（orchestration 層）。
//
// 位置づけ（selfPRRepository.ts と同じ 3 層構造の横展開）:
//   UI / statement ページ
//     ↓
//   lib/statement/review/statementStorage.ts … LS canonical（key='statementReviewHistory'）
//     ↓
//   lib/repository/statementReviewHistoryRepository.ts … 本ファイル。orchestration（いつ / 何件 / 冪等 / flag）
//     ↓ 委譲
//   lib/supabase/statementReviewHistory.ts … DB 境界（SQL / snake_case 翻訳 / RLS / best-effort）
//     ↓
//   Supabase（statement_review_history）
//
// 本 STEP の契約:
//   - **純追加**。誰からも呼ばれない（app / statement ページ / statementStorage.ts は未変更）。
//   - 既存 lib/supabase/statementReviewHistory.ts への委譲のみ。
//   - never throw。委譲先（DB 境界）が既に best-effort（void / 空配列）なので、本層も
//     それをそのまま受け、UI を壊さない。
//   - backfill / dualWrite / read-through / restore / down-sync / tombstone は実装しない。
//     本 STEP は「1 件 mirror の単一 entry point」を確立するのみ。配線は 06C 以降。
//
// grep target の集約:
//   06C / 06D で配線するとき、app 側は本ファイルの mirrorStatementReviewOnce だけを
//   import すれば済むよう、mirror dispatch の入口を 1 箇所に寄せる。
//
// boundary 安全:
//   委譲先 statementReviewHistory.ts は "use client"（browserClient 依存）。本ファイルも
//   "use client" を宣言し、server bundle に browser client を引き込まないことを明示する。

import { upsertStatementReviewToSupabase } from '@/lib/supabase/statementReviewHistory';
import {
  loadReviewHistory,
  type ReviewHistoryItem,
} from '@/lib/statement/review/statementStorage';
import { backfillDone, markBackfillDone } from './backfillFlag';

/**
 * 1 件の添削履歴（ReviewHistoryItem）を Supabase durable mirror に upsert する単一 entry point。
 *
 * - natural key (user_id, local_review_id) の冪等 upsert に委譲するだけ。
 *   item は不変なので、同一 item の再 mirror は安全（同一内容の DO UPDATE）。
 * - release 前は LS → Supabase の上り方向のみ。delete / restore は伝播しない
 *   （propagateDelete=false 相当。10 件 cap eviction も id 削除も DB に送らない）。
 * - userId が空なら no-op。委譲先が best-effort（never throw）なので本層も throw しない。
 *
 * 配線想定:
 *   06C — AuthProvider から backfill 用途で複数件ループ呼び出し（別関数を後で追加）。
 *   06D — app/statement/edit/page.tsx の保存成功直後に 1 件呼び出し。
 *   本 STEP では未配線（誰も呼ばない）。
 */
export async function mirrorStatementReviewOnce(args: {
  userId: string;
  item: ReviewHistoryItem;
}): Promise<void> {
  if (!args.userId) return;
  await upsertStatementReviewToSupabase({ userId: args.userId, item: args.item });
}

// ── backfill（初回一括 LS → SB） ────────────────────────────────────

/**
 * 現在の localStorage の添削履歴（statementReviewHistory）を Supabase へ一括同期する
 * （初回 1 回）。STEP-SUPABASE-COMPLETE-06C。
 *
 * 背景:
 *   dualWrite（06D で配線予定）は配線後の新規保存のみを mirror するため、配線前に
 *   蓄積された既存 LS 履歴は Supabase に上がらない。その「上り」の欠落を backfill が
 *   埋める（selfPRRepository.ts:backfillSelfPRsOnce と同趣旨）。
 *
 * 設計（selfPRs と同形 — id natural key / 上りのみ / restore なし）:
 *   - userId が無ければ no-op。
 *   - browser でなければ no-op（SSR で localStorage を読まない）。loadReviewHistory は
 *     safeStorage 経由で SSR 安全だが、明示 guard で意図を示す。
 *   - flag（backfillFlag.ts, feature='statementReviewHistory'）で完了済みなら skip。
 *   - localStorage が 0 件なら no-op（flag は立てない。次回も安価に再判定するだけ。
 *     selfPRs と同じ思想）。
 *   - 各 item を冪等 helper mirrorStatementReviewOnce で upsert。natural key
 *     (user_id, local_review_id) の onConflict なので、後続 dualWrite と衝突しない。
 *   - mirrorStatementReviewOnce → upsertStatementReviewToSupabase は never throw
 *     （失敗は devWarn で握り潰す best-effort）。逐次 await でも 1 件の失敗で全体は落ちない。
 *   - 全件 upsert 後に flag を立てる。flag は correctness ではなく最適化であり、冪等
 *     upsert なので flag リセット後の再実行も無害（backfillFlag.ts 設計）。
 *
 * 上り mirror only（重要）:
 *   - DB → LS restore はしない（listStatementReviewsFromSupabase は使わない）。
 *   - LS の 10 件 cap を DB に反映しない（Supabase 側を prune しない）。DB は 10 件超を
 *     durable に保持できる（preview §9）。
 *   - delete / eviction を DB delete として扱わない（propagateDelete=false 相当）。
 *
 * 注: 本 STEP では AuthProvider から fire-and-forget で起動する（06C 配線）。
 */
export async function backfillStatementReviewHistoryOnce(args: {
  userId: string;
}): Promise<void> {
  const { userId } = args;
  if (!userId) return;
  if (typeof window === 'undefined') return; // SSR では LS を読まない
  if (backfillDone(userId, 'statementReviewHistory')) return;

  const history = loadReviewHistory();
  if (history.length === 0) return; // 0 件 → no-op（flag は立てない）

  for (const item of history) {
    await mirrorStatementReviewOnce({ userId, item });
  }

  markBackfillDone(userId, 'statementReviewHistory');
}
