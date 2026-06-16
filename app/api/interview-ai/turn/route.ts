/**
 * STEP-INTERVIEW-AI-PR6: 面接 AI ターン route。
 *
 * 役割:
 *   - kickoff: 最初の質問（seed）を生成して返す（課金なし / 内部 AI は logAiUsage のみ）。
 *   - answer:  回答ターンを受け取り、課金トリガを起こし、transcript を保存し、followup を返す。
 *
 * モード（Content-Type で分岐）:
 *   - application/json  { sessionId, kickoff: true }      … seed 質問生成（text セッション / voice セッション共通）
 *   - application/json  { sessionId, answer: string }      … text 回答（session.source='text'）
 *   - multipart/form-data (sessionId, audio)               … voice 回答（session.source='voice'）
 *
 * PR6 必須条件の遵守:
 *   §1 recordUsage の route key は 'interview-ai' に統一（lib/interviewAi/billing.ts 経由）。
 *   §2 recordUsage は「voice 最初の STT 成功」「text 最初の回答保存」の 2 箇所のみ。
 *      seed / followup 生成は logAiUsage のみ（lib/interviewAi/questionGen.ts は recordUsage を import しない）。
 *   §3 recordUsage の前に必ず compare-and-set（triggerInterviewAiBilling 内）。
 *   §4 session 存在 / 所有者一致 / status='in_progress' を確認（loadInProgressOwnedSession）。
 *   §5 source 分岐（voice=STT / text=直接保存）。
 *   §6 音声は保存しない（transcript のみ保存）。
 *   §7 ターン上限（INTERVIEW_AI_MAX_ANSWER_TURNS。無限 followup 禁止）。
 *   §8 STT 失敗 / text 保存失敗時は recordUsage しない。Supabase 保存失敗は明示エラー（best-effort にしない）。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { authenticateRequest } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import {
  INTERVIEW_AI_MAX_ANSWER_CHARS,
  INTERVIEW_AI_MAX_ANSWER_TURNS,
  INTERVIEW_AI_MAX_AUDIO_BYTES,
} from '@/lib/interviewAi/constants';
import { loadInProgressOwnedSession } from '@/lib/interviewAi/sessionGuard';
import { triggerInterviewAiBilling } from '@/lib/interviewAi/billing';
import {
  countAnswerTurns,
  insertTurn,
  listTurns,
  type TurnRow,
} from '@/lib/interviewAi/turnStore';
import {
  generateFollowupQuestion,
  generateSeedQuestion,
  type PriorTurn,
} from '@/lib/interviewAi/questionGen';
import { isInterviewType, type InterviewType } from '@/lib/interviewAi/interviewTypes';
import {
  isSttError,
  SttUnavailableError,
  transcribeAudio,
} from '@/lib/interviewAi/stt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

const ROUTE_TAG = 'interview-ai/turn';

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  // §4 (前段): 認証。quota の再判定はしない（quota は session 作成時に gate 済み。本 route は
  // 課金トリガ + 内部 AI のみ）。
  const auth = await authenticateRequest();
  if (auth.kind === 'reject') return auth.response;
  const userId = auth.userId;

  const contentType = req.headers.get('content-type') ?? '';
  const isMultipart = contentType.includes('multipart/form-data');

  // ── 入力 parse（mode 判定） ─────────────────────────────────────────
  let sessionId = '';
  let mode: 'kickoff' | 'text-answer' | 'voice-answer' | 'retry-followup';
  let answerText = '';
  let audioBuffer: ArrayBuffer | null = null;
  let audioMime = '';

  if (isMultipart) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json({ error: 'invalid-body' }, 400);
    }
    const sid = form.get('sessionId');
    const audio = form.get('audio');
    if (typeof sid !== 'string' || !sid) return json({ error: 'invalid-body' }, 400);
    if (!(audio instanceof Blob)) return json({ error: 'invalid-body' }, 400);
    if (audio.size > INTERVIEW_AI_MAX_AUDIO_BYTES) {
      return json({ error: 'audio-too-large' }, 413);
    }
    sessionId = sid;
    mode = 'voice-answer';
    audioMime = audio.type || 'application/octet-stream';
    // 音声はメモリ上で transcribe するためだけに読む。保存はしない（§6）。
    audioBuffer = await audio.arrayBuffer();
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid-body' }, 400);
    }
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.sessionId !== 'string' || !b.sessionId) {
      return json({ error: 'invalid-body' }, 400);
    }
    sessionId = b.sessionId;
    if (b.kickoff === true) {
      mode = 'kickoff';
    } else if (b.retryFollowup === true) {
      // followup の生成 / 保存に失敗した後の再試行（contract: docs/interview_ai/pr6_turn_route.md §8）。
      // 回答ターンは再作成せず、followup のみ再生成・再保存する。recordUsage は再実行しない。
      mode = 'retry-followup';
    } else if (typeof b.answer === 'string') {
      const trimmed = b.answer.trim();
      if (!trimmed) return json({ error: 'empty-answer' }, 400);
      if (trimmed.length > INTERVIEW_AI_MAX_ANSWER_CHARS) {
        return json({ error: 'answer-too-large' }, 413);
      }
      mode = 'text-answer';
      answerText = trimmed;
    } else {
      return json({ error: 'invalid-body' }, 400);
    }
  }

  const admin = getServiceRoleSupabaseClient();

  // §4: session 存在 / 所有者一致 / status='in_progress'。
  const guard = await loadInProgressOwnedSession(admin, sessionId, userId);
  if (guard.kind === 'reject') return json({ error: guard.error }, guard.status);
  const session = guard.session;

  // 既存ターン取得（保存失敗は明示エラー / §8）。
  const { turns, error: listErr } = await listTurns(admin, sessionId);
  if (listErr) {
    devWarn('[interview-ai/turn] listTurns error', listErr);
    return json({ error: 'turn-load-failed' }, 500);
  }

  try {
    if (mode === 'kickoff') {
      return await handleKickoff(admin, session, userId, turns);
    }
    if (mode === 'retry-followup') {
      return await handleRetryFollowup(admin, session, userId, turns);
    }
    return await handleAnswer(admin, session, userId, turns, {
      mode,
      answerText,
      audioBuffer,
      audioMime,
    });
  } catch (err) {
    devWarn('[interview-ai/turn] unhandled', err);
    captureRouteException(
      err,
      { route: ROUTE_TAG, feature: 'interview-ai', status: 500 },
      { status: 500, code: 'turn-failed' },
    );
    return json({ error: 'turn-failed' }, 500);
  }
}

// ── kickoff: seed 質問生成（課金なし） ──────────────────────────────────
// session から質問/評価生成用の interview_type + sourceContext を取り出す。
function genParams(session: {
  interview_type: string;
  target_ref: Record<string, unknown>;
}): { interviewType: InterviewType; sourceContext: string | undefined } {
  const interviewType = isInterviewType(session.interview_type)
    ? session.interview_type
    : 'free';
  const sc = session.target_ref?.sourceContext;
  return { interviewType, sourceContext: typeof sc === 'string' ? sc : undefined };
}

async function handleKickoff(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  session: { id: string; target_ref: Record<string, unknown>; interview_type: string },
  userId: string,
  turns: TurnRow[],
): Promise<Response> {
  // 既に開始済みなら kickoff は不可（seed は最初の 1 回のみ）。
  if (turns.length > 0) return json({ error: 'already-started' }, 409);

  let question: string;
  try {
    // 内部 AI: logAiUsage のみ。recordUsage は呼ばない（§2）。type 別に方針を変える。
    const gp = genParams(session);
    question = await generateSeedQuestion({
      interviewType: gp.interviewType,
      targetRef: session.target_ref,
      sourceContext: gp.sourceContext,
    });
  } catch {
    return json({ error: 'question-generation-failed' }, 502);
  }

  // §8: 保存失敗は明示エラー（best-effort にしない）。
  const { error } = await insertTurn(admin, {
    sessionId: session.id,
    userId,
    turnIndex: 0,
    role: 'question',
    source: 'text', // 質問は常に text
    content: question,
  });
  if (error) {
    devWarn('[interview-ai/turn] seed insert error', error);
    return json({ error: 'turn-save-failed' }, 500);
  }

  return json({ question, turnIndex: 0, done: false }, 201);
}

// ── answer: 回答ターン（課金トリガ + transcript 保存 + followup） ──────────
async function handleAnswer(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  session: { id: string; source: 'voice' | 'text'; target_ref: Record<string, unknown>; interview_type: string },
  userId: string,
  turns: TurnRow[],
  input: {
    mode: 'text-answer' | 'voice-answer';
    answerText: string;
    audioBuffer: ArrayBuffer | null;
    audioMime: string;
  },
): Promise<Response> {
  // §5: source 分岐の整合性。voice セッションは音声、text セッションは text のみ。
  if (input.mode === 'voice-answer' && session.source !== 'voice') {
    return json({ error: 'source-mismatch' }, 400);
  }
  if (input.mode === 'text-answer' && session.source !== 'text') {
    return json({ error: 'source-mismatch' }, 400);
  }

  // 直前に未回答の質問が必要（最後のターンが question）。
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'question') {
    return json({ error: 'no-pending-question' }, 409);
  }

  // §7: ターン上限。answer 件数が上限に達していたら新規回答を受け付けない。
  const answerCount = countAnswerTurns(turns);
  if (answerCount >= INTERVIEW_AI_MAX_ANSWER_TURNS) {
    return json({ error: 'turn-limit-reached', done: true }, 409);
  }

  const answerIndex = last.turn_index + 1;

  if (input.mode === 'voice-answer') {
    return await handleVoiceAnswer(admin, session, userId, turns, answerIndex, input);
  }
  return await handleTextAnswer(admin, session, userId, turns, answerIndex, input.answerText);
}

// voice: STT → (STT 成功で課金トリガ) → transcript 保存 → followup。
async function handleVoiceAnswer(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  session: { id: string; source: 'voice' | 'text'; target_ref: Record<string, unknown>; interview_type: string },
  userId: string,
  turns: TurnRow[],
  answerIndex: number,
  input: { audioBuffer: ArrayBuffer | null; audioMime: string },
): Promise<Response> {
  if (!input.audioBuffer) return json({ error: 'invalid-body' }, 400);

  // §5 / §6: 音声を STT（メモリ上のみ。保存しない）。
  let transcript: string;
  try {
    const out = await transcribeAudio({
      audio: input.audioBuffer,
      mimeType: input.audioMime,
    });
    transcript = out.transcript.trim();
  } catch (err) {
    // §8: STT 失敗時は recordUsage しない。明示エラーを返す。
    if (isSttError(err)) {
      const code = err instanceof SttUnavailableError ? 'stt-unavailable' : 'stt-failed';
      return json({ error: code }, 502);
    }
    throw err;
  }
  if (!transcript) return json({ error: 'stt-failed' }, 502);

  // §2 / §3: voice の課金トリガ = 最初の STT 成功時。compare-and-set → 勝者のみ recordUsage。
  // STT コストは既に発生しているため、保存より先に計上する（pr0_design.md §2.2）。
  await triggerInterviewAiBilling({ admin, sessionId: session.id, userId });

  // §8: transcript 保存失敗は明示エラー（課金は STT 成功時に確定済み。STT 原価は実発生）。
  const { error } = await insertTurn(admin, {
    sessionId: session.id,
    userId,
    turnIndex: answerIndex,
    role: 'answer',
    source: 'voice',
    content: transcript,
  });
  if (error) {
    devWarn('[interview-ai/turn] voice answer insert error', error);
    return json({ error: 'turn-save-failed' }, 500);
  }

  return await respondWithFollowup(admin, session, userId, turns, {
    answerIndex,
    transcript,
    answerCountBefore: countAnswerTurns(turns),
  });
}

// text: transcript 保存 → (保存成功で課金トリガ) → followup。
async function handleTextAnswer(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  session: { id: string; source: 'voice' | 'text'; target_ref: Record<string, unknown>; interview_type: string },
  userId: string,
  turns: TurnRow[],
  answerIndex: number,
  answerText: string,
): Promise<Response> {
  // §5: text は STT を通さない。回答テキストをそのまま transcript として保存する。
  // §8: 保存失敗は明示エラー。保存に失敗したら recordUsage しない（保存より先に課金しない）。
  const { error } = await insertTurn(admin, {
    sessionId: session.id,
    userId,
    turnIndex: answerIndex,
    role: 'answer',
    source: 'text',
    content: answerText,
  });
  if (error) {
    devWarn('[interview-ai/turn] text answer insert error', error);
    return json({ error: 'turn-save-failed' }, 500);
  }

  // §2 / §3: text の課金トリガ = 最初の回答保存時（保存成功後）。compare-and-set → 勝者のみ recordUsage。
  await triggerInterviewAiBilling({ admin, sessionId: session.id, userId });

  return await respondWithFollowup(admin, session, userId, turns, {
    answerIndex,
    transcript: answerText,
    answerCountBefore: countAnswerTurns(turns),
  });
}

// 回答保存後の共通処理: ターン上限なら done、そうでなければ followup を生成・保存して返す。
async function respondWithFollowup(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  session: { id: string; target_ref: Record<string, unknown>; interview_type: string },
  userId: string,
  turns: TurnRow[],
  ctx: { answerIndex: number; transcript: string; answerCountBefore: number },
): Promise<Response> {
  const newAnswerCount = ctx.answerCountBefore + 1;

  // §7: 上限到達 → followup を生成しない（無限 followup 禁止）。done を返す。
  if (newAnswerCount >= INTERVIEW_AI_MAX_ANSWER_TURNS) {
    return json(
      { transcript: ctx.transcript, turnIndex: ctx.answerIndex, done: true, question: null },
      200,
    );
  }

  // 直前の answer を含めた文脈で followup を生成・保存する（priorTurns は保存済みターン + 今回の answer）。
  const priorTurns: PriorTurn[] = [
    ...turns.map((t) => ({ role: t.role, content: t.content })),
    { role: 'answer' as const, content: ctx.transcript },
  ];
  return genAndSaveFollowup(admin, session, userId, {
    priorTurns,
    answerIndex: ctx.answerIndex,
    transcript: ctx.transcript,
  });
}

// followup 再試行（contract §8）。回答ターンは再作成せず、followup のみ再生成・再保存する。
// recordUsage は再実行しない（課金トリガは元の回答保存 / STT 成功時に確定済み）。
async function handleRetryFollowup(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  session: { id: string; target_ref: Record<string, unknown>; interview_type: string },
  userId: string,
  turns: TurnRow[],
): Promise<Response> {
  if (turns.length === 0) return json({ error: 'no-pending-followup' }, 409);
  const last = turns[turns.length - 1];

  // 既に followup が保存済み（最後が question）→ 冪等にその質問を返す（二重生成しない）。
  if (last.role === 'question') {
    return json(
      { question: last.content, questionTurnIndex: last.turn_index, done: false },
      200,
    );
  }

  // 最後が answer = followup 未保存。上限到達なら followup 不要で done。
  const answerCount = countAnswerTurns(turns);
  if (answerCount >= INTERVIEW_AI_MAX_ANSWER_TURNS) {
    return json(
      { transcript: last.content, turnIndex: last.turn_index, done: true, question: null },
      200,
    );
  }

  // followup のみ再生成・再保存（recordUsage は呼ばない。answer の重複作成もしない）。
  const priorTurns: PriorTurn[] = turns.map((t) => ({ role: t.role, content: t.content }));
  return genAndSaveFollowup(admin, session, userId, {
    priorTurns,
    answerIndex: last.turn_index,
    transcript: last.content,
  });
}

// followup を 1 つ生成して question ターンとして保存する共通処理。
// 内部 AI は logAiUsage のみ（§2）。生成 / 保存失敗は 200 + questionError で明示 surface（best-effort 黙殺にしない）。
// 本関数は recordUsage を一切呼ばない（回答パス / 再試行パス双方から使う）。
async function genAndSaveFollowup(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  session: { id: string; target_ref: Record<string, unknown>; interview_type: string },
  userId: string,
  ctx: { priorTurns: PriorTurn[]; answerIndex: number; transcript: string },
): Promise<Response> {
  let question: string;
  try {
    const gp = genParams(session);
    question = await generateFollowupQuestion({
      interviewType: gp.interviewType,
      targetRef: session.target_ref,
      turns: ctx.priorTurns,
      sourceContext: gp.sourceContext,
    });
  } catch {
    // 回答は保存・課金済み。次の質問生成だけ失敗 → 明示 surface。retryFollowup で再試行可能。
    return json(
      {
        transcript: ctx.transcript,
        turnIndex: ctx.answerIndex,
        done: false,
        question: null,
        questionError: 'question-generation-failed',
      },
      200,
    );
  }

  const questionIndex = ctx.answerIndex + 1;
  const { error } = await insertTurn(admin, {
    sessionId: session.id,
    userId,
    turnIndex: questionIndex,
    role: 'question',
    source: 'text',
    content: question,
  });
  if (error) {
    // followup 質問の保存だけ失敗 → 明示 surface。retryFollowup で再試行可能。
    devWarn('[interview-ai/turn] followup insert error', error);
    return json(
      {
        transcript: ctx.transcript,
        turnIndex: ctx.answerIndex,
        done: false,
        question: null,
        questionError: 'turn-save-failed',
      },
      200,
    );
  }

  return json(
    {
      transcript: ctx.transcript,
      turnIndex: ctx.answerIndex,
      done: false,
      question,
      questionTurnIndex: questionIndex,
    },
    200,
  );
}
