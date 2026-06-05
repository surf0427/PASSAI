'use client';

// STEP-SUPABASE-COMPLETE-03A: Tutor repository layer（orchestration 層）。
//
// 位置づけ（STEP-SUPABASE-COMPLETE-01 / 02 で確定した 3 層構造）:
//   UI / loadMypageData
//     ↓
//   lib/*Storage.ts            … LS canonical（同期・facade）
//     ↓
//   lib/repository/*.ts        … 本ファイル。orchestration（いつ / 何件 / 冪等 / flag）
//     ↓ 委譲
//   lib/supabase/tutorChat.ts  … DB 境界（SQL / snake_case 翻訳 / RLS / never throw）
//     ↓
//   Supabase（tutor_chat_threads / tutor_chat_messages）
//
// 本 STEP の契約:
//   - **純追加**。誰からも呼ばれない（AuthProvider / page.tsx は未変更）。
//   - 既存 lib/supabase/tutorChat.ts への **委譲のみ**。SQL 追加・既存処理書き換えなし。
//   - hydrate / restore / dualWrite は薄い pass-through（戻り値は委譲先の型をそのまま）。
//   - backfillTutorOnce のみ新規 orchestration。初回 1 回だけ LS 全 thread を
//     既存の冪等 upsert helper で一括同期する。flag は backfillFlag.ts に委譲。
//
// boundary 安全:
//   委譲先 tutorChat.ts は "use client"（browserClient 依存）。本ファイルも
//   "use client" を宣言し、server bundle に browser client を引き込まないことを明示する。
//   後続 STEP では AuthProvider / page.tsx から dynamic import で呼ぶ想定。

import {
  ensureTutorThreadInSupabase,
  listTutorThreadsFromSupabase,
  loadTutorMessagesFromSupabase,
  mirrorTutorStoreDelta,
  saveTutorMessageToSupabase,
  type ListTutorThreadsResult,
  type LoadTutorMessagesResult,
} from '@/lib/supabase/tutorChat';
import { loadTutorChatStore } from '@/lib/tutorChatStorage';
import type { TutorChatStore } from '@/types/tutorChat';
import { backfillDone, markBackfillDone } from './backfillFlag';

// ── hydrate（SB → 一覧取得・自動表示用） ─────────────────────────────
//
// 既存 app/tutor/page.tsx:233 が直接呼んでいる listTutorThreadsFromSupabase の
// orchestration 入口。挙動は完全に同一（pass-through）。
export function hydrateTutor(userId: string): Promise<ListTutorThreadsResult> {
  return listTutorThreadsFromSupabase(userId);
}

// ── restore（SB → 指定 thread の message 取得・手動復元の中身） ──────
//
// 既存 app/tutor/page.tsx:491 が直接呼んでいる loadTutorMessagesFromSupabase の
// orchestration 入口。挙動は完全に同一（pass-through）。
export function restoreTutorThread(input: {
  userId: string;
  threadId: string;
}): Promise<LoadTutorMessagesResult> {
  return loadTutorMessagesFromSupabase(input);
}

// ── dualWrite（LS 書き込み後の差分ミラー） ──────────────────────────
//
// 既存 app/tutor/page.tsx:257 が直接呼んでいる mirrorTutorStoreDelta の
// orchestration 入口。挙動は完全に同一（pass-through）。
export function dualWriteTutor(input: {
  prev: TutorChatStore | null;
  next: TutorChatStore;
  userId: string;
}): Promise<void> {
  return mirrorTutorStoreDelta(input);
}

// ── backfill（初回一括 LS → SB） ────────────────────────────────────

export type BackfillTutorResult =
  | { kind: 'ok'; threadCount: number; messageCount: number }
  | { kind: 'skipped'; reason: 'no-user' | 'already-done' | 'empty' }
  | { kind: 'no-env' }
  | { kind: 'partial' };

/**
 * 現在の localStorage 全 thread を Supabase へ一括同期する（初回 1 回）。
 *
 * 背景:
 *   差分ミラー（mirrorTutorStoreDelta）は初回マウントを skip するため
 *   （lib/supabase/tutorChat.ts:278）、ミラー導入前に蓄積された thread や
 *   当該セッションで一度も追記しない既存 thread は Supabase に上がらない。
 *   その「上り」の欠落を backfill が埋める。
 *
 * 設計:
 *   - flag（backfillFlag.ts）で完了済みなら skip。
 *   - 既存の冪等 helper（ensureTutorThreadInSupabase / saveTutorMessageToSupabase）
 *     のみを使う。natural key + ignoreDuplicates で差分ミラーと衝突しない。
 *   - never throw。失敗は discriminated result で返す。
 *   - thread / message の上限は LS 側で有界（MAX_THREADS=50 / MAX_MESSAGES=200,
 *     lib/tutorChatStorage.ts:22-23）。
 *   - 全件成功時のみ flag を立てる。partial 失敗時は flag を立てず次回再試行。
 *   - env 未設定（no-env）が出た時点で中断し flag を立てない。
 *
 * 注:
 *   本 STEP では未配線（誰も呼ばない）。後続 STEP-03B で AuthProvider の
 *   profileReady 後に dynamic import で起動する。
 */
export async function backfillTutorOnce(
  userId: string,
): Promise<BackfillTutorResult> {
  if (!userId) return { kind: 'skipped', reason: 'no-user' };
  if (backfillDone(userId, 'tutor')) {
    return { kind: 'skipped', reason: 'already-done' };
  }

  const store = loadTutorChatStore();
  if (store.threads.length === 0) {
    // 空でも flag は立てる（毎起動の無駄な判定を避ける。新規追記は差分ミラーが担う）。
    markBackfillDone(userId, 'tutor');
    return { kind: 'skipped', reason: 'empty' };
  }

  let failed = false;
  let messageCount = 0;

  for (const thread of store.threads) {
    // thread 行を先に確保する（message が 0 件の空 thread も Supabase に作る）。
    const lastMessageAt =
      thread.messages.at(-1)?.createdAt ?? thread.updatedAt ?? null;
    const ensured = await ensureTutorThreadInSupabase({
      userId,
      localThreadId: thread.id,
      title: thread.title,
      lastMessageAt,
    });
    if (ensured.kind === 'no-env') return { kind: 'no-env' };
    if (ensured.kind !== 'ok') {
      // この thread は失敗扱い。message へ進まず次 thread へ。
      failed = true;
      continue;
    }

    for (const message of thread.messages) {
      const result = await saveTutorMessageToSupabase({
        userId,
        localThreadId: thread.id,
        threadTitle: thread.title,
        localMessageId: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      });
      if (result.kind === 'no-env') return { kind: 'no-env' };
      if (result.kind !== 'ok') {
        failed = true;
        continue;
      }
      messageCount += 1;
    }
  }

  if (failed) return { kind: 'partial' };

  markBackfillDone(userId, 'tutor');
  return { kind: 'ok', threadCount: store.threads.length, messageCount };
}
