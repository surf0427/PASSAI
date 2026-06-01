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
