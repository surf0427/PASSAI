// PASSAI 受験チューターAI の HTTP route（実装 STEP5）。
//
// 系譜: essay-chat (plain text 応答) + interview-questions (prompt caching) のハイブリッド。
//
// 責務:
//   1. body parse + shape guard
//   2. message validation (string / 非空 / 500字以内)
//   3. 危険語の server-side 1 次検出 → AI 呼ばずに定型文 reply で早期 return
//   4. server rate limit (IP 単位、1 分 10 回)
//   5. intent / preferredProfileField の正規化 (不正値は黙って fallback)
//   6. history の shape guard / sanitize (STEP-TUTOR-CONTEXT-01)
//      - 不正値は 400 にせず graceful に [] に倒す
//      - 最大 10 件、role/text validation、500 字上限、user/assistant 交互整列
//   7. buildTutorPromptContext (純粋関数) で context 組み立て
//   8. buildTutorUserPrompt で user prompt 合成
//   9. Anthropic messages.create (SYSTEM に cache_control: 'ephemeral')
//      - messages 配列は sanitized history + 今回の userPrompt の multi-turn 形式
//      - contextString / basicInfo / studentProfile は今回の userPrompt にのみ載せ、
//        過去 history には載せない（基本情報の重複載せを避ける）
//   10. stop_reason / error handling + logAiUsage
//   11. plain text reply で 200
//
// 責務外:
//   - localStorage アクセス (server で不可能だが明示的に禁止)
//   - Supabase / data/ 直 import
//   - StudentProfile の生成・mutation
//   - conversation state 管理（topic/concern/emotion の persisted 抽出は本 STEP の範囲外）
//   - thread 単位の永続化（thread storage / thread list UI は本 STEP の範囲外）
//   - localStorage 永続化（client 側 messages state も refresh で消える v1 仕様のまま）
//   - streaming
//   - JSON.parse / extractJson (plain text 応答のため不要)
//
// 関連:
//   - lib/tutor/tutorPrompt.ts (TUTOR_SYSTEM_PROMPT + buildTutorUserPrompt)
//   - lib/tutor/types.ts (TutorIntent / PreferredProfileField)
//   - lib/aiInputHash.ts (TUTOR_PROMPT_VERSION / TUTOR_MODEL)
//   - lib/contextBuilders/tutor/buildTutorPromptContext.ts

import { NextResponse } from 'next/server';
import { anthropic } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';
import { createTimeoutSignal } from '@/lib/aiTimeout';
import { checkServerRateLimit } from '@/lib/serverRateLimit';
import { TUTOR_MODEL } from '@/lib/aiInputHash';
import { TUTOR_SYSTEM_PROMPT, buildTutorUserPrompt } from '@/lib/tutor/tutorPrompt';
import { buildTutorPromptContext } from '@/lib/contextBuilders/tutor/buildTutorPromptContext';
import { getStudentProfileFromRequest } from '@/lib/getStudentProfileFromRequest';
import type { TutorIntent, PreferredProfileField } from '@/lib/tutor/types';

// ── 定数 ─────────────────────────────────────────────────────────

const ROUTE = 'api/tutor';
const MAX_MESSAGE_LENGTH = 500;
const TEMPERATURE = 0.4;
// max_tokens は intent 別に動的化（STEP-MVP-E）。getMaxTokensForIntent を参照。

// STEP-TUTOR-CONTEXT-01: history pass-through 用上限。
//   - HISTORY_MAX_TURNS: Anthropic に渡す履歴 turn の最大件数。client は 6 件送る想定だが、
//     server 側で 10 件まで許容する（client 拡張余地 / 古い client の余剰送信に対する余裕）。
//   - HISTORY_TEXT_MAX_LENGTH: 各 turn の text 長上限。MAX_MESSAGE_LENGTH と同値に揃える
//     ことで、過去 turn が現在の入力 1 件と同じ上限で扱われることを保証する。
const HISTORY_MAX_TURNS = 10;
const HISTORY_TEXT_MAX_LENGTH = MAX_MESSAGE_LENGTH;

// rate limit 設定。tutor は会話的で短いターンを連続しがちなため
// 1 分 10 回まで許容する（会話 3 ターン × ~3 回程度のリトライ余裕）。
const RATE_LIMIT_KEY_PREFIX = 'tutor';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

// 危険語 1 次検出用パターン。
// client UI / detectTutorIntent (STEP6) と同じパターンを使う想定だが、
// 本 STEP では route 内 const で完結させる。STEP6 で共有化する際は
// lib/tutor/ 配下に export を切り出して両者で参照する。
const EMERGENCY_PATTERN =
  /(死にたい|死のう|消えたい|いなくなりたい|もう生きていけない|終わりにしたい|自殺|自害)/;

