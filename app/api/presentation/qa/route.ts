/**
 * STEP-PRESENTATION-PR6: 発表後 AI 質問（ターン制 Q&A）route。
 *
 * AI 評価済み（status='evaluated'）の attempt に対する、発表後の質疑応答練習。
 * 面接AI turn / questionGen の思想を流用（kickoff / answer→followup）。プレゼン本体の評価ではない。
 *
 * 受信: POST JSON
 *   { attempt_id, action: 'kickoff' | 'answer' | 'finish', answer_text? }
 *
 * レスポンス:
 *   kickoff / answer → 200 { turns: [{turnIndex, role, source, content}], questionCount, promptFinish }
 *   finish           → 200 { summary: { goodPoints, improvements, nextPractice, overallComment } }
 *   400 invalid-body | invalid-action | answer-required
 *   401 unauthorized
 *   403 forbidden-attempt
 *   404 attempt-not-found
 *   409 invalid-attempt-status   … status≠'evaluated' / transcript 空 / result 不在
 *   409 qa-limit-reached         … 既に 5 問が出題・回答済みで継続不可
 *   500 qa-failed
 *
 * 課金（pr0_design.md §8）: usage_records に書かない / recordUsage を呼ばない /
 *   ensurePlanQuota もしない。消費は evaluate の初回成功時のみ。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import {
  PRESENTATION_QA_ASKED_MAX,
  PRESENTATION_QA_MAX_ANSWER_CHARS,
  PRESENTATION_QA_MAX_QUESTIONS,
} from '@/lib/presentation/constants';
import {
  generateFinishSummary,
  generateFollowupQuestion,
  generateKickoffQuestion,
  generateStandaloneQuestion,
  QaGenerationError,
  reviewAnswer,
  type QaContext,
  type QaTurn,
} from '@/lib/presentation/qa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ATTEMPTS_TABLE = 'presentation_attempts';
const SESSIONS_TABLE = 'presentation_sessions';
const RESULTS_TABLE = 'presentation_results';
const TURNS_TABLE = 'presentation_qa_turns';
// stateless generate/review の永続化テーブル（1 行 = 1 交換）。turn-transcript の TURNS_TABLE とは別。
const REVIEWS_TABLE = 'presentation_qa_reviews';
const UNIQUE_VIOLATION = '23505';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Action = 'kickoff' | 'answer' | 'finish' | 'generate' | 'review';
type Admin = ReturnType<typeof getServiceRoleSupabaseClient>;

type TurnRow = {
  turn_index: number;
  role: 'question' | 'answer';
  source: 'voice' | 'text';
  content: string;
};

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

function isAction(v: unknown): v is Action {
  return (
    v === 'kickoff' ||
    v === 'answer' ||
    v === 'finish' ||
    v === 'generate' ||
    v === 'review'
  );
}

export async function POST(req: Request) {
  // 1. 認証のみ（quota gate はしない）。
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;
  const userId = auth.userId;

  // 2. body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid-body' }, 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const attemptId = typeof b.attempt_id === 'string' ? b.attempt_id : '';
  if (!attemptId || !UUID_RE.test(attemptId)) {
    return json({ error: 'invalid-body' }, 400);
  }
  if (!isAction(b.action)) {
    return json({ error: 'invalid-action' }, 400);
  }
  const action = b.action;

  const admin = getServiceRoleSupabaseClient();

  // 3. 共通前提（attempt 所有 + status='evaluated' + transcript + 親 session in_progress + result 存在）
  const pre = await loadContext(admin, userId, attemptId);
  if ('error' in pre) return pre.error;
  const ctx = pre.ctx;

  try {
    // 単発 Q&A 練習（result 画面）。質問生成は DB 保存なし、回答レビューは成功後に DB 保存する。
    if (action === 'generate') {
      return await handleGenerate(admin, attemptId, ctx, b.asked_questions);
    }
    if (action === 'review') {
      return await handleReview(admin, attemptId, userId, ctx, b.question, b.answer_text);
    }
    // ターン制（DB 保存）。
    if (action === 'finish') return await handleFinish(admin, attemptId, ctx);
    if (action === 'kickoff') return await handleKickoff(admin, attemptId, userId, ctx);
    return await handleAnswer(admin, attemptId, userId, ctx, b.answer_text);
  } catch (err) {
    if (err instanceof QaGenerationError) {
      devWarn('[presentation/qa] generation error', { message: err.message });
      return json({ error: 'qa-failed' }, 500);
    }
    devWarn('[presentation/qa] unhandled', err);
    return failQa(err);
  }
}

// 共通前提を読み込み、QaContext を返す。満たさなければ error Response を返す。
async function loadContext(
  admin: Admin,
  userId: string,
  attemptId: string,
): Promise<{ error: Response } | { ctx: QaContext }> {
  const { data: attempt, error: attemptErr } = await admin
    .from(ATTEMPTS_TABLE)
    .select('id, user_id, session_id, status, transcript')
    .eq('id', attemptId)
    .maybeSingle();
  if (attemptErr) return { error: failQa(attemptErr) };
  if (!attempt) return { error: json({ error: 'attempt-not-found' }, 404) };
  if (attempt.user_id !== userId) {
    return { error: json({ error: 'forbidden-attempt' }, 403) };
  }
  const transcript =
    typeof attempt.transcript === 'string' ? attempt.transcript.trim() : '';
  if (attempt.status !== 'evaluated' || !transcript) {
    return { error: json({ error: 'invalid-attempt-status' }, 409) };
  }

  const { data: session, error: sessionErr } = await admin
    .from(SESSIONS_TABLE)
    .select('id, user_id, status, university_name, faculty_name, theme')
    .eq('id', attempt.session_id)
    .maybeSingle();
  if (sessionErr) return { error: failQa(sessionErr) };
  if (!session || session.user_id !== userId || session.status !== 'in_progress') {
    return { error: json({ error: 'forbidden-attempt' }, 403) };
  }

  const { data: result, error: resultErr } = await admin
    .from(RESULTS_TABLE)
    .select('feedback, categories')
    .eq('attempt_id', attemptId)
    .maybeSingle();
  if (resultErr) return { error: failQa(resultErr) };
  if (!result) {
    // status='evaluated' なら result 必須（evaluate route 不変条件）。欠落は異常。
    return { error: json({ error: 'invalid-attempt-status' }, 409) };
  }

  const overallComment =
    result.feedback &&
    typeof result.feedback === 'object' &&
    typeof (result.feedback as Record<string, unknown>).overallComment === 'string'
      ? ((result.feedback as Record<string, unknown>).overallComment as string)
      : undefined;

  const ctx: QaContext = {
    transcript,
    theme: session.theme ?? '',
    universityName: session.university_name ?? '',
    facultyName: session.faculty_name ?? '',
    categories:
      result.categories && typeof result.categories === 'object'
        ? (result.categories as Record<string, unknown>)
        : null,
    overallComment,
  };
  return { ctx };
}

// 現在の turns を turn_index 昇順で取得。
async function loadTurns(admin: Admin, attemptId: string): Promise<TurnRow[]> {
  const { data, error } = await admin
    .from(TURNS_TABLE)
    .select('turn_index, role, source, content')
    .eq('attempt_id', attemptId)
    .order('turn_index', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TurnRow[];
}

function toTurnsPayload(turns: TurnRow[]): Response {
  const questionCount = turns.filter((t) => t.role === 'question').length;
  return json(
    {
      turns: turns.map((t) => ({
        turnIndex: t.turn_index,
        role: t.role,
        source: t.source,
        content: t.content,
      })),
      questionCount,
      promptFinish: questionCount >= PRESENTATION_QA_MAX_QUESTIONS,
    },
    200,
  );
}

// turn を 1 件 insert（source は常に text）。UNIQUE(attempt_id, turn_index) 違反は conflict。
async function insertTurn(
  admin: Admin,
  args: {
    attemptId: string;
    userId: string;
    turnIndex: number;
    role: 'question' | 'answer';
    content: string;
  },
): Promise<{ ok: true } | { conflict: true } | { error: Response }> {
  const { error } = await admin.from(TURNS_TABLE).insert({
    attempt_id: args.attemptId,
    user_id: args.userId,
    turn_index: args.turnIndex,
    role: args.role,
    source: 'text',
    content: args.content,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { conflict: true };
    return { error: failQa(error) };
  }
  return { ok: true };
}

// action: kickoff — turn が無ければ最初の質問を生成・保存。あれば既存を返す。
async function handleKickoff(
  admin: Admin,
  attemptId: string,
  userId: string,
  ctx: QaContext,
): Promise<Response> {
  const existing = await loadTurns(admin, attemptId);
  if (existing.length > 0) return toTurnsPayload(existing);

  const question = await generateKickoffQuestion(ctx);
  const ins = await insertTurn(admin, {
    attemptId,
    userId,
    turnIndex: 0,
    role: 'question',
    content: question,
  });
  if ('error' in ins) return ins.error;
  // conflict（race で別プロセスが kickoff 済み）でも再 SELECT して現在の状態を返す。
  return toTurnsPayload(await loadTurns(admin, attemptId));
}

// action: answer — 回答保存 → 次の深掘り質問生成・保存（上限 5 問まで）。
async function handleAnswer(
  admin: Admin,
  attemptId: string,
  userId: string,
  ctx: QaContext,
  answerRaw: unknown,
): Promise<Response> {
  const answerText = typeof answerRaw === 'string' ? answerRaw.trim() : '';
  if (!answerText || answerText.length > PRESENTATION_QA_MAX_ANSWER_CHARS) {
    return json({ error: 'answer-required' }, 400);
  }

  const turns = await loadTurns(admin, attemptId);
  const last = turns[turns.length - 1];
  const pendingQuestion = Boolean(last && last.role === 'question');
  const questionCount = turns.filter((t) => t.role === 'question').length;

  if (!pendingQuestion) {
    // 回答すべき未回答の質問が無い。
    if (questionCount >= PRESENTATION_QA_MAX_QUESTIONS) {
      return json({ error: 'qa-limit-reached' }, 409);
    }
    // kickoff 前 / 順序ずれ。クライアントは kickoff から始める。
    return json({ error: 'invalid-action' }, 400);
  }

  const answerIndex = turns.length;

  // 上限に達している（直前の質問が 5 問目）→ 回答だけ保存し、新しい質問は生成しない。
  if (questionCount >= PRESENTATION_QA_MAX_QUESTIONS) {
    const ins = await insertTurn(admin, {
      attemptId,
      userId,
      turnIndex: answerIndex,
      role: 'answer',
      content: answerText,
    });
    if ('error' in ins) return ins.error;
    return toTurnsPayload(await loadTurns(admin, attemptId));
  }

  // followup を先に生成（生成失敗時は何も保存せずクリーンに 500 → 再試行可能）。
  const priorTurns: QaTurn[] = [
    ...turns.map((t) => ({ role: t.role, content: t.content })),
    { role: 'answer', content: answerText },
  ];
  const question = await generateFollowupQuestion({ ctx, priorTurns });

  // 回答を保存（race で衝突したら現在の turns を返す）。
  const ansIns = await insertTurn(admin, {
    attemptId,
    userId,
    turnIndex: answerIndex,
    role: 'answer',
    content: answerText,
  });
  if ('error' in ansIns) return ansIns.error;
  if ('conflict' in ansIns) return toTurnsPayload(await loadTurns(admin, attemptId));

  // 次の質問を保存（race で衝突したら現在の turns を返す）。
  const qIns = await insertTurn(admin, {
    attemptId,
    userId,
    turnIndex: answerIndex + 1,
    role: 'question',
    content: question,
  });
  if ('error' in qIns) return qIns.error;
  return toTurnsPayload(await loadTurns(admin, attemptId));
}

// action: finish — 保存済み turns をもとに簡単な総評を返す（保存しない）。
async function handleFinish(
  admin: Admin,
  attemptId: string,
  ctx: QaContext,
): Promise<Response> {
  const turns = await loadTurns(admin, attemptId);
  const priorTurns: QaTurn[] = turns.map((t) => ({ role: t.role, content: t.content }));
  const summary = await generateFinishSummary({ ctx, priorTurns });
  return json({ summary }, 200);
}

// 保存済み Q&A 履歴（question のみ）を created_at 昇順で取得。重複回避用。失敗は [] に倒す。
async function loadReviewQuestions(
  admin: Admin,
  attemptId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from(REVIEWS_TABLE)
    .select('question')
    .eq('attempt_id', attemptId);
  if (error) {
    devWarn('[presentation/qa] load review questions failed', {
      message: error.message,
    });
    return [];
  }
  return (data ?? [])
    .map((r) => (typeof r.question === 'string' ? r.question.trim() : ''))
    .filter(Boolean);
}

// action: generate — 質問を1つ生成して返す（DB 保存なし）。
//   重複回避は「画面内 asked_questions」＋「DB 上の過去質問」の両方を除外対象にする
//   （API コスト最適化: 過去質問を優先参照して同一質問の再生成を減らす。AI は停止しない）。
async function handleGenerate(
  admin: Admin,
  attemptId: string,
  ctx: QaContext,
  askedRaw: unknown,
): Promise<Response> {
  const clientAsked = Array.isArray(askedRaw)
    ? askedRaw
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const dbAsked = await loadReviewQuestions(admin, attemptId);

  // DB 上の過去質問を優先（前方）に、画面内を後方に置き、重複除去して上限で打ち切る。
  const seen = new Set<string>();
  const askedQuestions: string[] = [];
  for (const q of [...dbAsked, ...clientAsked]) {
    if (seen.has(q)) continue;
    seen.add(q);
    askedQuestions.push(q);
    if (askedQuestions.length >= PRESENTATION_QA_ASKED_MAX) break;
  }

  const question = await generateStandaloneQuestion({ ctx, askedQuestions });
  return json({ question }, 200);
}

// 次の turn_index（attempt 内の保存件数ベース）。max(turn_index)+1。空なら 0。
async function nextReviewIndex(admin: Admin, attemptId: string): Promise<number> {
  const { data, error } = await admin
    .from(REVIEWS_TABLE)
    .select('turn_index')
    .eq('attempt_id', attemptId)
    .order('turn_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const max = data && typeof data.turn_index === 'number' ? data.turn_index : -1;
  return max + 1;
}

// review 完了後に 1 交換を保存する。成功で true、失敗で false（体験は止めない）。
async function persistReview(
  admin: Admin,
  args: {
    attemptId: string;
    userId: string;
    question: string;
    answerText: string;
    review: unknown;
  },
): Promise<boolean> {
  try {
    const turnIndex = await nextReviewIndex(admin, args.attemptId);
    const { error } = await admin.from(REVIEWS_TABLE).insert({
      attempt_id: args.attemptId,
      user_id: args.userId,
      turn_index: turnIndex,
      question: args.question,
      answer_text: args.answerText,
      review: args.review ?? {},
    });
    if (error) {
      devWarn('[presentation/qa] persist review failed', { message: error.message });
      return false;
    }
    return true;
  } catch (err) {
    devWarn('[presentation/qa] persist review threw', err);
    return false;
  }
}

// action: review — 1つの質問への回答に短いフィードバックを返し、成功後に DB 保存する。
//   保存失敗時も review はそのまま返し（体験は止めない）、saved=false でクライアントへ通知する。
async function handleReview(
  admin: Admin,
  attemptId: string,
  userId: string,
  ctx: QaContext,
  questionRaw: unknown,
  answerRaw: unknown,
): Promise<Response> {
  const question = typeof questionRaw === 'string' ? questionRaw.trim() : '';
  if (!question) return json({ error: 'invalid-body' }, 400);
  const answer = typeof answerRaw === 'string' ? answerRaw.trim() : '';
  if (!answer || answer.length > PRESENTATION_QA_MAX_ANSWER_CHARS) {
    return json({ error: 'answer-required' }, 400);
  }
  const review = await reviewAnswer({ ctx, question, answer });
  const saved = await persistReview(admin, {
    attemptId,
    userId,
    question,
    answerText: answer,
    review,
  });
  return json({ review, saved }, 200);
}

function failQa(err: unknown): Response {
  captureRouteException(
    err,
    { route: 'presentation/qa', feature: 'presentation', status: 500 },
    { status: 500, code: 'qa-failed' },
  );
  return json({ error: 'qa-failed' }, 500);
}
