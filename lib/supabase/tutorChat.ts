"use client";

/**
 * STEP-CHAT-PERSISTENCE-01: Tutor Chat の auth-scoped 永続化（同期先）。
 *
 * 設計方針:
 *   - localStorage canonical は維持。本ファイルは "同期先 / mirror 的扱い"。
 *   - 失敗時は never throw。すべて discriminated result で返す。
 *   - 所有者判定 / RLS / 保存キーには常に auth.users.id を使う。
 *     display_user_id は触らない（表示用の別 namespace）。
 *   - DB 側の `tutor_chat_threads` / `tutor_chat_messages` の RLS は
 *     auth.uid() = user_id を強制する（supabase/schema.sql §21 / §23）。
 *   - dev 環境のみ devWarn で観測可能性を残す（production は無音）。
 *
 * Phase boundary 観点:
 *   - 本 table は Phase1 mirror N=4 の凍結対象には含まれない（auth-scoped で
 *     mirror_events / 共有 source_hash 経由ではない別系統）。
 *   - phase2_auth_boundary.md の "anonymous session creation /
 *     currentUserId expose / profile auto-ensure / display_user_id" の
 *     範囲を一歩超えた auth-scoped 永続層を導入するため、後続 STEP で
 *     phase2_auth_boundary.md の更新（または phase3 doc 起票）が推奨。
 */

import { devWarn } from "@/lib/devLog";
import { getBrowserSupabaseClient } from "./browserClient";
import type {
  SupabaseTutorMessage,
  SupabaseTutorRole,
  SupabaseTutorThread,
  TutorChatStore,
  TutorChatSyncResult,
} from "@/types/tutorChat";

const THREADS_TABLE = "tutor_chat_threads";
const MESSAGES_TABLE = "tutor_chat_messages";

type ThreadRow = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  local_thread_id: string | null;
  metadata: Record<string, unknown>;
};

type MessageRow = {
  id: string;
  thread_id: string;
  user_id: string;
  role: SupabaseTutorRole;
  content: string;
  created_at: string;
  local_message_id: string | null;
  metadata: Record<string, unknown>;
};

function rowToThread(row: ThreadRow): SupabaseTutorThread {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    localThreadId: row.local_thread_id,
    metadata: row.metadata ?? {},
  };
}

function rowToMessage(row: MessageRow): SupabaseTutorMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    localMessageId: row.local_message_id,
    metadata: row.metadata ?? {},
  };
}

export type EnsureTutorThreadResult =
  | { kind: "ok"; threadId: string }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * thread 行を idempotent に upsert する。
 *
 * - natural key: (user_id, local_thread_id)
 * - title / last_message_at / metadata は呼び出しごとに更新される
 *   （新しい message が来たときに last_message_at が前進するため）。
 */
export async function ensureTutorThreadInSupabase(input: {
  userId: string;
  localThreadId: string;
  title: string;
  lastMessageAt?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<EnsureTutorThreadResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  try {
    const { data, error } = await supabase
      .from(THREADS_TABLE)
      .upsert(
        {
          user_id: input.userId,
          local_thread_id: input.localThreadId,
          title: input.title,
          last_message_at: input.lastMessageAt ?? null,
          metadata: input.metadata ?? {},
        },
        { onConflict: "user_id,local_thread_id" },
      )
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) {
      devWarn("[tutorChat] ensureTutorThreadInSupabase error", error);
      return { kind: "error", message: error.message };
    }
    if (!data) {
      return { kind: "error", message: "thread upsert returned no row" };
    }
    return { kind: "ok", threadId: data.id };
  } catch (err) {
    devWarn("[tutorChat] ensureTutorThreadInSupabase threw", err);
    const message = err instanceof Error ? err.message : "ensure thread threw";
    return { kind: "error", message };
  }
}

/**
 * 単一 message を保存する。事前に thread を upsert する。
 *
 * - 同じ (thread_id, local_message_id) で既存行がある場合は no-op。
 *   `ignoreDuplicates: true` により unique 違反は黙って skip される。
 */
export async function saveTutorMessageToSupabase(input: {
  userId: string;
  localThreadId: string;
  threadTitle: string;
  localMessageId: string;
  role: SupabaseTutorRole;
  content: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}): Promise<TutorChatSyncResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  const ensured = await ensureTutorThreadInSupabase({
    userId: input.userId,
    localThreadId: input.localThreadId,
    title: input.threadTitle,
    lastMessageAt: input.createdAt ?? new Date().toISOString(),
  });
  if (ensured.kind !== "ok") return ensured;

  try {
    const { error } = await supabase.from(MESSAGES_TABLE).upsert(
      {
        thread_id: ensured.threadId,
        user_id: input.userId,
        local_message_id: input.localMessageId,
        role: input.role,
        content: input.content,
        created_at: input.createdAt ?? new Date().toISOString(),
        metadata: input.metadata ?? {},
      },
      { onConflict: "thread_id,local_message_id", ignoreDuplicates: true },
    );
    if (error) {
      devWarn("[tutorChat] saveTutorMessageToSupabase error", error);
      return { kind: "error", message: error.message };
    }
    return { kind: "ok" };
  } catch (err) {
    devWarn("[tutorChat] saveTutorMessageToSupabase threw", err);
    const message = err instanceof Error ? err.message : "save message threw";
    return { kind: "error", message };
  }
}