// 危険語検出時の定型 reply。受験生個別情報を含めず byte-identical に保つ。
// SYSTEM PROMPT [G] 危険語プロトコルの定型文と同等の文言。
const EMERGENCY_REPLY =
  'いま、ひとりで抱え込みすぎているかもしれません。\n信頼できる大人や、よりそいホットライン（0120-279-338、24時間・無料）など、人と話せる窓口に一度連絡してみてください。';

// intent 正規化用 enum（lib/tutor/types.ts の TutorIntent と完全に一致）。
const TUTOR_INTENT_VALUES = [
  'general',
  'statement',
  'interview',
  'self_analysis',
  'selfpr',
  'stabilize',
  'advice',
] as const;

function isTutorIntent(value: unknown): value is TutorIntent {
  return (
    typeof value === 'string' &&
    (TUTOR_INTENT_VALUES as readonly string[]).includes(value)
  );
}

function isPreferredProfileField(value: unknown): value is PreferredProfileField {
  return value === 'strengths' || value === 'weaknesses';
}

// STEP-TUTOR-CONTEXT-01: history の shape guard / sanitize。
//
// 入力（client から）:
//   Array<{ role: 'user' | 'assistant', text: string }>
//
// 出力（Anthropic messages.create にそのまま渡せる形）:
//   Array<{ role: 'user' | 'assistant', content: string }>
//
// 仕様:
//   - 配列でなければ [] を返す（400 にしない / graceful fallback）
//   - 各要素の role が 'user'/'assistant' のものだけ採用
//   - text が string のものだけ採用
//   - text は trim、trim 後 1〜HISTORY_TEXT_MAX_LENGTH 字のみ採用
//   - 直近 HISTORY_MAX_TURNS 件を残す（先頭から古いものを落とす）
//   - 必ず 'user' から始まり、'user'/'assistant' を交互に並ぶように整列
//     （Anthropic API の制約。同一 role が連続したら最新で上書きし、
//      先頭の 'assistant' は会話開始時の起点が無いため落とす）
//
// 順序:
//   1. role/text validation + trim → valid[]
//   2. 交互整列 (alternation) → alternated[]
//   3. 末尾 HISTORY_MAX_TURNS 件を残す
//   4. 末尾が user のとき 1 件落とす
//      （ルート側で append される今回 user メッセージとの連続を回避するため）
//
// 純粋関数: throw しない。fetch / localStorage / log なし。
function sanitizeTutorHistory(
  raw: unknown,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(raw)) return [];

  // 1. role/text validation + trim
  const valid: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (rec.role !== 'user' && rec.role !== 'assistant') continue;
    if (typeof rec.text !== 'string') continue;
    const trimmed = rec.text.trim();
    if (trimmed === '') continue;
    if (trimmed.length > HISTORY_TEXT_MAX_LENGTH) continue;
    valid.push({ role: rec.role, content: trimmed });
  }

  // 2. Anthropic 制約: 'user' から始まる + 交互に並ぶ
  //    先頭 assistant は起点不在のため落とす。
  //    連続同一 role は「最新で上書き」（client 側で API failure 後にユーザーがもう一度
  //    送信した場合などに連続 user が紛れ込み得るため、最新を採用する）。
  const alternated: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of valid) {
    if (alternated.length === 0) {
      if (m.role !== 'user') continue;
      alternated.push(m);
      continue;
    }
    const last = alternated[alternated.length - 1];
    if (last.role !== m.role) {
      alternated.push(m);
    } else {
      alternated[alternated.length - 1] = m;
    }
  }

  // 3. 末尾 HISTORY_MAX_TURNS 件（古いものから落とす）
  let truncated: Array<{ role: 'user' | 'assistant'; content: string }> =
    alternated.length > HISTORY_MAX_TURNS
      ? alternated.slice(-HISTORY_MAX_TURNS)
      : alternated;
  // 切り出した先頭が assistant の場合は 1 件落として 'user' 始まりにする
  if (truncated[0]?.role === 'assistant') {
    truncated = truncated.slice(1);
  }

  // 4. 末尾が 'user' の場合は 1 件落とす。
  //    本関数の戻り値の直後にルート側で今回 turn の user メッセージが append される。
  //    末尾 user を残すと append 後に user/user の連続が発生し、Anthropic API が 400 を返す。
  //    典型ケース: 直前 turn が API failure / network error で assistant 応答が state に
  //    入らないまま、ユーザーがすぐ次の発話を送った場合。
  if (truncated.length > 0 && truncated[truncated.length - 1].role === 'user') {
    truncated = truncated.slice(0, -1);
  }

  return truncated;
}

