'use client';

// STEP-SUPABASE-COMPLETE-04B: selfAnalysisLogs repository layer（orchestration 層）。
//
// 位置づけ（tutorRepository.ts と同じ 3 層構造の横展開）:
//   UI / loadMypageData
//     ↓
//   lib/selfAnalysisLogStorage.ts          … LS canonical（同期・facade）
//     ↓
//   lib/repository/selfAnalysisLogRepository.ts … 本ファイル。orchestration（いつ / 何件 / 冪等 / flag）
//     ↓ 委譲
//   lib/supabase/selfAnalysisLogs.ts       … DB 境界（SQL / snake_case 翻訳 / RLS / never throw）
//     ↓
//   Supabase（self_analysis_logs）
//
// 本 STEP の契約:
//   - **純追加**。誰からも呼ばれない（AuthProvider / page.tsx は未変更）。
//   - 既存 lib/supabase/selfAnalysisLogs.ts への **委譲のみ**。
//   - hydrate / dualWrite は薄い pass-through（戻り値は委譲先の型をそのまま）。
//   - backfillSelfAnalysisLogsOnce のみ新規 orchestration。初回 1 回だけ LS 全 log を
//     既存の冪等 upsert helper で一括同期する。flag は backfillFlag.ts に委譲。
//
// boundary 安全:
//   委譲先 selfAnalysisLogs.ts は "use client"（browserClient 依存）。本ファイルも
//   "use client" を宣言し、server bundle に browser client を引き込まないことを明示する。
//   後続 STEP では AuthProvider から dynamic import で呼ぶ想定。

import {
  listSelfAnalysisLogsFromSupabase,
  upsertSelfAnalysisLogToSupabase,
  type ListSelfAnalysisLogsResult,
} from '@/lib/supabase/selfAnalysisLogs';
import {
  loadSelfAnalysisLogs,
  saveSelfAnalysisLogs,
} from '@/lib/selfAnalysisLogStorage';
import type { SelfAnalysisLog } from '@/types/selfAnalysisLog';
import { backfillDone, markBackfillDone } from './backfillFlag';

// ── hydrate（SB → 一覧取得・将来の read 切替用） ─────────────────────
//
// listSelfAnalysisLogsFromSupabase の orchestration 入口。挙動は完全に同一（pass-through）。
// 本 STEP の UI からは未参照（read 経路は localStorage canonical のまま）。
export function hydrateSelfAnalysisLogs(
  userId: string,
): Promise<ListSelfAnalysisLogsResult> {
  return listSelfAnalysisLogsFromSupabase(userId);
}

// ── dualWrite（LS 書き込み後の 1 件ミラー） ──────────────────────────
//
// upsertSelfAnalysisLogToSupabase の orchestration 入口。挙動は完全に同一（pass-through）。
// 後続 STEP で write 発生箇所（self-analysis/run・resume）から persist 後に呼ぶ想定。
export function dualWriteSelfAnalysisLog(input: {
  log: SelfAnalysisLog;
  userId: string;
}): Promise<unknown> {
  return upsertSelfAnalysisLogToSupabase({
    userId: input.userId,
    log: input.log,
  });
}

// ── backfill（初回一括 LS → SB） ────────────────────────────────────

export type BackfillSelfAnalysisLogsResult =
  | { kind: 'ok'; logCount: number }
  | { kind: 'skipped'; reason: 'no-user' | 'already-done' | 'empty' }
  | { kind: 'no-env' }
  | { kind: 'partial' };

/**
 * 現在の localStorage 全 self-analysis log を Supabase へ一括同期する（初回 1 回）。
 *
 * 背景:
 *   dualWrite（後続 STEP で配線）は配線後の新規 persist のみを mirror するため、
 *   配線前に蓄積された既存 LS ログは Supabase に上がらない。その「上り」の欠落を
 *   backfill が埋める（tutorRepository.ts:backfillTutorOnce と同趣旨）。
 *
 * 設計:
 *   - flag（backfillFlag.ts）で完了済みなら skip。
 *   - 既存の冪等 helper（upsertSelfAnalysisLogToSupabase）のみを使う。
 *     natural key (user_id, summary_input_hash) の onConflict なので dualWrite と衝突しない。
 *   - never throw。失敗は discriminated result で返す。
 *   - 全件成功時のみ flag を立てる。partial 失敗時は flag を立てず次回再試行。
 *   - env 未設定（no-env）が出た時点で中断し flag を立てない。
 *
 * 注:
 *   - selfAnalysisLogs は配列に上限が無い（tutor の MAX_THREADS/MESSAGES と異なる）。
 *     実運用では daily limit で件数が抑制される前提（schema preview §6）。
 *   - 本 STEP では未配線（誰も呼ばない）。後続 STEP-04C で AuthProvider の
 *     profileReady 後に dynamic import で起動する。
 */
export async function backfillSelfAnalysisLogsOnce(
  userId: string,
): Promise<BackfillSelfAnalysisLogsResult> {
  if (!userId) return { kind: 'skipped', reason: 'no-user' };
  if (backfillDone(userId, 'selfAnalysisLogs')) {
    return { kind: 'skipped', reason: 'already-done' };
  }

  const logs = loadSelfAnalysisLogs();
  if (logs.length === 0) {
    // 空でも flag は立てる（毎起動の無駄な判定を避ける。新規追記は dualWrite が担う）。
    markBackfillDone(userId, 'selfAnalysisLogs');
    return { kind: 'skipped', reason: 'empty' };
  }

  let failed = false;
  let logCount = 0;

  for (const log of logs) {
    const result = await upsertSelfAnalysisLogToSupabase({ userId, log });
    if (result.kind === 'no-env') return { kind: 'no-env' };
    if (result.kind !== 'ok') {
      failed = true;
      continue;
    }
    logCount += 1;
  }

  if (failed) return { kind: 'partial' };

  markBackfillDone(userId, 'selfAnalysisLogs');
  return { kind: 'ok', logCount };
}

