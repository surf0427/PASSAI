'use client';

// STEP-INTERVIEW-AI-PR9: 面接 AI UI の client fetch ヘルパ。
//
// route の HTTP status / body を UI が分岐しやすい discriminated union に正規化する。
// server-only モジュール（lib/interviewAi/*）は import しない（client 安全）。

export type AiSession = {
  id: string;
  source: 'voice' | 'text';
  status: string;
  targetRef: Record<string, unknown>;
  interviewType?: string;
  createdAt?: string;
};

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ── セッション作成 ───────────────────────────────────────────────
export type CreateSessionResult =
  | { kind: 'created'; session: AiSession }
  | { kind: 'in-progress-exists'; session: AiSession }
  | { kind: 'quota-exceeded' }
  | { kind: 'unauthenticated' }
  | { kind: 'error'; error: string };

export async function createSession(input: {
  source: 'voice' | 'text';
  targetRef: Record<string, unknown>;
  interviewType: string;
  sourceType: string | null;
  sourceId: string | null;
  sourceContext: string;
}): Promise<CreateSessionResult> {
  const res = await fetch('/api/interview-ai/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await parseJson(res);
  if (res.status === 201 && body.session) {
    return { kind: 'created', session: body.session as AiSession };
  }
  // 409 IN_PROGRESS_EXISTS 相当（route は 200 + error:'in-progress-exists' を返す）
  if (body.error === 'in-progress-exists' && body.session) {
    return { kind: 'in-progress-exists', session: body.session as AiSession };
  }
  if (res.status === 402) return { kind: 'quota-exceeded' };
  if (res.status === 401) return { kind: 'unauthenticated' };
  return { kind: 'error', error: String(body.error ?? 'session-create-failed') };
}

// ── 現在の未完了セッション取得（ページ表示時の再開検出 / STEP2 req ①） ─────────
//   GET /api/interview-ai/session。in_progress があれば session、無ければ null。
//   recordUsage も quota 消費もしない read-only。server を単一情報源として復元する。
export type ActiveSessionResult =
  | { kind: 'active'; session: AiSession }
  | { kind: 'none' }
  | { kind: 'error'; error: string };

export async function getActiveSession(): Promise<ActiveSessionResult> {
  let res: Response;
  try {
    res = await fetch('/api/interview-ai/session', { method: 'GET', cache: 'no-store' });
  } catch {
    return { kind: 'error', error: 'active-fetch-failed' };
  }
  const body = await parseJson(res);
  if (res.ok) {
    return body.session
      ? { kind: 'active', session: body.session as AiSession }
      : { kind: 'none' };
  }
  if (res.status === 401) return { kind: 'none' }; // 未認証はサイレント（再開導線を出さないだけ）
  return { kind: 'error', error: String(body.error ?? 'active-fetch-failed') };
}

// ── ターン状態（再開用） ─────────────────────────────────────────
export type SessionTurn = { role: 'question' | 'answer'; content: string };

export type SessionState = {
  sessionId: string;
  source: 'voice' | 'text';
  status: string;
  interviewType?: string;
  currentQuestion: string | null;
  needsKickoff: boolean;
  needsRetry: boolean;
  answerCount: number;
  done: boolean;
  // 回答済みターン（表示専用の復元に使う。質問数の正は answerCount）。
  turns?: SessionTurn[];
};

export type StateResult =
  | { kind: 'ok'; state: SessionState }
  | { kind: 'error'; status: number; error: string };

export async function getSessionState(sessionId: string): Promise<StateResult> {
  const res = await fetch(
    `/api/interview-ai/state?sessionId=${encodeURIComponent(sessionId)}`,
    { cache: 'no-store' },
  );
  const body = await parseJson(res);
  if (res.ok) return { kind: 'ok', state: body as unknown as SessionState };
  return { kind: 'error', status: res.status, error: String(body.error ?? 'state-failed') };
}

// ── kickoff（seed 質問） ─────────────────────────────────────────
export type QuestionResult =
  | { kind: 'question'; question: string }
  | { kind: 'error'; error: string };

export async function kickoff(sessionId: string): Promise<QuestionResult> {
  const res = await fetch('/api/interview-ai/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, kickoff: true }),
  });
  const body = await parseJson(res);
  if (res.ok && typeof body.question === 'string') {
    return { kind: 'question', question: body.question };
  }
  return { kind: 'error', error: String(body.error ?? 'question-generation-failed') };
}

// ── 回答（text / voice）+ retryFollowup の共通レスポンス ───────────
export type AnswerResult =
  | { kind: 'next'; transcript: string; question: string }
  | { kind: 'question-error'; transcript: string; questionError: string }
  | { kind: 'done'; transcript: string }
  | { kind: 'stt-error'; error: 'stt-unavailable' | 'stt-failed' }
  | { kind: 'limit' }
  | { kind: 'error'; error: string };

function mapAnswerBody(res: Response, body: Record<string, unknown>): AnswerResult {
  // STT 失敗（voice）
  if (res.status === 502 && (body.error === 'stt-unavailable' || body.error === 'stt-failed')) {
    return { kind: 'stt-error', error: body.error as 'stt-unavailable' | 'stt-failed' };
  }
  if (res.status === 409 && body.error === 'turn-limit-reached') {
    return { kind: 'limit' };
  }
  if (!res.ok && res.status !== 200) {
    return { kind: 'error', error: String(body.error ?? 'turn-failed') };
  }
  // 200 系
  if (body.done === true) {
    return { kind: 'done', transcript: String(body.transcript ?? '') };
  }
  if (typeof body.question === 'string') {
    return {
      kind: 'next',
      transcript: String(body.transcript ?? ''),
      question: body.question,
    };
  }
  if (body.questionError) {
    return {
      kind: 'question-error',
      transcript: String(body.transcript ?? ''),
      questionError: String(body.questionError),
    };
  }
  return { kind: 'error', error: String(body.error ?? 'turn-failed') };
}

