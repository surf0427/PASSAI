// PASSAI 受験チューターAI 用 suggestedFeature 判定ヘルパー（実装 STEP6）。
//
// 役割:
//   - intent から UI 側で表示する「次に進む候補機能」を導出する
//   - AI 応答末尾の「→ 〜してみるのもアリです」とは別経路（intent ベースで先回り提案）
//
// なぜ intent ベースか:
//   - AI 応答が来る前から「これは志望理由書系の相談だな」と UI が把握できる
//   - 入口 chip クリックや message 内容から推定された intent をそのまま使う
//   - AI 応答との二重表示にならないよう、UI 側で表示優先度を制御する想定
//
// 純粋関数: fetch / localStorage / Supabase / Date / Math.random / console 一切なし。
//
// 関連: [lib/tutor/types.ts](./types.ts)（TutorIntent / TutorFeature）
//       [lib/tutor/detectTutorIntent.ts](./detectTutorIntent.ts)

import type { TutorIntent, TutorFeature } from './types';

export function detectTutorSuggestedFeature(input: {
  intent: TutorIntent;
  message: string;
}): TutorFeature | null {
  // input.message は intent='general' で keyword scan を将来追加する場合の足場として
  // signature に残してある。現状は intent ベースの単純マッピングのみ。
  // detectTutorIntent が 'general' を返した時点で message に feature keyword は
  // 含まれていない（intent 判定と同じ keyword セットを使うため）ので、現状 message は未使用。
  void input.message;

  switch (input.intent) {
    case 'statement':
      return 'statement';
    case 'interview':
      return 'interview';
    case 'self_analysis':
      return 'self_analysis';
    case 'selfpr':
      return 'selfpr';
    case 'stabilize':
      // SYSTEM PROMPT [F] と整合: 安定化モード時は機能接続を出さない
      return null;
    case 'general':
    default:
      return null;
  }
}
