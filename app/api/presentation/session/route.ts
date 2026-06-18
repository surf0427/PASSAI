/**
 * STEP-PRESENTATION-PR2: プレゼン練習セッション作成 route。
 *
 * 受信:
 *   POST {
 *     university_name?: string,
 *     faculty_name?: string,
 *     theme: string,               // 必須
 *     time_limit_sec: number,      // 正の整数
 *     script?: string,             // 任意（発表原稿）
 *   }
 *
 * レスポンス:
 *   201 { session: { id, status, universityName, facultyName, theme, timeLimitSec, hasScript, createdAt } }
 *   200 { error: 'in-progress-exists', session } … 既存 in_progress があれば「続きから」誘導
 *   400 { error: 'invalid-body' | 'theme-required' | 'invalid-time-limit' | 'field-too-long' }
 *   401 / 402 … ensurePlanQuota が返す未認証 / quota 超過（= Basic/Free は 402）Response
 *   500 { error: 'session-create-failed' }
 *
 * 設計（docs/presentation/pr0_design.md §6 / §8）:
 *   - gate: ensurePlanQuota('presentation') を **作成前** に判定する。presentation quota は
 *     free:0 / basic:0 / premium:20 のため、Basic/Free は entry で 402 reject ＝ Premium 限定。
 *   - recordUsage は本 route では **呼ばない**。課金消費は evaluate route の初回 AI 評価成功時のみ
 *     （presentation_sessions.usage_recorded の compare-and-set）。本 route は in_progress を作るだけ。
 *   - in_progress は user ごと 1 件まで（schema §64 部分 unique index presentation_sessions_one_in_progress）。
 *     重複作成は 23505 で弾かれ、既存 in_progress を返す（続きから）。これが deferred recordUsage の
 *     quota 回避を封じる要。
 *   - insert は service_role（server-only）で行う。userId は gate で認証済み。
 *   - usage_recorded は false 初期値（compare-and-set は evaluate route）。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { getServiceRoleSupabaseClient } from '@/lib/supabase/serviceRoleClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLE = 'presentation_sessions';
// in_progress 部分 unique index 違反の Postgres SQLSTATE。
const UNIQUE_VIOLATION = '23505';

// 暴走 payload ガード（DB 列は text だが入口で上限を切る）。
const SHORT_FIELD_MAX_CHARS = 200; // university / faculty / department / admission / format
const THEME_MAX_CHARS = 500;
const SCRIPT_MAX_CHARS = 20000; // 発表原稿（任意・長文を許容しつつ上限）
const NOTES_MAX_CHARS = 2000; // 大学情報の備考
// 制限時間の上限（秒）。MVP は発表時間に上限を設ける方針（pr0_design.md §12）。
const TIME_LIMIT_MAX_SEC = 60 * 60; // 1 時間

// 大学選択の任意 text フィールドを trim して取り出すヘルパ。
function optStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// generated テーマの配列（発表条件 / 想定質問）を string[] に正規化（最大件数・空除去）。
function cleanStrArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (t) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

const SELECT_COLS =
  'id, status, university_name, faculty_name, theme, time_limit_sec, script, created_at';

type CreatedSession = {
  id: string;
  status: string;
  universityName: string;
  facultyName: string;
  theme: string;
  timeLimitSec: number;
  hasScript: boolean;
  createdAt: string;
};

export async function POST(req: Request) {
  // 1. gate（auth + quota）。reject なら 401 / 402 をそのまま返す（Basic/Free は presentation:0 で 402）。
  const gate = await ensurePlanQuota('presentation');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  // 2. body parse / validate
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const theme = typeof b.theme === 'string' ? b.theme.trim() : '';
  if (!theme) {
    return NextResponse.json({ error: 'theme-required' }, { status: 400 });
  }

  // time_limit_sec は正の整数（0 や負数・小数・非数値は弾く）。
  const timeLimitSec = b.time_limit_sec;
  if (
    typeof timeLimitSec !== 'number' ||
    !Number.isInteger(timeLimitSec) ||
    timeLimitSec <= 0 ||
    timeLimitSec > TIME_LIMIT_MAX_SEC
  ) {
    return NextResponse.json({ error: 'invalid-time-limit' }, { status: 400 });
  }

  const universityName = optStr(b.university_name);
  const facultyName = optStr(b.faculty_name);
  const script = typeof b.script === 'string' ? b.script : '';

  // 大学選択（任意）。すべて手入力・空なら null 保存。
  const departmentName = optStr(b.department_name);
  const admissionType = optStr(b.admission_type);
  const presentationFormat = optStr(b.presentation_format);
  const universityNotes = optStr(b.university_notes);

  // presentation_limit_sec は任意。指定時は正の整数のみ採用、不正/未指定は null。
  const rawPlimit = b.presentation_limit_sec;
  const presentationLimitSec =
    typeof rawPlimit === 'number' &&
    Number.isInteger(rawPlimit) &&
    rawPlimit > 0 &&
    rawPlimit <= TIME_LIMIT_MAX_SEC
      ? rawPlimit
      : null;

  // テーマ設定モード。'generated' のときのみ条件/質問を保存（それ以外は null）。
  const themeMode = b.theme_mode === 'generated' ? 'generated' : 'manual';
  const generatedConditions =
    themeMode === 'generated' ? cleanStrArray(b.generated_conditions, 6) : null;
  const generatedQuestions =
    themeMode === 'generated' ? cleanStrArray(b.generated_questions, 5) : null;

  if (
    universityName.length > SHORT_FIELD_MAX_CHARS ||
    facultyName.length > SHORT_FIELD_MAX_CHARS ||
    departmentName.length > SHORT_FIELD_MAX_CHARS ||
    admissionType.length > SHORT_FIELD_MAX_CHARS ||
    presentationFormat.length > SHORT_FIELD_MAX_CHARS ||
    theme.length > THEME_MAX_CHARS ||
    script.length > SCRIPT_MAX_CHARS ||
    universityNotes.length > NOTES_MAX_CHARS
  ) {
    return NextResponse.json({ error: 'field-too-long' }, { status: 400 });
  }

  const admin = getServiceRoleSupabaseClient();

  // 3. in_progress セッションを insert（usage_recorded=false 初期値）。
  //    課金は本 route では行わない（消費は evaluate route の初回 AI 評価成功時のみ）。
  try {
    const { data, error } = await admin
      .from(TABLE)
      .insert({
        user_id: userId,
        status: 'in_progress',
        usage_recorded: false,
        university_name: universityName,
        faculty_name: facultyName,
        department_name: departmentName || null,
        admission_type: admissionType || null,
        presentation_format: presentationFormat || null,
        presentation_limit_sec: presentationLimitSec,
        university_notes: universityNotes || null,
        theme,
        time_limit_sec: timeLimitSec,
        script,
        theme_mode: themeMode,
        generated_conditions: generatedConditions,
        generated_questions: generatedQuestions,
      })
      .select(SELECT_COLS)
      .single();

    if (error) {
      // 3a. in_progress 重複（§64 部分 unique index）→ 既存セッションを返す（続きから）。
      if (error.code === UNIQUE_VIOLATION) {
        return await respondWithExistingInProgress(admin, userId);
      }
      devWarn('[presentation/session] insert error', {
        code: error.code,
        message: error.message,
      });
      captureRouteException(
        error,
        { route: 'presentation/session', feature: 'presentation', status: 500 },
        { status: 500, code: 'session-create-failed' },
      );
      return NextResponse.json(
        { error: 'session-create-failed' },
        { status: 500 },
      );
    }

    return NextResponse.json({ session: toCreatedSession(data) }, { status: 201 });
  } catch (err) {
    devWarn('[presentation/session] insert threw', err);
    captureRouteException(
      err,
      { route: 'presentation/session', feature: 'presentation', status: 500 },
      { status: 500, code: 'session-create-failed' },
    );
    return NextResponse.json(
      { error: 'session-create-failed' },
      { status: 500 },
    );
  }
}

// 既存の in_progress セッションを取得して「続きから」用に返す。
// race condition で unique violation が起きても、ここで再 SELECT して既存 session を返す。
// 取得できなければ（competing delete 等の境界ケース）500 に倒す。
async function respondWithExistingInProgress(
  admin: ReturnType<typeof getServiceRoleSupabaseClient>,
  userId: string,
): Promise<Response> {
  const { data, error } = await admin
    .from(TABLE)
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .eq('status', 'in_progress')
    .maybeSingle();

  if (error || !data) {
    devWarn('[presentation/session] existing in_progress fetch failed', {
      message: error?.message,
    });
    return NextResponse.json(
      { error: 'session-create-failed' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { error: 'in-progress-exists', session: toCreatedSession(data) },
    { status: 200 },
  );
}

function toCreatedSession(row: {
  id: string;
  status: string;
  university_name?: string | null;
  faculty_name?: string | null;
  theme?: string | null;
  time_limit_sec?: number | null;
  script?: string | null;
  created_at: string;
}): CreatedSession {
  return {
    id: row.id,
    status: row.status,
    universityName: row.university_name ?? '',
    facultyName: row.faculty_name ?? '',
    theme: row.theme ?? '',
    timeLimitSec: row.time_limit_sec ?? 0,
    // script 本文はレスポンスに含めず、有無のみ返す（不要な往復・漏えい面の縮小）。
    hasScript: Boolean(row.script && row.script.length > 0),
    createdAt: row.created_at,
  };
}
