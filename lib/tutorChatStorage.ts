// STEP-CHAT-HISTORY-01: Tutor のスレッド管理 storage 層。
//
// 役割:
//   - 複数のチャット thread を localStorage に保存・取得する
//   - 旧 single-chat 保存（もし存在すれば）を初回起動時に 1 thread へ migration する
//
// 保存形式:
//   localStorage key: 'tutorChatThreads'
//   value: { threads: TutorChatThread[]; currentThreadId: string | null; version: 1 }
//
// 設計方針:
//   - Auth / Stripe / user_id には触らない。匿名 localStorage のみ。
//   - safeStorage を経由して SSR / 例外時の落下を防ぐ。
//   - migration は try/catch で防御。旧 key が無い / 破損していても全体は壊さない。
//   - thread 数の上限は 50 件（古いものから自動削除）。localStorage quota 対策。
//   - thread 内 message 数の上限は 200 件（送信時は最新 6 件のみ history としてサーバへ送る既存仕様は維持）。

import { safeGetStorage, safeSetStorage } from '@/lib/storage/safeStorage';
import type { TutorChatThread, TutorChatStore, TutorMessage } from '@/types/tutorChat';

const STORAGE_KEY = 'tutorChatThreads';
const MAX_THREADS = 50;
const MAX_MESSAGES_PER_THREAD = 200;
const CURRENT_VERSION = 1;

// 旧 single-chat 保存があった場合の想定 key（防御的に複数候補をチェック）。
// 現状の app/tutor/page.tsx は in-memory のみで localStorage に保存していないため、
// 通常はどの候補も存在しない。将来 / 過去の互換のため defensive に書く。
const LEGACY_KEYS = ['tutorChat', 'tutorChatHistory', 'tutorMessages'] as const;

function emptyStore(): TutorChatStore {
  return { threads: [], currentThreadId: null, version: CURRENT_VERSION };
}

function generateId(): string {
  // crypto.randomUUID() は modern browser ですべて利用可能だが、SSR / older runtime での
  // 互換性を考慮して fallback を持つ。collision 防止は単発 chat thread 用途で十分。
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to fallback
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 旧 single-chat 保存があれば 1 thread に変換する。
// LEGACY_KEYS のいずれかから { messages: TutorMessage[] } もしくは TutorMessage[] を読み込み、
// 新しい thread 1 件として store に追加する。元の legacy data は削除しない（要件: データ削除禁止）。
function tryMigrateLegacy(): TutorChatThread | null {
  if (typeof window === 'undefined') return null;
  for (const key of LEGACY_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      // 想定 shape: { messages: [...] } もしくは [...]
      const rawMessages: unknown = Array.isArray(parsed) ? parsed : parsed?.messages;
      if (!Array.isArray(rawMessages) || rawMessages.length === 0) continue;
      const messages: TutorMessage[] = rawMessages
        .filter((m): m is { role?: unknown; text?: unknown; content?: unknown } =>
          typeof m === 'object' && m !== null,
        )
        .map((m): TutorMessage => {
          const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user';
          const content =
            typeof m.content === 'string'
              ? m.content
              : typeof m.text === 'string'
                ? m.text
                : '';
          return {
            id: generateId(),
            role,
            content,
            createdAt: new Date().toISOString(),
          };
        })
        .filter((m) => m.content.trim() !== '');
      if (messages.length === 0) continue;
      const now = new Date().toISOString();
      return {
        id: generateId(),
        title: deriveThreadTitle(messages[0].content),
        messages,
        createdAt: now,
        updatedAt: now,
      };
    } catch {
      // ignore single legacy key parse failure, try next
    }
  }
  return null;
}

// 最初のユーザー発言からタイトルを生成する。AI は使わない（要件: AI 禁止）。
// ルール: 20〜30 文字程度・空なら「新しい相談」。
export function deriveThreadTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim();
  if (trimmed === '') return '新しい相談';
  // 改行 / 連続空白は 1 つに畳む
  const normalized = trimmed.replace(/\s+/g, ' ');
  // 30 文字を超えたら 28 文字 + … にする（ちょうど 30 字以内に収まる UX）
  if (normalized.length <= 30) return normalized;
  return `${normalized.slice(0, 28)}…`;
}

