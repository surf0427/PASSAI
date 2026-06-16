'use client';

// STEP-INTERVIEW-AI-PR1: interviewPracticeRecords repository layer（orchestration 層）。
//
// 位置づけ（statementReviewHistoryRepository.ts / selfPRRepository.ts と同じ 3 層構造の横展開）:
//   UI / interview ページ
//     ↓
//   lib/interviewRecordStorage.ts … LS canonical（key='interview_records'）
//     ↓
//   lib/repository/interviewPracticeRecordRepository.ts … 本ファイル。orchestration（いつ / 何件 / 冪等 / flag）
//     ↓ 委譲
//   lib/supabase/interviewPracticeRecords.ts … DB 境界（SQL / snake_case 翻訳 / RLS / best-effort）
//     ↓
//   Supabase（interview_practice_records）
//
// 提供関数と PR 対応:
//   - mirrorInterviewPracticeRecordOnce  … PR1。1 件 mirror の単一 entry point（upsert 委譲）。
//   - backfillInterviewPracticeRecordsOnce … PR2。初回一括 LS → Supabase（上りのみ）。
//
// 契約:
//   - 既存 lib/supabase/interviewPracticeRecords.ts への委譲のみ。
//   - never throw。委譲先（DB 境界）が既に best-effort（void / 空配列）なので、本層も
//     それをそのまま受け、UI を壊さない。
//   - 上り（LS → Supabase）のみ。read-through / restore / down-sync / tombstone は実装しない。
//     delete 伝播もしない（delete resurrection 回避。schema preview §8）。
//
// grep target の集約:
//   app 側は本ファイルの entry point だけを import すれば済むよう、mirror dispatch の
//   入口を 1 箇所に寄せる。
//
// boundary 安全:
//   委譲先 interviewPracticeRecords.ts は "use client"（browserClient 依存）。本ファイルも
//   "use client" を宣言し、server bundle に browser client を引き込まないことを明示する。

import { upsertInterviewPracticeRecordToSupabase } from '@/lib/supabase/interviewPracticeRecords';
import {
  getInterviewRecords,
  type StoredInterviewRecord,
} from '@/lib/interviewRecordStorage';
import { backfillDone, markBackfillDone } from './backfillFlag';

/**
 * 1 件の面接練習記録（StoredInterviewRecord）を Supabase durable mirror に upsert する単一 entry point。
 *
 * - natural key (user_id, local_record_id) の冪等 upsert に委譲するだけ。
 *   記録は in-place 編集されないので、同一 record の再 mirror は安全（同一内容の DO UPDATE）。
 * - release 前は LS → Supabase の上り方向のみ。delete / restore は伝播しない
 *   （delete 伝播は PR2 の dualWrite で propagateDelete=true のときのみ）。
 * - userId が空なら no-op。委譲先が best-effort（never throw）なので本層も throw しない。
 *
 * 配線想定:
 *   PR2 — AuthProvider から backfill 用途で複数件ループ呼び出し（backfill 関数は PR2 で追加）。
 *   PR2 — app/interview/record の保存成功直後に 1 件呼び出し（dualWrite から）。
 *   本 PR では未配線（誰も呼ばない）。
 */
export async function mirrorInterviewPracticeRecordOnce(args: {
  userId: string;
  record: StoredInterviewRecord;
}): Promise<void> {
  if (!args.userId) return;
  await upsertInterviewPracticeRecordToSupabase({
    userId: args.userId,
    record: args.record,
  });
}

// ── backfill（初回一括 LS → SB） ────────────────────────────────────

/**
 * 現在の localStorage の面接練習記録（interview_records）を Supabase へ一括同期する
 * （初回 1 回）。STEP-INTERVIEW-AI-PR2。
 *
 * 背景:
 *   create-site mirror（PR2 で InterviewRecordForm に配線）は配線後の新規保存のみを
 *   mirror するため、配線前に蓄積された既存 LS 記録は Supabase に上がらない。その「上り」の
 *   欠落を backfill が埋める（backfillStatementReviewHistoryOnce と同趣旨）。
 *
 * 設計（statementReviewHistory と同形 — id natural key / 上りのみ / restore なし）:
 *   - userId が無ければ no-op。
 *   - browser でなければ no-op（SSR で localStorage を読まない）。getInterviewRecords は
 *     safeStorage 経由で SSR 安全だが、明示 guard で意図を示す。
 *   - flag（backfillFlag.ts, feature='interviewPracticeRecords'）で完了済みなら skip。
 *   - localStorage が 0 件なら no-op（flag は立てない。次回も安価に再判定するだけ）。
 *   - 各 record を冪等 helper mirrorInterviewPracticeRecordOnce で upsert。natural key
 *     (user_id, local_record_id) の onConflict なので、後続の create-site mirror と衝突しない。
 *   - 委譲先は never throw（失敗は devWarn で握り潰す best-effort）。逐次 await でも 1 件の
 *     失敗で全体は落ちない。
 *   - 全件 upsert 後に flag を立てる。flag は correctness ではなく最適化であり、冪等 upsert
 *     なので flag リセット後の再実行も無害（backfillFlag.ts 設計）。
 *
 * 上り mirror only（重要）:
 *   - DB → LS restore はしない（listInterviewPracticeRecordsFromSupabase は使わない）。
 *   - LS の id 削除を DB delete として扱わない（propagateDelete=false 相当）。delete 伝播は
 *     delete resurrection を招くため別 STEP（schema preview §8）。
 *
 * 注: 本 STEP では AuthProvider から fire-and-forget で起動する（PR2 配線）。
 */
export async function backfillInterviewPracticeRecordsOnce(args: {
  userId: string;
}): Promise<void> {
  const { userId } = args;
  if (!userId) return;
  if (typeof window === 'undefined') return; // SSR では LS を読まない
  if (backfillDone(userId, 'interviewPracticeRecords')) return;

  const records = getInterviewRecords();
  if (records.length === 0) return; // 0 件 → no-op（flag は立てない）

  for (const record of records) {
    await mirrorInterviewPracticeRecordOnce({ userId, record });
  }

  markBackfillDone(userId, 'interviewPracticeRecords');
}
