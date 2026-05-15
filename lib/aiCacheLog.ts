// STEP5.2: AI call の cache hit / miss を観測する独立ログレーン。
//
// 役割:
//   "AI を呼ばなかった瞬間" / "AI を呼ぶ必要があった瞬間" を log 1 行で記録する。
//   `ai usage`（lib/aiUsageLog.ts）は「実 AI call の token 量」を測る別レーン。
//   両者は責務が異なるため key を分け、互いの contract を変更しない。
//
// 個人情報ガード:
//   payload に含めるのは静的識別子（route / action / inputHash）のみ。
//   inputHash は djb2 base36 の固定長文字列で、元入力は復元不可。
//   request body / prompt / 出力本文は絶対に含めない。
//
// 関連:
//   - lib/aiInputHash.ts
//   - lib/wallHittingInputHashStorage.ts
//   - docs/principles/ai_cache_observability.md
//   - docs/principles/ai_usage_observability.md（混同しないこと）

export type AiCacheAction = 'hit' | 'miss';

export type LogAiCacheEvent = {
  route: string;
  action: AiCacheAction;
  inputHash: string;
};

export function logAiCache(event: LogAiCacheEvent): void {
  console.info('ai cache', event);
}