// ── merge（SB → LS の one-way restore 用 pure 関数） ─────────────────

/**
 * localStorage の自己分析ログと Supabase から取得したログを merge する pure 関数。
 *
 * merge rule（STEP-04E-DESIGN §3）:
 *   - key は summaryInputHash（DB の UNIQUE(user_id, summary_input_hash) と一致）。
 *   - local のみ → 残す（未同期分。削除は非伝播）。
 *   - remote のみ → 追加（別端末で生まれた未取得分の復元）。
 *   - 両方存在 → updatedAt が新しい方を採用（last-write-wins）。
 *                createdAt は古い方（= 原本）を保持し、id も採用側ではなく
 *                「createdAt が古い方」に揃えて selectedLogId の安定性を保つ。
 *   - 削除は非伝播: remote に無い local log を消さない。
 *   - 返り値は createdAt 昇順（old → new）に正規化（LS 追加順と整合）。
 *   - 入力配列・要素を mutate しない（新しい配列／オブジェクトのみ返す）。
 *
 * 同一 summaryInputHash が local / remote で別 id の場合でも、key は hash なので
 * 1 件に収束する。id は createdAt が古い方（原本）を採用する。
 */
export function mergeSelfAnalysisLogs(
  localLogs: SelfAnalysisLog[],
  remoteLogs: SelfAnalysisLog[],
): SelfAnalysisLog[] {
  // hash → log の作業用 Map。local を先に入れ、remote で衝突判定する。
  const byHash = new Map<string, SelfAnalysisLog>();

  for (const log of localLogs) {
    byHash.set(log.summaryInputHash, log);
  }

  for (const remote of remoteLogs) {
    const local = byHash.get(remote.summaryInputHash);
    if (!local) {
      // remote のみ → 追加。
      byHash.set(remote.summaryInputHash, remote);
      continue;
    }

    // 両方存在 → updatedAt last-write-wins、createdAt は古い方を保持。
    // ISO 文字列の localeCompare で時刻比較する（persist は常に ISO 採番）。
    const newer = remote.updatedAt.localeCompare(local.updatedAt) > 0 ? remote : local;
    const older = remote.createdAt.localeCompare(local.createdAt) < 0 ? remote : local;
    byHash.set(remote.summaryInputHash, {
      ...newer,
      createdAt: older.createdAt,
      id: older.id,
    });
  }

  // createdAt 昇順に正規化。localeCompare で安定ソート。
  return Array.from(byHash.values()).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

// ── restore（SB → LS の one-way 復元・初回 1 回） ────────────────────

export type RestoreSelfAnalysisLogsResult =
  | { kind: 'ok'; mergedCount: number }
  | { kind: 'skipped'; reason: 'no-user' | 'already-done' }
  | { kind: 'no-env' }
  | { kind: 'error' };

/**
 * Supabase の自己分析ログを localStorage に one-way で merge restore する（初回 1 回）。
 *
 * 背景:
 *   backfill（上り）/ dualWrite が自端末分を SB へ送るのに対し、本関数は別端末で
 *   生まれたログを SB から取り込み、多端末で履歴を揃える「下り」経路（STEP-04E-DESIGN）。
 *   read 経路（loadMypageData / resume）は LS canonical のまま、書き戻しのみで復元する。
 *
 * 設計:
 *   - restore 用 flag（feature='selfAnalysisLogsRestore'）で完了済みなら skip。
 *     上り 'selfAnalysisLogs' とは別 key なので独立に 1 回走る。
 *   - hydrate（list）が no-env / error なら flag を立てず終了（次回再試行）。
 *   - remote 0 件でも flag は立てる（取り込むものが無いのは正常完了）。
 *   - mergeSelfAnalysisLogs で既存 LS を壊さず（削除非伝播・追加/更新のみ）書き戻す。
 *   - never throw。
 *
 * 注:
 *   - backfill→restore の順で起動するのが安全（自端末分を先に SB 確定させてから取り込む）。
 *   - 本 STEP では未配線（誰も呼ばない）。後続 STEP-04E-2 で AuthProvider に配線する。
 */
export async function restoreSelfAnalysisLogsOnce(
  userId: string,
): Promise<RestoreSelfAnalysisLogsResult> {
  if (!userId) return { kind: 'skipped', reason: 'no-user' };
  if (backfillDone(userId, 'selfAnalysisLogsRestore')) {
    return { kind: 'skipped', reason: 'already-done' };
  }

  const hydrated = await hydrateSelfAnalysisLogs(userId);
  if (hydrated.kind === 'no-env') return { kind: 'no-env' };
  if (hydrated.kind !== 'ok') {
    // error: flag を立てず次回再試行に委ねる。
    return { kind: 'error' };
  }

  const local = loadSelfAnalysisLogs();
  const merged = mergeSelfAnalysisLogs(local, hydrated.logs);
  saveSelfAnalysisLogs(merged);

  markBackfillDone(userId, 'selfAnalysisLogsRestore');
  return { kind: 'ok', mergedCount: merged.length };
}
