/**
 * STEP-PRESENTATION-THEME-MODE: AI 即興テーマ生成 route。
 *
 * 大学選択画面の手入力情報（クライアントから受領）をもとに、テーマ・発表条件・想定質問を生成する。
 * session 作成前に呼ぶ想定のため DB 書込はしない（結果は setup → session 作成時に保存）。
 * 外部検索はしない。
 *
 * 受信: POST JSON
 *   { university_name, faculty_name, department_name, admission_type,
 *     presentation_format, limit_minutes, notes, exclude_themes? }
 *
 * レスポンス:
 *   200 { theme, conditions: string[], questions: string[],
 *         angle?: string, selectedAngleKey?: string, angleLabel?: string }
 *        多様性収束対策の「切り口」（DB 非保存）。angle=AI が返した有効値 / selectedAngleKey=
 *        サーバが実際に選んだ chosen.key。client は両方を除外に積み回転精度を上げる。
 *        angleLabel は表示用。
 *   400 invalid-body
 *   401 unauthorized
 *   402 quota-exceeded   … Premium 限定（Basic/Free は presentation:0 で 402）
 *   500 theme-failed
 *
 * 権限/課金:
 *   - ensurePlanQuota('presentation') で **Premium 限定**にする（session/evaluate と整合）。
 *     ensurePlanQuota は profiles 読取＋当月 usage の COUNT のみで **usage を消費しない**ため、
 *     非課金のまま Premium 判定でき、API 直叩きでも Basic/Free を 402 で弾ける。
 *   - recordUsage は呼ばない（logAiUsage のみ）。消費は evaluate の初回成功時のみ。
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { devWarn } from '@/lib/devLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import {
  PRESENTATION_THEME_EXCLUDE_ANGLE_MAX,
  PRESENTATION_THEME_EXCLUDE_MAX,
} from '@/lib/presentation/constants';
import {
  generatePresentationTheme,
  ThemeGenerationError,
} from '@/lib/presentation/themeGen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function json(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status });
}

function s(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export async function POST(req: Request) {
  // Premium 限定ゲート（usage は消費しない）。Basic/Free / 上限到達は 402。
  const gate = await ensurePlanQuota('presentation');
  if (gate.kind === 'reject') return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid-body' }, 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const excludeThemes = Array.isArray(b.exclude_themes)
    ? b.exclude_themes
        .filter((x): x is string => typeof x === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, PRESENTATION_THEME_EXCLUDE_MAX)
    : [];

  const excludeAngles = Array.isArray(b.exclude_angles)
    ? b.exclude_angles
        .filter((x): x is string => typeof x === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, PRESENTATION_THEME_EXCLUDE_ANGLE_MAX)
    : [];

  try {
    const result = await generatePresentationTheme({
      universityName: s(b.university_name),
      facultyName: s(b.faculty_name),
      departmentName: s(b.department_name),
      admissionType: s(b.admission_type),
      presentationFormat: s(b.presentation_format),
      limitMinutes: s(b.limit_minutes),
      notes: s(b.notes),
      excludeThemes,
      excludeAngles,
    });
    return json({ ...result }, 200);
  } catch (err) {
    if (err instanceof ThemeGenerationError) {
      devWarn('[presentation/theme] generation error', { message: err.message });
      return json({ error: 'theme-failed' }, 500);
    }
    captureRouteException(
      err,
      { route: 'presentation/theme', feature: 'presentation', status: 500 },
      { status: 500, code: 'theme-failed' },
    );
    return json({ error: 'theme-failed' }, 500);
  }
}
