// STEP4.5: AI usage logging の共通化レイヤー。
//
// 目的:
//   STEP4.4 で /api/analysis に入れた usage log を、他 API route（/api/analysis/additional,
//   /api/summarize, /api/statement-review, /api/essay-review, /api/interview-feedback）にも
//   同じ shape で横展開できるよう、ログ仕様を 1 箇所に固定する。
//
// 個人情報・本文ガード（共通方針）:
//   この関数の payload には以下を「絶対に含めない」:
//     - request body（活動本文 / 自己PR本文 / 志望理由書本文 / 面接回答 / basicInfo / 大学コンテキスト 等）
//     - prompt 本文（system / user メッセージのテキスト）
//     - AI 出力本文（raw text / parsed JSON / Response body）
//     - request 識別子（user-agent / IP / cookie / session）
//   payload は「route 名 / model 名 / status / 整数の token 数」のみで構成する。
//   呼び出し側で usage 以外の値を渡すことはできない型定義になっている。
//
// log 基盤を作る STEP ではない:
//   本ファイルは console.info を 1 行呼ぶだけのラッパ。構造化ログ収集・サンプリング・
//   メトリクス送信は platform 側（Vercel / Datadog 等）で行う前提。外部依存は追加しない。

// 4 値の status は /api/analysis（STEP4.4）の経路と一致させてある。
// 横展開先で新しい状態が必要になったら、ここに追加する形で拡張する。
export type AiUsageStatus = 'success' | 'truncated' | 'parse_failed' | 'failed';

// Anthropic SDK の Message.usage と互換のサブセット。
// cache_creation_input_tokens / cache_read_input_tokens は prompt caching を入れた時点で
// 追加する（現状は未使用）。SDK 型に直接依存させないことで、将来 model provider を
// 増やしたときの境界が崩れにくい。
export type AiUsageTokens = {
  input_tokens: number;
  output_tokens: number;
};

export type LogAiUsageOptions = {
  route: string;
  model: string;
  status: AiUsageStatus;
  // usage が undefined になるのは「response が返る前に例外が起きた経路」。
  // その場合は token 系を null で記録し、failure 回数だけ集計できるようにする。
  usage?: AiUsageTokens;
};

export function logAiUsage({ route, model, status, usage }: LogAiUsageOptions): void {
  console.info('ai usage', {
    route,
    model,
    status,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    total_tokens: usage ? usage.input_tokens + usage.output_tokens : null,
  });
}
