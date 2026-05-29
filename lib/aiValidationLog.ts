// AI 入力 deterministic validation の独立観測レーン。
//
// 役割:
//   validator reject と structure warning を独立 key でログする。
//   `ai cache`（lib/aiCacheLog.ts）/ `ai usage`（lib/aiUsageLog.ts）とは
//   file / key / payload / naming すべて分離している。
//   両 AI レーンの contract は変更しない。
//
// production no-op:
//   本レーンは dev observability 目的。NODE_ENV !== 'development' では即 return。
//   将来 SaaS / Supabase 連携を入れる場合も payload contract をここで固定したまま
//   transport だけを差し替える想定。
//
// 個人情報ガード:
//   payload は route 識別子 + validation code（または structure warning code 配列）のみ。
//   ユーザー入力テキスト / prompt / 出力本文 / hash / 大学名 等は絶対に含めない。
//
// 出力形式（OBS-1 / PASS-1）:
//   grep しやすい human-readable な単一行に揃える（JSON.stringify しない）。
//   reject:  [ai validation] reject route=<route> code=<code>
//   warning: [ai validation] warning route=<route> codes=<code1>,<code2>
//   pass:    [ai validation] pass route=<route>
//
// pass は client-side でのみ発火（server で二重計測しない）。reject rate 算出の分母。
//
// 関連:
//   - lib/devValidationStats.ts（process-memory aggregation）
//   - lib/validation/validateStatementReviewInput.ts ほか
//   - lib/validation/structureWarnings.ts
//   - docs/principles/ai_cache_observability.md（混同しないこと）
//   - docs/principles/ai_usage_observability.md（混同しないこと）

import { recordValidationEvent } from './devValidationStats';

export type AiValidationRoute =
  | 'statement-review'
  | 'essay-review'
  | 'analysis'
  | 'additional-questions'
  | 'summarize';

export type AiValidationEvent =
  | {
      type: 'validation_reject';
      route: AiValidationRoute;
      code: string;
    }
  | {
      type: 'structure_warning';
      route: AiValidationRoute;
      codes: string[];
    }
  | {
      type: 'validation_pass';
      route: AiValidationRoute;
    };

export function logAiValidation(event: AiValidationEvent): void {
  if (process.env.NODE_ENV !== 'development') return;
  if (event.type === 'validation_reject') {
    console.info(
      `[ai validation] reject route=${event.route} code=${event.code}`,
    );
  } else if (event.type === 'structure_warning') {
    console.info(
      `[ai validation] warning route=${event.route} codes=${event.codes.join(',')}`,
    );
  } else {
    console.info(`[ai validation] pass route=${event.route}`);
  }
  recordValidationEvent(event);
}
