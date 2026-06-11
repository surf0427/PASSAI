// /api/matching 専用 JSON.parse ラッパ。
//
// 役割:
//   anthropic.messages.create() から返ってきた text を extractJson で純粋 JSON に整形し、
//   JSON.parse を generic 型 T として実行する。失敗時は原因把握に必要な最小限の情報だけを
//   ログに残してから throw して呼び出し側の try/catch に届ける（matching route の
//   per-call status log と組み合わせる前提）。
//
// 切り出し経緯:
//   元は app/api/matching/route.ts に同居していたが、route.ts が肥大化していたため
//   切り出した。AI 呼び出し経路 / MATCHING_SYSTEM_PROMPT / buildMatchingUserPrompt / cache
//   経路とは無関係の純粋ヘルパ。
//
// 注意:
//   - 戻り値の型 T は呼び出し側の type assertion に依存（generic として伝搬）。
//     実行時の shape 検証は呼び出し側で行う前提。
//   - parse 失敗ログには AI 出力**全文**を出さない。活動内容・志望校など個人情報が
//     ログに残るのを避けるため、length / 末尾 200 字 / parse error 名のみに留める。
//   - 影響範囲を matching に限定するため、本ファイルは lib/matching/ 配下に置く。
//     将来 lib/ai.ts への共通化候補にはなりうるが、本 STEP では行わない。

import { extractJson } from '@/lib/ai';

// JSON.parse を安全に行う
export function safeParseJson<T>(text: string): T {
  const textToParse = extractJson(text);
  try {
    return JSON.parse(textToParse) as T;
  } catch (error) {
    // AI 出力全文は出さない（個人情報・志望校情報のログ残留を防ぐ）。
    // 原因把握に必要な length / 末尾 200 字 / parse error 名 / メッセージのみ残す。
    console.error('matching: JSON parse failed', {
      textLength: textToParse.length,
      textTail: textToParse.slice(-200),
      errorName: error instanceof Error ? error.name : 'Unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
