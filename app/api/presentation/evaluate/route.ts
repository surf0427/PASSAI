/**
 * STEP-PRESENTATION-PR5: プレゼン AI 評価 route（**課金消費はここで初めて行う**）。
 *
 * 文字起こし済みの attempt をもとに PresentationFeedback を生成し presentation_results に保存、
 * 初回のみ presentation_sessions.usage_recorded の compare-and-set で課金消費する。
 *
 * 受信: POST JSON { attempt_id: string }
 *
 * レスポンス:
 *   200 { result: { attemptId, feedback, categories }, attemptStatus, billed }
 *     - 既存 result があれば二重生成・二重課金せず既存を返す（billed:false）。
 *   400 invalid-body | invalid-attempt-id
 *   401 unauthorized
 *   402 quota-exceeded            … ensurePlanQuota（Basic/Free や Premium 上限到達）
 *   403 forbidden-attempt
 *   404 attempt-not-found
 *   409 invalid-attempt-status    … attempt.status が 'transcribed' でない（result も無い）
 *   409 transcript-required       … transcript が空
 *   500 evaluate-failed           … AI 生成 / parse / normalize / 保存失敗（保存も課金もしない）
 *
 * 課金（pr0_design.md §8 / 要対応C）:
 *   - evaluate でも ensurePlanQuota('presentation') を **必ず** 実行（session 作成後のダウングレード抜け道封じ）。
 *   - 課金は「AI 成功 → result 保存成功 → attempt status 更新成功」の後にのみ compare-and-set → recordUsage。
 *   - 失敗経路（gate reject / transcript 不足 / AI 失敗 / parse / 保存失敗）では status='ok' を一切残さない。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';
import {
  generatePresentationFeedback,
  type EvaluateInput,
} from '@/lib/presentation/feedback';
import {
  projectCategories,
  type PresentationFeedback,
} from '@/lib/presentation/feedbackTypes';
import { triggerPresentationBilling } from '@/lib/presentation/billing';
import {
  isAllowedMaterialMime,
  PRESENTATION_MATERIAL_BUCKET,
} from '@/lib/presentation/material';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ATTEMPTS_TABLE = 'presentation_attempts';
const SESSIONS_TABLE = 'presentation_sessions';
const RESULTS_TABLE = 'presentation_results';
const UNIQUE_VIOLATION = '23505';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

type ResultRow = {
  attempt_id: string;
  feedback: unknown;
  categories: unknown;
};

function toResultResponse(row: ResultRow, billed: boolean): Response {
  return json(
    {
      result: {
        attemptId: row.attempt_id,
        feedback: row.feedback,
        categories: row.categories,
      },
      attemptStatus: 'evaluated',
      billed,
    },
    200,
  );
}

export async function POST(req: Request) {
  // 1. gate（auth + quota）。Basic/Free は presentation:0 で 402。Premium 上限到達も 402（要対応C）。
  const gate = await ensurePlanQuota('presentation');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  // 2. body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid-body' }, 400);
  }
  const attemptId =
    typeof (body as Record<string, unknown>)?.attempt_id === 'string'
      ? ((body as Record<string, unknown>).attempt_id as string)
      : '';
  if (!attemptId || !UUID_RE.test(attemptId)) {
    return json({ error: 'invalid-attempt-id' }, 400);
  }

  const admin = getServiceRoleSupabaseClient();

  // 3. attempt 取得 + 所有確認
  const { data: attempt, error: attemptErr } = await admin
    .from(ATTEMPTS_TABLE)
    .select('id, user_id, session_id, status, transcript, duration_sec')
    .eq('id', attemptId)
    .maybeSingle();
  if (attemptErr) {
    devWarn('[presentation/evaluate] attempt fetch error', {
      message: attemptErr.message,
    });
    return failEvaluate(attemptErr);
  }
  if (!attempt) return json({ error: 'attempt-not-found' }, 404);
  if (attempt.user_id !== userId) {
    return json({ error: 'forbidden-attempt' }, 403);
  }

  // 4. 既存 result があれば二重生成・二重課金しない（冪等）。status を問わず既存を返す。
  const { data: existing, error: existingErr } = await admin
    .from(RESULTS_TABLE)
    .select('attempt_id, feedback, categories')
    .eq('attempt_id', attemptId)
    .maybeSingle();
  if (existingErr) {
    devWarn('[presentation/evaluate] existing result fetch error', {
      message: existingErr.message,
    });
    return failEvaluate(existingErr);
  }
  if (existing) {
    // result が存在する = 評価完了済みが真実。過去に status 更新だけ失敗した（result は保存済み）
    // ケースの再試行で attempt.status が 'evaluated' に揃っていない場合は自己修復する。課金はしない。
    if (attempt.status !== 'evaluated') {
      await admin
        .from(ATTEMPTS_TABLE)
        .update({ status: 'evaluated' })
        .eq('id', attemptId);
    }
    return toResultResponse(existing, false);
  }

  // 5. 評価前提の検証（result が無い場合のみ）。
  if (attempt.status !== 'transcribed') {
    return json({ error: 'invalid-attempt-status' }, 409);
  }
  const transcript =
    typeof attempt.transcript === 'string' ? attempt.transcript.trim() : '';
  if (!transcript) {
    return json({ error: 'transcript-required' }, 409);
  }

  const { data: session, error: sessionErr } = await admin
    .from(SESSIONS_TABLE)
    .select(
      'id, user_id, status, university_name, faculty_name, theme, time_limit_sec, script, material_path, material_mime_type, department_name, admission_type, presentation_format, presentation_limit_sec, university_notes, generated_conditions',
    )
    .eq('id', attempt.session_id)
    .maybeSingle();
  if (sessionErr) {
    devWarn('[presentation/evaluate] session fetch error', {
      message: sessionErr.message,
    });
    return failEvaluate(sessionErr);
  }
  if (!session || session.user_id !== userId || session.status !== 'in_progress') {
    return json({ error: 'forbidden-attempt' }, 403);
  }

  // 6. 添付資料があれば Storage から取得して評価に渡す（PDF/画像 → base64）。
  //    取得失敗時は資料なしで評価を続行する（ユーザーをブロックしない / 劣化動作）。
  const material = await loadMaterial(
    admin,
    typeof session.material_path === 'string' ? session.material_path : '',
    typeof session.material_mime_type === 'string' ? session.material_mime_type : '',
  );

  // 7. AI 評価生成（失敗は PresentationFeedbackError → evaluate-failed。保存も課金もしない）。
  const input: EvaluateInput = {
    transcript,
    durationSec: attempt.duration_sec ?? 0,
    timeLimitSec: session.time_limit_sec ?? 0,
    universityName: session.university_name ?? '',
    facultyName: session.faculty_name ?? '',
    theme: session.theme ?? '',
    script: session.script ?? '',
    departmentName:
      typeof session.department_name === 'string' ? session.department_name : '',
    admissionType:
      typeof session.admission_type === 'string' ? session.admission_type : '',
    presentationFormat:
      typeof session.presentation_format === 'string'
        ? session.presentation_format
        : '',
    presentationLimitSec:
      typeof session.presentation_limit_sec === 'number'
        ? session.presentation_limit_sec
        : null,
    universityNotes:
      typeof session.university_notes === 'string' ? session.university_notes : '',
    conditions: Array.isArray(session.generated_conditions)
      ? (session.generated_conditions as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        )
      : [],
  };
  let feedback: PresentationFeedback;
  try {
    feedback = await generatePresentationFeedback(input, material ?? undefined);
  } catch (err) {
    devWarn('[presentation/evaluate] generation failed', {
      name: (err as Error)?.name,
      message: (err as Error)?.message,
    });
    // AI / parse / normalize 失敗。usage は一切書かない（status='ok' を残さない）。
    return json({ error: 'evaluate-failed' }, 500);
  }

  const categories = projectCategories(feedback);

  // 7. result 保存（UNIQUE(attempt_id) で race の二重 insert を捕捉）。
  const { data: inserted, error: insertErr } = await admin
    .from(RESULTS_TABLE)
    .insert({
      attempt_id: attemptId,
      user_id: userId,
      feedback,
      categories,
    })
    .select('attempt_id, feedback, categories')
    .single();

  if (insertErr) {
    if (insertErr.code === UNIQUE_VIOLATION) {
      // race: 別プロセスが先に保存。既存を返す。課金は勝者プロセスが行う（本プロセスは課金しない）。
      const { data: raced } = await admin
        .from(RESULTS_TABLE)
        .select('attempt_id, feedback, categories')
        .eq('attempt_id', attemptId)
        .maybeSingle();
      if (raced) return toResultResponse(raced, false);
    }
    devWarn('[presentation/evaluate] result insert error', {
      code: insertErr.code,
      message: insertErr.message,
    });
    return failEvaluate(insertErr);
  }

  // 8. attempt.status を evaluated に更新。失敗時は課金しない（要件9）。
  const { error: statusErr } = await admin
    .from(ATTEMPTS_TABLE)
    .update({ status: 'evaluated' })
    .eq('id', attemptId);
  if (statusErr) {
    devWarn('[presentation/evaluate] attempt status update error', {
      message: statusErr.message,
    });
    // result は保存済みだが status 更新に失敗 → 課金しない（fail-closed: 計上漏れ > 二重課金）。
    return failEvaluate(statusErr);
  }

  // 9. 課金: 初回のみ compare-and-set → recordUsage('presentation','ok')。
  //    録り直し / 別 attempt 評価では usage_recorded が既に true なので billed:false。
  const { billed } = await triggerPresentationBilling({
    admin,
    sessionId: attempt.session_id,
    userId,
  });

  return toResultResponse(inserted, billed);
}

// 添付資料を Storage から取得して { mimeType, base64 } を返す。無効/取得失敗時は null
// （資料なしで評価続行）。
async function loadMaterial(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  path: string,
  mimeType: string,
): Promise<{ mimeType: string; base64: string } | null> {
  if (!path || !isAllowedMaterialMime(mimeType)) return null;
  try {
    const { data, error } = await admin.storage
      .from(PRESENTATION_MATERIAL_BUCKET)
      .download(path);
    if (error || !data) {
      devWarn('[presentation/evaluate] material download failed', {
        message: error?.message,
      });
      return null;
    }
    const buf = Buffer.from(await data.arrayBuffer());
    return { mimeType, base64: buf.toString('base64') };
  } catch (err) {
    devWarn('[presentation/evaluate] material load threw', err);
    return null;
  }
}

function failEvaluate(err: unknown): Response {
  captureRouteException(
    err,
    { route: 'presentation/evaluate', feature: 'presentation', status: 500 },
    { status: 500, code: 'evaluate-failed' },
  );
  return json({ error: 'evaluate-failed' }, 500);
}