// intent 別 max_tokens 上限（STEP-MVP-E 追加）。
// advice は [V] block の 4〜6 文・300〜500 字構造を物理的に保証するため 800 を上限とする。
// それ以外（general / statement / interview / self_analysis / selfpr / stabilize）は
// 従来通り 500 上限を継承。
function getMaxTokensForIntent(intent: TutorIntent): number {
  if (intent === 'advice') return 800;
  return 500;
}

// ── route handler ────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  // ── body parse ──
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: 'INVALID_BODY', message: 'リクエスト内容を読み取れませんでした。' },
        { status: 400 },
      );
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'INVALID_BODY', message: 'リクエスト内容を読み取れませんでした。' },
      { status: 400 },
    );
  }

  // ── message validation ──
  const rawMessage = body.message;
  if (typeof rawMessage !== 'string' || rawMessage.trim() === '') {
    return NextResponse.json(
      { error: 'MESSAGE_REQUIRED', message: 'メッセージを入力してください。' },
      { status: 400 },
    );
  }
  if (rawMessage.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: 'MESSAGE_TOO_LONG', message: 'メッセージは500字以内で入力してください。' },
      { status: 400 },
    );
  }
  const message = rawMessage.trim();

  // ── 危険語 1 次検出 ──
  // 検出時は AI / context builder / rate limit のいずれも触らずに早期 return。
  // body 本文・受験生情報を一切 log に出さない（個人情報ガード）。
  if (EMERGENCY_PATTERN.test(message)) {
    console.info('tutor emergency', { route: ROUTE });
    return NextResponse.json({ reply: EMERGENCY_REPLY }, { status: 200 });
  }

  // ── server rate limit ──
  // AI を消費する経路の手前に置く（429 は logAiUsage 対象外）。
  const rateLimit = checkServerRateLimit(req, {
    keyPrefix: RATE_LIMIT_KEY_PREFIX,
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: RATE_LIMIT_MAX_REQUESTS,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: 'しばらく時間をおいてからお試しください。' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSec) },
      },
    );
  }

  // ── intent / preferredProfileField 正規化 ──
  // 不正値・欠損は黙って fallback（'general' / undefined）。
  const intent: TutorIntent = isTutorIntent(body.intent) ? body.intent : 'general';
  const preferredProfileField: PreferredProfileField | undefined =
    isPreferredProfileField(body.preferredProfileField)
      ? body.preferredProfileField
      : undefined;

  // ── history sanitize ──
  // STEP-TUTOR-CONTEXT-01: client から渡る直近会話履歴を shape guard + 整列。
  // 不正値は 400 にせず graceful に [] に倒す。Anthropic messages 配列の先頭に置く。
  const sanitizedHistory = sanitizeTutorHistory(body.history);

  // ── context 組み立て ──
  // builder は純粋関数で throw しない設計だが、念のため try で包む。
  // 万一例外が出ても contextString='' に倒して AI call は続行（graceful degradation）。
  let contextString = '';
  try {
    contextString = buildTutorPromptContext({
      basicInfo: body.basicInfo ?? null,
      studentProfile: getStudentProfileFromRequest({ body }),
      intent,
      preferredProfileField,
      statementDraft: intent === 'statement' ? body.statementDraft ?? null : null,
      statementReviewLatest:
        intent === 'statement' ? body.statementReviewLatest ?? null : null,
      interviewRecordLatest:
        intent === 'interview' ? body.interviewRecordLatest ?? null : null,
      interviewFeedbackLatest:
        intent === 'interview' ? body.interviewFeedbackLatest ?? null : null,
      wallHittingResult:
        intent === 'self_analysis' ? body.wallHittingResult ?? null : null,
      selfPRDraft:
        intent === 'selfpr' && typeof body.selfPRDraft === 'string'
          ? body.selfPRDraft
          : null,
    });
  } catch (error) {
    // raw error を user に返さない。message 本文・受験生情報も log に出さない。
    console.error('tutor context build error', {
      route: ROUTE,
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    contextString = '';
  }

  // ── user prompt 合成 ──
  // なぜ userPrompt 末尾に intent=advice を載せるのか:
  //   SYSTEM PROMPT は static const で AI に「今回 turn の intent」を伝える経路がないため、
  //   server 側で判定済の intent=advice を user prompt 1 行で AI へ届け、[V] 活性化を保証する。
  // 詳細仕様は SYSTEM PROMPT [V-1b] (TUTOR_PROMPT_VERSION v15→v16, TUTOR-FINAL-06) を参照。
  //
  // STEP-TUTOR-FINAL-06: intent=advice の場合のみ末尾に turn qualifier を 1 行追加。
  //   SYSTEM PROMPT [V-1] は「intent=advice の turn のみ発動」と書かれているが、
  //   SYSTEM PROMPT は static const のため AI は単独で「今回 turn の intent」を判別できず、
  //   実測では [V] が発動せず通常 [J] (80〜200 字) に倒れる現象があった。
  //   route 側で deterministic に判定済の intent を 1 行で AI に伝えることで [V] 活性化を保証する。
  //   buildTutorUserPrompt の signature は不変、user prompt 末尾に行を 1 行 append するだけ。
  //   本 qualifier 文言は SYSTEM PROMPT [V-1b] と整合させており、AI 出力に含まれないよう
  //   prompt 側で抑止している。
  let userPrompt = buildTutorUserPrompt({ contextString, userMessage: message });
  if (intent === 'advice') {
    userPrompt += '\n\n（本 turn: intent=advice。SYSTEM PROMPT の [V] block を必ず発動してください — 4〜6 文 / 300〜500 字 / 5 ステップ構造 (受け止め → 整理・命名 → 受験知識推奨 → 根拠 → 次アクション)。本 qualifier 行は AI 出力には含めないでください。）';
  }

  // ── Anthropic 呼び出し ──
  // system 部のみ cache_control: 'ephemeral'（5 分以内連続呼び出しで input ~90% off）。
  // userPrompt は毎回変わるためキャッシュ対象外。
  //
  // STEP-TUTOR-CONTEXT-01: messages 配列は sanitizedHistory + 今回 userPrompt の
  // multi-turn 形式。contextString / basicInfo / studentProfile は今回 userPrompt
  // にのみ載せ、過去 history には載せない（builder の出力を過去 turn に重ねない）。
  let response;
  try {
    response = await anthropic.messages.create({
      model: TUTOR_MODEL,
      max_tokens: getMaxTokensForIntent(intent),
      temperature: TEMPERATURE,
      system: [
        {
          type: 'text',
          text: TUTOR_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        ...sanitizedHistory,
        { role: 'user', content: userPrompt },
      ],
    }, { signal: createTimeoutSignal() });
  } catch (error) {
    // 本文・prompt は log に出さない（aiUsageLog の方針に従う）。
    console.error('tutor api error', {
      route: ROUTE,
      model: TUTOR_MODEL,
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    logAiUsage({ route: ROUTE, model: TUTOR_MODEL, status: 'failed' });
    return NextResponse.json(
      {
        error: 'AI_REQUEST_FAILED',
        message: 'AIの呼び出しに失敗しました。時間をおいてお試しください。',
      },
      { status: 502 },
    );
  }

  // ── AI response handling (plain text) ──
  // JSON.parse / extractJson は使わない。text block を取り出して trim するだけ。
  const textBlock = response.content.find((b) => b.type === 'text');
  const reply = textBlock?.type === 'text' ? textBlock.text.trim() : '';

  // max_tokens で途中切れ → 構造化エラーで弾く（途中切れ文字列を user に返さない）
  if (response.stop_reason === 'max_tokens') {
    console.error('tutor truncated', {
      route: ROUTE,
      stopReason: response.stop_reason,
      rawTail: reply.slice(-200),
    });
    logAiUsage({
      route: ROUTE,
      model: TUTOR_MODEL,
      status: 'truncated',
      usage: response.usage,
      cache_creation_input_tokens: response.usage?.cache_creation_input_tokens,
      cache_read_input_tokens: response.usage?.cache_read_input_tokens,
    });
    return NextResponse.json(
      {
        error: 'AI_REPLY_TRUNCATED',
        message: 'AIの返答が途中で終了しました。もう一度お試しください。',
      },
      { status: 502 },
    );
  }

  // text 抽出失敗（text block なし / 空文字）→ failed 扱い
  if (reply === '') {
    console.error('tutor empty reply', {
      route: ROUTE,
      stopReason: response.stop_reason,
    });
    logAiUsage({
      route: ROUTE,
      model: TUTOR_MODEL,
      status: 'failed',
      usage: response.usage,
      cache_creation_input_tokens: response.usage?.cache_creation_input_tokens,
      cache_read_input_tokens: response.usage?.cache_read_input_tokens,
    });
    return NextResponse.json(
      {
        error: 'AI_REQUEST_FAILED',
        message: 'AIの呼び出しに失敗しました。時間をおいてお試しください。',
      },
      { status: 502 },
    );
  }

  // 成功
  logAiUsage({
    route: ROUTE,
    model: TUTOR_MODEL,
    status: 'success',
    usage: response.usage,
    cache_creation_input_tokens: response.usage?.cache_creation_input_tokens,
    cache_read_input_tokens: response.usage?.cache_read_input_tokens,
  });
  return NextResponse.json({ reply });
}