export type ListTutorThreadsResult =
  | { kind: "ok"; threads: SupabaseTutorThread[] }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * 自分の thread 一覧を最新更新順で返す。RLS により他人の行は取れない。
 * 本 STEP の UI からは未参照だが、左サイドバー / マイページ集計の前段として用意。
 */
export async function listTutorThreadsFromSupabase(
  userId: string,
): Promise<ListTutorThreadsResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  try {
    const { data, error } = await supabase
      .from(THREADS_TABLE)
      .select(
        "id, user_id, title, created_at, updated_at, last_message_at, local_thread_id, metadata",
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) {
      devWarn("[tutorChat] listTutorThreadsFromSupabase error", error);
      return { kind: "error", message: error.message };
    }
    const rows = (data ?? []) as ThreadRow[];
    return { kind: "ok", threads: rows.map(rowToThread) };
  } catch (err) {
    devWarn("[tutorChat] listTutorThreadsFromSupabase threw", err);
    const message = err instanceof Error ? err.message : "list threads threw";
    return { kind: "error", message };
  }
}

export type LoadTutorMessagesResult =
  | { kind: "ok"; messages: SupabaseTutorMessage[] }
  | { kind: "no-env" }
  | { kind: "error"; message: string };

/**
 * 指定 thread の message を created_at 昇順で返す。userId は冗長 guard
 * （RLS が同条件を強制するが、誤った request を出さないための念押し）。
 */
export async function loadTutorMessagesFromSupabase(input: {
  userId: string;
  threadId: string;
}): Promise<LoadTutorMessagesResult> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return { kind: "no-env" };

  try {
    const { data, error } = await supabase
      .from(MESSAGES_TABLE)
      .select(
        "id, thread_id, user_id, role, content, created_at, local_message_id, metadata",
      )
      .eq("user_id", input.userId)
      .eq("thread_id", input.threadId)
      .order("created_at", { ascending: true });
    if (error) {
      devWarn("[tutorChat] loadTutorMessagesFromSupabase error", error);
      return { kind: "error", message: error.message };
    }
    const rows = (data ?? []) as MessageRow[];
    return { kind: "ok", messages: rows.map(rowToMessage) };
  } catch (err) {
    devWarn("[tutorChat] loadTutorMessagesFromSupabase threw", err);
    const message = err instanceof Error ? err.message : "load messages threw";
    return { kind: "error", message };
  }
}

/**
 * prev → next の差分から、新規 thread と新規 message を Supabase に同期する。
 *
 * - prev=null の初回起動時は何もしない（過去履歴の一括移行は本 STEP の非ゴール）。
 * - prev に無い thread.id（= 新 thread）はその全 message を mirror。
 * - prev に既存 thread でも message が増えていれば差分のみ mirror。
 * - 失敗は devWarn のみで握り潰し、UI には伝えない。
 *
 * 本 helper は呼び出し側（app/tutor/page.tsx）が prev を ref で保持して渡す。
 */
export async function mirrorTutorStoreDelta(input: {
  prev: TutorChatStore | null;
  next: TutorChatStore;
  userId: string;
}): Promise<void> {
  if (!input.prev) return; // 初回マウント時は同期しない
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return;

  const prevThreadsById = new Map(input.prev.threads.map((t) => [t.id, t]));

  for (const nextThread of input.next.threads) {
    const prevThread = prevThreadsById.get(nextThread.id);
    const prevMessageIds = new Set(
      (prevThread?.messages ?? []).map((m) => m.id),
    );
    const newMessages = nextThread.messages.filter(
      (m) => !prevMessageIds.has(m.id),
    );

    const isNewThread = prevThread === undefined;
    const titleChanged =
      prevThread !== undefined && prevThread.title !== nextThread.title;

    if (!isNewThread && newMessages.length === 0 && !titleChanged) {
      continue;
    }

    const lastNew = newMessages.at(-1);
    const ensured = await ensureTutorThreadInSupabase({
      userId: input.userId,
      localThreadId: nextThread.id,
      title: nextThread.title,
      lastMessageAt: lastNew?.createdAt ?? prevThread?.updatedAt ?? null,
    });
    if (ensured.kind !== "ok") continue;

    for (const msg of newMessages) {
      // 並列ではなく直列 (await) で送る。同一 thread 内の順序保証 + per-tab
      // からの過剰な並列リクエスト抑制のため。失敗は中で握り潰される。
      await saveTutorMessageToSupabase({
        userId: input.userId,
        localThreadId: nextThread.id,
        threadTitle: nextThread.title,
        localMessageId: msg.id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
      });
    }
  }
}
