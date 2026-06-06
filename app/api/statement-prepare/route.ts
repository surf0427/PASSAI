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
import { captureRouteException } from '@/lib/sentry/capture';
import { checkMaxLengths } from '@/lib/validation/checkMaxLengths';
import { INPUT_MAX_LENGTHS } from '@/lib/validation/inputLimits';
import { detectNgWords } from '@/lib/detectNgWords';
import { buildStatementUniversityContext } from '@/lib/statement/review/buildStatementUniversityContext';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { recordUsage } from '@/lib/billing/usageLog';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// 429（rate limit）は AI call 前の弾きなので usage log は出さない（AI を消費していない）。
const MODEL = 'claude-sonnet-4-6';
// M4: Vercel 実行時間上限。AI timeout（lib/aiTimeout.ts = 60s）+ 余裕。Pro 前提
// （Hobby は 60s 上限で AI timeout を吸収できない）。runtime は既定 nodejs（edge 不可）。
export const maxDuration = 80;

const ROUTE = 'api/statement-prepare';
// STEP-GATE-COMPLETE: usage_records.route 識別子 (schema コメント規約)。
const USAGE_ROUTE = 'statement-prepare';

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
  // DET-8: 志望大学情報（任意）。指定があれば lib/universities.ts の helper で
  // admission policy / 評価観点 / 入試方式 などを deterministic に取得し、整理メモ生成の
  // 参考情報として AI に渡す。未指定 / 空文字なら従来通り受験生入力のみで整理メモを生成
  // （後方互換、旧 client は引き続き動作）。
  university?: unknown;
  faculty?: unknown;
  department?: unknown;
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
  // DET-8: 志望大学情報を受け取る（任意）。型が string でなければ '' に倒す。
  const university = asString(body.university);
  const faculty = asString(body.faculty);
  const department = asString(body.department);

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

  // B2: prompt に埋め込む自由記述 / 大学情報の最大長ガード。
  const lengthCheck = checkMaxLengths([
    { label: '興味・関心', value: interestReason, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '印象的な経験', value: memorableExperience, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '将来の目標', value: futureGoal, max: INPUT_MAX_LENGTHS.TEXT },
    { label: '大学名', value: university, max: INPUT_MAX_LENGTHS.LABEL },
    { label: '学部名', value: faculty, max: INPUT_MAX_LENGTHS.LABEL },
    { label: '学科名', value: department, max: INPUT_MAX_LENGTHS.LABEL },
  ]);
  if (!lengthCheck.ok) {
    return Response.json({ error: lengthCheck.message }, { status: 400 });
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

  // STEP-GATE-COMPLETE: Plan Gate (rate limit 後 / AI call 前)。
  const gate = await ensurePlanQuota('statement');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  try {
    // STEP4.10: 既存 control flow を変えずに観測する。messages.create() と JSON.parse を
    // 個別 try/catch で囲み、log → re-throw で外側の既存 catch に届ける。レスポンス shape /
    // status code は完全維持。truncation は parse 失敗の catch 内で stop_reason から区別する。
    let message;
    try {
      // DET-5: NG 指摘を deterministic に事前検出し prompt に「既知」として渡す（DET-2 の
      // statement-review 完全横展開）。DET-8 以降は大学情報が body に来た場合 university /
      // faculty を NG 検出の大学接続 quality check（universityConnection）にも渡せるが、本
      // STEP では DET-5 の挙動を破壊しないため引き続き ''（=quality check スキップ）で呼ぶ。
      // 大学情報の活用は下記の universityContext で別レーンとして処理する。
      // detectNgWords は universal phrase rules（15 種）+ quality checks（文章量 / 具体性 /
      // 経験）で十分有用。3 入力 field を改行連結した text に対して検出する。同 phrase を AI が
      // 再 discovery する往復コストを削減し、分析 / 改善提案 / 整理メモの手がかり提示に token を
      // 割けるようにする。
      // 注: statement-prepare には PROMPT_VERSION / hash / cache 機構がないため cache identity
      // drift の議論は対象外（v6→v7 のような bump も不要）。
      const ngInputText = [interestReason, memorableExperience, futureGoal]
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n');
      const ngIssues = detectNgWords(ngInputText, null, '', '');

      // DET-8: 志望大学が指定されている場合のみ大学 DB context を生成する。statement-review と
      // 同じ buildStatementUniversityContext() を流用（lib/universities.ts の単一読み取り境界を
      // 経由）。DB 未ヒット / 有意情報なし / university 未入力なら空文字を返し prompt に section
      // を含めない（後方互換、旧 client は引き続き動作）。採点基準ではなく整理メモ生成の参考
      // 情報という位置付けは SYSTEM 側 qualifier に明文化済（statementPreparePrompt.ts の
      // 【志望大学DB情報について】block）。
      const universityContext = university.trim()
        ? buildStatementUniversityContext({ university, faculty, department })
        : '';

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
              ngIssues,
              universityContext,
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
        cache_creation_input_tokens: message.usage?.cache_creation_input_tokens,
        cache_read_input_tokens: message.usage?.cache_read_input_tokens,
      });
      throw error;
    }

    if (!isStatementPrepareApiResult(parsed)) {
      console.error('statement-prepare API: invalid shape', parsed);
      // JSON は parse できたが期待 shape ではない（AI schema 違反）。
      // 「AI 出力を期待通りに読み取れなかった」という意味で parse_failed として記録する。
      logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
      await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
      return Response.json(
        { error: '整理に失敗しました。もう一度お試しください。' },
        { status: 500 },
      );
    }

    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'ok' });
    return Response.json(parsed);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('statement-prepare API error:', msg);
    // inner で具体 status を log 済みのため、ここでは追加 log しない（double-log 回避）。
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
    captureRouteException(error, { route: ROUTE, feature: 'ai', status: 500 }, { status: 500, code: 'AI_REQUEST_FAILED' });
    return Response.json(
      { error: '整理に失敗しました。もう一度お試しください。' },
      { status: 500 },
    );
  }
}
