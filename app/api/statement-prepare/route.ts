// 志望理由書を書く前の「整理メモ」を作る API。
// 受験生が本文を書く前のスキャフォールドを Claude に作らせる。
// 本文や完成文の代筆はしない。

import { anthropic, extractJson } from '@/lib/ai';
import { createTimeoutSignal } from '@/lib/aiTimeout';
import { checkServerRateLimit } from '@/lib/serverRateLimit';
import {
  asString,
  buildStatementPreparePrompt,
  isStatementPrepareApiResult,
} from '@/lib/statement/prepare/statementPreparePrompt';
import { logAiUsage } from '@/lib/aiUsageLog';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// 429（rate limit）は AI call 前の弾きなので usage log は出さない（AI を消費していない）。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/statement-prepare';

// ── rate limit 設定 ──────────────────────────────────────────────
// 同一IPあたり 1時間 5回。実装は lib/serverRateLimit.ts 側（暫定メモリ実装）。
// ローカルで429を確認したい場合は、一時的に MAX を 1、WINDOW_MS を 60_000 にすると即超過する。
// ※ コミット前に必ず本番値に戻すこと。
export const STATEMENT_PREPARE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const STATEMENT_PREPARE_RATE_LIMIT_MAX = 5;

type RequestBody = {
  interestReason?: unknown;
  memorableExperience?: unknown;
  futureGoal?: unknown;
};

export type StatementPrepareApiResult = {
  impressiveExperience: string;
  feltIssue: string;
  interestInField: string;
  universityLearning: string;
  futureApplication: string;
};

// prompt builder と type guard / asString は
// lib/statement/prepare/statementPreparePrompt.ts に切り出した。prompt 本文・型ガード条件は完全に同一。
// StatementPrepareApiResult 型は本ファイルで引き続き `export type` として保持する（新ファイルは
// type-only import で参照する）。

// ── route ────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json(
      { error: 'リクエスト形式が不正です。' },
      { status: 400 },
    );
  }

  const interestReason = asString(body.interestReason);
  const memorableExperience = asString(body.memorableExperience);
  const futureGoal = asString(body.futureGoal);

  if (
    !interestReason.trim() &&
    !memorableExperience.trim() &&
    !futureGoal.trim()
  ) {
    return Response.json(
      { error: 'まずは1つだけでも入力してください' },
      { status: 400 },
    );
  }

  // ── サーバ側 rate limit ──
  // 入力バリデーションを通過した有効リクエストのみカウント対象。
  // 仕様：API 処理に進む場合のみ count が進む（helper 内で同等の挙動）。
  const rateLimit = checkServerRateLimit(req, {
    keyPrefix: 'statement-prepare',
    windowMs: STATEMENT_PREPARE_RATE_LIMIT_WINDOW_MS,
    maxRequests: STATEMENT_PREPARE_RATE_LIMIT_MAX,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      {
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'しばらく時間をおいてからお試しください。',
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSec) },
      },
    );
  }

  try {
    // STEP4.10: 既存 control flow を変えずに観測する。messages.create() と JSON.parse を
    // 個別 try/catch で囲み、log → re-throw で外側の既存 catch に届ける。レスポンス shape /
    // status code は完全維持。truncation は parse 失敗の catch 内で stop_reason から区別する。
    let message;
    try {
      message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1100,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: buildStatementPreparePrompt({
              interestReason,
              memorableExperience,
              futureGoal,
            }),
          },
        ],
      }, { signal: createTimeoutSignal() });
    } catch (error) {
      logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
      throw error;
    }

    const text =
      message.content[0]?.type === 'text' ? message.content[0].text : '';

    let parsed: unknown;
    try {
      const json = extractJson(text);
      parsed = JSON.parse(json);
    } catch (error) {
      logAiUsage({
        route: ROUTE,
        model: MODEL,
        status: message.stop_reason === 'max_tokens' ? 'truncated' : 'parse_failed',
        usage: message.usage,
      });
      throw error;
    }

    if (!isStatementPrepareApiResult(parsed)) {
      console.error('statement-prepare API: invalid shape', parsed);
      // JSON は parse できたが期待 shape ではない（AI schema 違反）。
      // 「AI 出力を期待通りに読み取れなかった」という意味で parse_failed として記録する。
      logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: message.usage });
      return Response.json(
        { error: '整理に失敗しました。もう一度お試しください。' },
        { status: 500 },
      );
    }

    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage });
    return Response.json(parsed);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('statement-prepare API error:', msg);
    // inner で具体 status を log 済みのため、ここでは追加 log しない（double-log 回避）。
    return Response.json(
      { error: '整理に失敗しました。もう一度お試しください。' },
      { status: 500 },
    );
  }
}
