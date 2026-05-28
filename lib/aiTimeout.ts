// Anthropic messages.create() を timeout 制御で安全に呼び出すための minimal helper。
// STEP-API-TIMEOUT-01 で導入。orphan 課金（client 離脱後も AI 課金が走る現象）を防ぐ。
//
// 設計意図:
//   - SDK の RequestOptions.signal 経由で abort できるため、内部 fetch / streaming にも適用される
//   - 既存の logAiUsage / parse 経路は変えない。timeout 発生は上流 catch で AbortError として捕捉
//   - 過度な抽象化を避け、3 export のみに絞る
//   - cache identity / prompt 文言 / PROMPT_VERSION / system 引数は本 helper の対象外
//
// 使い方:
//   await anthropic.messages.create(
//     { model, max_tokens, system, messages, ... },
//     { signal: createTimeoutSignal() },
//   )
//
// 関連: lib/ai.ts（anthropic singleton）

// AI API call の default timeout（60 秒）。
// 通常 Sonnet 4-6 で max_tokens 2000 程度なら 20 秒未満で返るため、60 秒は cold start や
// 混雑時を含めても十分な余裕がある上限。
// Opus / 大型 max_tokens の route だけ呼び出し側で個別 ms を渡して延長する設計。
export const DEFAULT_AI_TIMEOUT_MS = 60_000;

// 指定 ms 経過で abort する AbortSignal を作る。
// Node 18+ なら AbortSignal.timeout(ms) が利用可能。
// 古い環境向けには AbortController + setTimeout に fallback。unref で event loop を hold しない。
export function createTimeoutSignal(ms: number = DEFAULT_AI_TIMEOUT_MS): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  // timer が server lifecycle を引き止めないように unref する（Node 環境のみ）。
  (timer as unknown as { unref?: () => void }).unref?.();
  return controller.signal;
}

// catch ブロックで「これは timeout / abort か？」を判定するための narrow guard。
// Anthropic SDK は abort 経路で `AbortError` を投げる（fetch ベースの実装に従う）。
// timeout 発生時の logAiUsage は既存どおり status: 'failed' で記録する方針のため、
// 本 helper を使った特別分岐は必須ではない。abort と他エラーを区別したい route がある時に使う。
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; message?: unknown };
  return (
    e.name === 'AbortError' ||
    e.name === 'TimeoutError' ||
    (typeof e.message === 'string' && /aborted|timed out/i.test(e.message))
  );
}