// presetQuestion（任意）= 先読み採用候補。server が有効な候補を次質問として保存し、AI 生成を省く。
// 無効 / 未指定なら server は従来どおり生成する（フォールバック）。課金・保存仕様は不変。
export async function submitTextAnswer(
  sessionId: string,
  answer: string,
  presetQuestion?: string | null,
): Promise<AnswerResult> {
  const res = await fetch('/api/interview-ai/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      answer,
      ...(presetQuestion ? { presetQuestion } : {}),
    }),
  });
  return mapAnswerBody(res, await parseJson(res));
}

export async function submitVoiceAnswer(
  sessionId: string,
  audio: Blob,
  presetQuestion?: string | null,
): Promise<AnswerResult> {
  const form = new FormData();
  form.append('sessionId', sessionId);
  form.append('audio', audio, 'answer.webm');
  if (presetQuestion) form.append('presetQuestion', presetQuestion);
  const res = await fetch('/api/interview-ai/turn', { method: 'POST', body: form });
  return mapAnswerBody(res, await parseJson(res));
}

// ── 次質問の先読み（候補生成。保存も課金もしない。失敗時は候補なしで従来生成にフォールバック）──
export type PrefetchResult =
  | { kind: 'candidate'; question: string }
  | { kind: 'none' };

export async function prefetchNextQuestion(sessionId: string): Promise<PrefetchResult> {
  let res: Response;
  try {
    res = await fetch('/api/interview-ai/prefetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  } catch {
    return { kind: 'none' };
  }
  const body = await parseJson(res);
  if (res.ok && typeof body.candidate === 'string' && body.candidate.trim()) {
    return { kind: 'candidate', question: body.candidate };
  }
  return { kind: 'none' };
}

// ── STT（音声 → transcript）。保存も課金もしない。失敗時はテキスト入力にフォールバック ──
export type TranscribeResult =
  | { kind: 'ok'; transcript: string }
  | { kind: 'error'; error: 'stt-unavailable' | 'stt-failed' | string };

export async function transcribeVoice(audio: Blob): Promise<TranscribeResult> {
  const form = new FormData();
  // Blob.type（mimeType）はサーバ側で保持される。ファイル名は補助。
  form.append('audio', audio, 'answer');
  let res: Response;
  try {
    res = await fetch('/api/interview-ai/stt', { method: 'POST', body: form });
  } catch {
    return { kind: 'error', error: 'stt-failed' };
  }
  const body = await parseJson(res);
  if (res.ok && typeof body.transcript === 'string') {
    return { kind: 'ok', transcript: body.transcript };
  }
  return { kind: 'error', error: String(body.error ?? 'stt-failed') };
}

// ── TTS（AI 質問テキスト → 音声）。保存も課金もしない。失敗時はテキスト表示のまま続行 ──
export type SynthesizeResult =
  | { kind: 'ok'; audio: Blob }
  | { kind: 'error'; error: 'tts-unavailable' | 'tts-failed' | string };

export async function synthesizeSpeech(
  text: string,
  interviewType?: string | null,
): Promise<SynthesizeResult> {
  let res: Response;
  try {
    res = await fetch('/api/interview-ai/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // interviewType でモード別の話し方を切り替える（route が不正値を無視するので素直に送る）。
      body: JSON.stringify({ text, interviewType: interviewType ?? null }),
    });
  } catch {
    return { kind: 'error', error: 'tts-failed' };
  }
  if (res.ok && (res.headers.get('content-type') ?? '').startsWith('audio/')) {
    const audio = await res.blob();
    if (audio.size > 0) return { kind: 'ok', audio };
    return { kind: 'error', error: 'tts-failed' };
  }
  const body = await parseJson(res);
  return { kind: 'error', error: String(body.error ?? 'tts-failed') };
}

export async function retryFollowup(sessionId: string): Promise<AnswerResult> {
  const res = await fetch('/api/interview-ai/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, retryFollowup: true }),
  });
  return mapAnswerBody(res, await parseJson(res));
}

// ── 完了 / 中断 ─────────────────────────────────────────────────
export type CompleteResult =
  | {
      kind: 'completed';
      feedbackText: string;
      strengths: string[];
      improvements: string[];
      nextPractice: string[];
    }
  | { kind: 'feedback-error'; error: string }
  | { kind: 'error'; error: string };

export async function completeSession(sessionId: string): Promise<CompleteResult> {
  const res = await fetch('/api/interview-ai/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  const body = await parseJson(res);
  if (res.ok && body.status === 'completed') {
    const fb = (body.feedback ?? {}) as { overallEvaluation?: unknown };
    return {
      kind: 'completed',
      feedbackText:
        typeof fb.overallEvaluation === 'string' ? fb.overallEvaluation : '',
      strengths: asStrings(body.strengths),
      improvements: asStrings(body.improvements),
      nextPractice: asStrings(body.nextPractice),
    };
  }
  if (res.status === 502) {
    return { kind: 'feedback-error', error: String(body.error ?? 'feedback-generation-failed') };
  }
  return { kind: 'error', error: String(body.error ?? 'complete-failed') };
}

export type AbandonResult = { kind: 'abandoned' } | { kind: 'error'; error: string };

export async function abandonSession(sessionId: string): Promise<AbandonResult> {
  const res = await fetch('/api/interview-ai/abandon', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  const body = await parseJson(res);
  if (res.ok && body.status === 'abandoned') return { kind: 'abandoned' };
  return { kind: 'error', error: String(body.error ?? 'abandon-failed') };
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string');
}
