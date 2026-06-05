'use client';

// STEP-SUPABASE-COMPLETE-05B: selfPRs repository layer（orchestration 層）。
//
// 位置づけ（selfAnalysisLogRepository.ts と同じ 3 層構造の横展開）:
//   UI / self-pr ページ
//     ↓
//   lib/selfPRStorage.ts            … LS canonical（key='selfPRs'）
//     ↓
//   lib/repository/selfPRRepository.ts … 本ファイル。orchestration（いつ / 何件 / 冪等 / flag / delta）
//     ↓ 委譲
//   lib/supabase/selfPRs.ts         … DB 境界（SQL / snake_case 翻訳 / RLS / best-effort）
//     ↓
//   Supabase（self_prs）
//
// 本 STEP の契約:
//   - **純追加**。誰からも呼ばれない（app / self-pr/page.tsx / selfPRStorage.ts は未変更）。
//   - 既存 lib/supabase/selfPRs.ts への委譲のみ。
//   - never throw。委譲先（DB 境界）が既に best-effort（void / 空配列）なので、本層も
//     それをそのまま受け、UI を壊さない。
//   - read-through / restore / down-sync / tombstone は実装しない。delete 伝播は
//     既定 off（propagateDelete=false）で、明示 opt-in のときのみ物理削除を委譲する。
//
// boundary 安全:
//   委譲先 selfPRs.ts は "use client"（browserClient 依存）。本ファイルも "use client" を
//   宣言し、server bundle に browser client を引き込まないことを明示する。

import {
  upsertSelfPRToSupabase,
  deleteSelfPRFromSupabase,
} from '@/lib/supabase/selfPRs';
import { loadSelfPRs } from '@/lib/selfPRStorage';
import type { SelfPR } from '@/types/selfPR';
import { backfillDone, markBackfillDone } from './backfillFlag';

// ── backfill（初回一括 LS → SB） ────────────────────────────────────

/**
 * 現在の localStorage 全 selfPR を Supabase へ一括同期する（初回 1 回）。
 *
 * 背景:
 *   dualWrite（後続 STEP で配線）は配線後の新規 persist のみを mirror するため、
 *   配線前に蓄積された既存 LS カードは Supabase に上がらない。その「上り」の欠落を
 *   backfill が埋める（selfAnalysisLogRepository.ts:backfillSelfAnalysisLogsOnce と同趣旨）。
 *
 * 設計:
 *   - flag（backfillFlag.ts, feature='selfPRs'）で完了済みなら skip。
 *   - localStorage が 0 件なら no-op（flag も立てない。次回も安価に再判定するだけ）。
 *   - 既存の冪等 helper（upsertSelfPRToSupabase）のみを使う。natural key
 *     (user_id, local_pr_id) の onConflict なので dualWrite と衝突しない。
 *   - never throw。委譲先は void（失敗を握り潰す）ため partial 失敗は観測できない。
 *     全件 upsert 後に flag を立てる。flag は correctness ではなく最適化であり、
 *     冪等 upsert なので flag リセット後の再実行も無害（backfillFlag.ts 設計）。
 *
 * 注:
 *   - selfPRs に配列上限はコード上に存在しない（実運用では UI 件数で抑制される前提）。
 *   - 本 STEP では未配線（誰も呼ばない）。後続 STEP-05C で起動配線する。
 */
export async function backfillSelfPRsOnce(userId: string): Promise<void> {
  if (!userId) return;
  if (backfillDone(userId, 'selfPRs')) return;

  const prs = loadSelfPRs();
  if (prs.length === 0) return; // 0 件 → no-op（flag は立てない）

  for (const pr of prs) {
    await upsertSelfPRToSupabase({ userId, pr });
  }

  markBackfillDone(userId, 'selfPRs');
}

// ── dualWrite（LS 書き込み後の delta ミラー） ──────────────────────────

// 1 件の SelfPR が prev と比べて変化したかを判定する。
// updatedAt / title / text / latestResult / index / seedInputHash / createdAt の
// いずれかが変われば「変更あり」とみなして upsert 対象にする。
//   - title / seedInputHash / createdAt は optional のため、'' / null へ正規化して比較する。
function selfPRChanged(prev: SelfPR, next: SelfPR): boolean {
  return (
    prev.updatedAt !== next.updatedAt ||
    (prev.title ?? '') !== (next.title ?? '') ||
    prev.text !== next.text ||
    prev.latestResult !== next.latestResult ||
    prev.index !== next.index ||
    (prev.seedInputHash ?? null) !== (next.seedInputHash ?? null) ||
    (prev.createdAt ?? null) !== (next.createdAt ?? null)
  );
}

/**
 * localStorage の selfPRs 書き込み（prev → next）の差分だけを Supabase に反映する。
 *
 * 差分判定（id = SelfPR.id を natural key として prev / next を突き合わせる）:
 *   - next のみに存在する id           → new        → upsert
 *   - 両方に存在し selfPRChanged()=true → changed    → upsert
 *   - 両方に存在し変化なし              → そのまま（DB 呼び出しなし）
 *   - prev のみに存在する id            → removed    → propagateDelete===true のときだけ delete
 *
 * delete 伝播は **既定 off**（propagateDelete 省略時 false）。
 *   selfPR は delete feature であり、安易な delete 伝播は多端末で delete resurrection /
 *   意図しない消失を招く。down-sync / tombstone 設計が済むまで、削除は既定で
 *   Supabase mirror に伝播させない（mirror に残骸が残るのは許容。canonical は LS）。
 *
 * never throw。委譲先（upsert / delete）が best-effort なので、本層も void を返す。
 *
 * 注: 本 STEP では未配線（誰も呼ばない）。後続 STEP-05C で selfPRStorage の persist /
 *     delete 後から呼ぶ想定。
 */
export async function dualWriteSelfPRsDelta(args: {
  userId: string;
  prev: SelfPR[];
  next: SelfPR[];
  propagateDelete?: boolean;
}): Promise<void> {
  const { userId, prev, next, propagateDelete = false } = args;
  if (!userId) return;

  const prevById = new Map<string, SelfPR>();
  for (const pr of prev) prevById.set(pr.id, pr);

  const nextIds = new Set<string>();

  // new or changed → upsert。
  for (const pr of next) {
    nextIds.add(pr.id);
    const before = prevById.get(pr.id);
    if (!before || selfPRChanged(before, pr)) {
      await upsertSelfPRToSupabase({ userId, pr });
    }
  }

  // removed → propagateDelete のときだけ owner-scoped delete。
  if (propagateDelete) {
    for (const pr of prev) {
      if (!nextIds.has(pr.id)) {
        await deleteSelfPRFromSupabase({ userId, localPrId: pr.id });
      }
    }
  }
}
