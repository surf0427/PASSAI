// STEP-CHAT-HISTORY-01: Tutor チャット履歴の型定義。
//
// 役割:
//   ChatGPT 風のスレッド管理を localStorage で実現するための shape を定義する。
//   既存 lib/tutor/types.ts の TutorIntent / TutorChatSuccess / TutorChatError とは
//   別レイヤー（前者は API I/O 用、本ファイルは client 永続化用）。

export type TutorMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string; // ISO 文字列
};

export type TutorChatThread = {
  id: string;
  title: string;
  messages: TutorMessage[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

// localStorage に保存する store の trim 済み shape。
// version は将来の migration（schema 変更）に備える int。
export type TutorChatStore = {
  threads: TutorChatThread[];
  currentThreadId: string | null;
  version: number;
};

// ── STEP-CHAT-PERSISTENCE-01: Supabase 側の shape ─────────────────────
//
// localStorage canonical を維持したまま auth-scoped で同期するための型。
// camelCase は API 境界の helper が DB の snake_case を内部翻訳した結果。

export type SupabaseTutorRole = 'user' | 'assistant' | 'system';

export type SupabaseTutorThread = {
  /** tutor_chat_threads.id (uuid)。Supabase 側の主キー。 */
  id: string;
  /** auth.users.id。所有者判定はこちら（localStorage の id ではない）。 */
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  /** localStorage の TutorChatThread.id。upsert の natural key 部分。 */
  localThreadId: string | null;
  metadata: Record<string, unknown>;
};

export type SupabaseTutorMessage = {
  id: string;
  threadId: string;
  userId: string;
  role: SupabaseTutorRole;
  content: string;
  createdAt: string;
  localMessageId: string | null;
  metadata: Record<string, unknown>;
};

/** lib/supabase/tutorChat.ts の helper 戻り値共通 shape。失敗を throw せず返す。 */
export type TutorChatSyncResult =
  | { kind: 'ok' }
  | { kind: 'no-env' }
  | { kind: 'error'; message: string };