export function loadTutorChatStore(): TutorChatStore {
  const raw = safeGetStorage<TutorChatStore | null>(STORAGE_KEY, null);
  if (raw && Array.isArray(raw.threads)) {
    return {
      threads: raw.threads,
      currentThreadId: raw.currentThreadId ?? null,
      version: raw.version ?? CURRENT_VERSION,
    };
  }
  // 新規 / 破損 / null → 旧 single-chat があれば migration を試行
  const store = emptyStore();
  try {
    const migrated = tryMigrateLegacy();
    if (migrated) {
      store.threads = [migrated];
      store.currentThreadId = migrated.id;
      safeSetStorage(STORAGE_KEY, store);
    }
  } catch {
    // migration 失敗時は空 store を返す（既存 legacy data は触らない）
  }
  return store;
}

export function saveTutorChatStore(store: TutorChatStore): void {
  // thread 数 / message 数の上限を守る defensive write
  const trimmedThreads = store.threads
    .map((t) => ({
      ...t,
      messages:
        t.messages.length > MAX_MESSAGES_PER_THREAD
          ? t.messages.slice(-MAX_MESSAGES_PER_THREAD)
          : t.messages,
    }))
    // 更新日時の新しい順にソートし、上限を超えた古い thread を捨てる
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_THREADS);
  safeSetStorage(STORAGE_KEY, {
    threads: trimmedThreads,
    currentThreadId: store.currentThreadId,
    version: CURRENT_VERSION,
  });
}

// 新規 thread を作成して store に追加する。新 thread は currentThreadId にセットされる。
export function createNewThread(store: TutorChatStore): TutorChatStore {
  const now = new Date().toISOString();
  const newThread: TutorChatThread = {
    id: generateId(),
    title: '新しい相談',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...store,
    threads: [newThread, ...store.threads],
    currentThreadId: newThread.id,
  };
}

// 指定 id の thread を削除する。currentThreadId が削除対象だった場合は新しい最新 thread を選ぶ。
export function deleteThread(store: TutorChatStore, threadId: string): TutorChatStore {
  const remaining = store.threads.filter((t) => t.id !== threadId);
  let nextCurrent: string | null = store.currentThreadId;
  if (nextCurrent === threadId) {
    nextCurrent = remaining.length > 0 ? remaining[0].id : null;
  }
  return { ...store, threads: remaining, currentThreadId: nextCurrent };
}

export function setCurrentThread(store: TutorChatStore, threadId: string): TutorChatStore {
  if (!store.threads.some((t) => t.id === threadId)) return store;
  return { ...store, currentThreadId: threadId };
}

// 指定 thread に message を append。title が「新しい相談」かつ最初の user message なら title を更新。
export function appendMessage(
  store: TutorChatStore,
  threadId: string,
  message: Omit<TutorMessage, 'id' | 'createdAt'>,
): TutorChatStore {
  const now = new Date().toISOString();
  const newMessage: TutorMessage = {
    id: generateId(),
    createdAt: now,
    ...message,
  };
  const threads = store.threads.map((t) => {
    if (t.id !== threadId) return t;
    const nextMessages = [...t.messages, newMessage];
    const shouldUpdateTitle =
      t.title === '新しい相談' &&
      message.role === 'user' &&
      t.messages.every((m) => m.role !== 'user');
    return {
      ...t,
      messages: nextMessages,
      title: shouldUpdateTitle ? deriveThreadTitle(message.content) : t.title,
      updatedAt: now,
    };
  });
  return { ...store, threads };
}

export function getThread(
  store: TutorChatStore,
  threadId: string | null,
): TutorChatThread | null {
  if (!threadId) return null;
  return store.threads.find((t) => t.id === threadId) ?? null;
}
