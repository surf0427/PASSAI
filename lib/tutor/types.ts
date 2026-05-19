// PASSAI 受験チューターAI の最小型定義（実装 STEP1）。
//
// 役割:
//   - TutorIntent          : client / context builder / route で共有する相談カテゴリ enum
//   - TutorFeature         : AI 応答末尾の機能接続候補 4 種
//   - TutorChatSuccess     : API レスポンス（成功）
//   - TutorChatError       : API レスポンス（エラー）
//   - PreferredProfileField: context builder で引く StudentProfile field 指定
//
// 後続 STEP での消費予定:
//   - lib/contextBuilders/tutor/*     (STEP3)
//   - lib/tutor/tutorPrompt.ts        (STEP2 / 4)
//   - app/api/tutor/route.ts          (STEP5)
//   - lib/tutor/detectTutorIntent.ts  (STEP6)
//   - app/tutor/page.tsx              (STEP8)
//   - lib/tutor/parseTutorReply.ts    (STEP9)
//
// 本ファイルは type-only。runtime 側からの import は後続 STEP まで発生しない。
//
// 関連: lib/aiInputHash.ts (TUTOR_PROMPT_VERSION / TUTOR_MODEL)

// 受験生の相談カテゴリ。client (chip 選択 + keyword 検出) で判定し、
// route 経由で context builder に渡される。
// 'stabilize' はメルトダウン signal 検出時の特例 mode（安定化モード）。
export type TutorIntent =
  | 'general'
  | 'statement'
  | 'interview'
  | 'self_analysis'
  | 'selfpr'
  | 'stabilize';

// AI 応答末尾の「→ 〜してみるのもアリです」で接続する PASSAI 内機能。
// 4 機能に固定（hallucination 防止）。matching / 小論文 は意図的に含めない:
//   - matching は「進路決定」機能であり整理フェーズの導線対象外
//   - 小論文は本文を既に持っているユーザー向けで tutor の入口とは噛み合わない
export type TutorFeature =
  | 'self_analysis'
  | 'statement'
  | 'interview'
  | 'selfpr';

// API レスポンス（成功時）。
// plain text を reply に 1 つだけ入れる最小構造（essay-chat 系譜）。
// suggestedFeature / mode / intent などは別 field で返さず、UI 側で
// reply 末尾の「→ ...」をパースして機能接続ボタンを生成する設計。
export type TutorChatSuccess = {
  reply: string;
};

// API レスポンス（エラー時）。
// error は構造化コード（例: 'AI_REPLY_TRUNCATED' / 'MESSAGE_TOO_LONG'）、
// message はユーザー向け日本語文言。既存 essay-chat / interview-questions と同形。
export type TutorChatError = {
  error: string;
  message: string;
};

// context builder で「今回引く StudentProfile の field」を指定するための型。
// client 側で前回引いた field を localStorage に保持し、次ターンで別 field を
// 渡すことで「2 ターン連続で同じ要素を引かない」を実現する（張り付き感防止）。
export type PreferredProfileField = 'strengths' | 'weaknesses';
