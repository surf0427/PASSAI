'use client';

// AIプレゼン練習のテーマ設定画面。送信で POST /api/presentation/session → 成功で録画画面へ遷移。
// フロント validation は UX 目的（最終防衛は API 側）。

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import Link from 'next/link';

import { useCurrentUserId } from '@/app/components/AuthProvider';
import { getBrowserSupabaseClient } from '@/lib/supabase/browserClient';
import {
  isAllowedMaterialMime,
  MATERIAL_ACCEPT,
  materialExt,
  PRESENTATION_MATERIAL_BUCKET,
  PRESENTATION_MATERIAL_MAX_BYTES,
} from '@/lib/presentation/material';
import {
  loadUniversitySelection,
  type GeneratedTheme,
  type UniversitySelection,
} from '@/lib/presentation/universitySelection';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

import { PresentationPremiumGate } from '../PresentationPremiumGate';

// API 側の上限に合わせたフロント上限（UX 目的）。
const THEME_MAX = 500;
const SCRIPT_MAX = 20000;
const MINUTES_MIN = 1;
const MINUTES_MAX = 60; // API は time_limit_sec <= 3600（=60分）。

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

export function PresentationSetupClient() {
  const router = useRouter();
  const userId = useCurrentUserId();

  // 大学選択画面で入力した内容（localStorage から復元）。表示と session 保存に使う。
  const [university] = useState<UniversitySelection | null>(() =>
    loadUniversitySelection(),
  );

  // テーマ設定モード。manual=自分で設定 / generated=AI即興テーマ。
  const [themeMode, setThemeMode] = useState<'manual' | 'generated'>('manual');

  const [theme, setTheme] = useState('');
  // 大学選択で制限時間が指定されていれば prefill。
  const [minutes, setMinutes] = useState(
    () => university?.limitMinutes?.trim() || '5',
  );
  const [script, setScript] = useState('');
  const [material, setMaterial] = useState<File | null>(null);
  const [materialError, setMaterialError] = useState<string | null>(null);

  // AI 即興テーマ（generated）。
  const [generated, setGenerated] = useState<GeneratedTheme | null>(null);
  const [generating, setGenerating] = useState(false);
  const [themeGenError, setThemeGenError] = useState<string | null>(null);
  const [excludeThemes, setExcludeThemes] = useState<string[]>([]);
  // 既出の「切り口（angle）」key。多様性収束対策で server に渡して回転回避させる。
  const [excludeAngles, setExcludeAngles] = useState<string[]>([]);

  const [errors, setErrors] = useState<{ theme?: string; minutes?: string }>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // AI 即興テーマを生成（大学選択情報のみ使用・外部検索なし）。重複回避に既出テーマを渡す。
  async function generateTheme() {
    setThemeGenError(null);
    setGenerating(true);
    try {
      const res = await fetch('/api/presentation/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          university_name: university?.universityName ?? '',
          faculty_name: university?.facultyName ?? '',
          department_name: university?.departmentName ?? '',
          admission_type: university?.admissionType ?? '',
          presentation_format: university?.presentationFormat ?? '',
          limit_minutes: university?.limitMinutes ?? '',
          notes: university?.notes ?? '',
          exclude_themes: excludeThemes,
          exclude_angles: excludeAngles,
        }),
      });
      if (!res.ok) {
        if (res.status === 402) {
          setThemeGenError(
            'テーマ生成は Premium 限定です（または今月の利用上限に達しています）。プランをご確認ください。',
          );
        } else {
          setThemeGenError('テーマの生成に失敗しました。もう一度お試しください。');
        }
        return;
      }
      const json = (await res.json()) as GeneratedTheme;
      if (!json.theme) {
        setThemeGenError('テーマの生成に失敗しました。もう一度お試しください。');
        return;
      }
      setGenerated(json);
      setExcludeThemes((prev) => [...prev, json.theme]);
      // AI が返した angle と、サーバが実際に選んだ selectedAngleKey の両方を除外に積む。
      // 両者がズレても、次回同じ切り口が再選択されにくくする（Set で重複除外）。
      const newAngles = [json.angle, json.selectedAngleKey].filter(
        (a): a is string => typeof a === 'string' && a.length > 0,
      );
      if (newAngles.length > 0) {
        setExcludeAngles((prev) => Array.from(new Set([...prev, ...newAngles])));
      }
    } catch {
      setThemeGenError('通信エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setGenerating(false);
    }
  }

  function onMaterialChange(e: React.ChangeEvent<HTMLInputElement>) {
    setMaterialError(null);
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setMaterial(null);
      return;
    }
    if (!isAllowedMaterialMime(file.type)) {
      setMaterial(null);
      setMaterialError('対応形式は PDF・PNG・JPG・JPEG です。');
      return;
    }
    if (file.size > PRESENTATION_MATERIAL_MAX_BYTES) {
      setMaterial(null);
      setMaterialError('ファイルサイズは最大 10MB までです。');
      return;
    }
    setMaterial(file);
  }

  // 資料アップロード（任意）。session 作成後に呼ぶ。失敗時は文字列を返す。
  async function uploadMaterial(sessionId: string): Promise<string | null> {
    if (!material) return null;
    if (!userId) return 'ログイン情報を取得できませんでした。';
    const ext = materialExt(material.type);
    if (!ext) return '対応形式は PDF・PNG・JPG・JPEG です。';
    const supabase = getBrowserSupabaseClient();
    if (!supabase) return 'ストレージに接続できませんでした。';

    const path = `${userId}/${sessionId}/material.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(PRESENTATION_MATERIAL_BUCKET)
      .upload(path, material, { upsert: true, contentType: material.type });
    if (upErr) return '資料のアップロードに失敗しました。';

    const res = await fetch('/api/presentation/material', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        material_mime_type: material.type,
        material_file_name: material.name,
        material_size_bytes: material.size,
      }),
    });
    if (!res.ok) return '資料情報の登録に失敗しました。';
    return null;
  }

  // 確定するテーマ（manual=入力値 / generated=生成結果）。
  function resolvedTheme(): string {
    return themeMode === 'generated'
      ? (generated?.theme ?? '').trim()
      : theme.trim();
  }

  function validate(): { ok: false } | { ok: true; timeLimitSec: number } {
    const next: { theme?: string; minutes?: string } = {};
    if (themeMode === 'manual') {
      if (!theme.trim()) {
        next.theme = 'プレゼンテーマを入力してください。';
      } else if (theme.trim().length > THEME_MAX) {
        next.theme = `テーマは ${THEME_MAX} 文字以内で入力してください。`;
      }
    } else if (!generated?.theme) {
      // generated モードはテーマ生成が前提。
      next.theme = '先にテーマを生成してください。';
    }

    const m = Number(minutes);
    if (!Number.isInteger(m) || m < MINUTES_MIN || m > MINUTES_MAX) {
      next.minutes = `制限時間は ${MINUTES_MIN}〜${MINUTES_MAX} 分の整数で入力してください。`;
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return { ok: false };
    return { ok: true, timeLimitSec: m * 60 };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);
    const v = validate();
    if (!v.ok) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/presentation/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 大学情報は大学選択画面の入力（localStorage）から送る。
          university_name: university?.universityName ?? '',
          faculty_name: university?.facultyName ?? '',
          department_name: university?.departmentName ?? '',
          admission_type: university?.admissionType ?? '',
          presentation_format: university?.presentationFormat ?? '',
          presentation_limit_sec: university?.limitMinutes?.trim()
            ? Number(university.limitMinutes) * 60
            : undefined,
          university_notes: university?.notes ?? '',
          theme: resolvedTheme(),
          time_limit_sec: v.timeLimitSec,
          // generated モードは即興テーマのため原稿は送らない。
          script: themeMode === 'manual' ? script : '',
          theme_mode: themeMode,
          generated_conditions:
            themeMode === 'generated' ? (generated?.conditions ?? []) : undefined,
          generated_questions:
            themeMode === 'generated' ? (generated?.questions ?? []) : undefined,
        }),
      });

      // 201 新規 / 200 in-progress-exists（続きから）。どちらも session.id / timeLimitSec を持つ。
      if (res.ok) {
        const json = (await res.json()) as {
          session?: { id?: string; timeLimitSec?: number };
        };
        const sessionId = json.session?.id;
        if (!sessionId) {
          setApiError('セッションの作成に失敗しました。時間をおいて再度お試しください。');
          return;
        }
        // 資料（任意）があればアップロード＋登録。失敗時はナビゲートせずエラー表示（録り直し可）。
        const matErr = await uploadMaterial(sessionId);
        if (matErr) {
          setApiError(`${matErr} 資料を外すか、もう一度お試しください。`);
          return;
        }
        // record 画面のカウントダウン用に制限時間（秒）も渡す（GET session API は未実装のため query 経由）。
        const limit = json.session?.timeLimitSec ?? v.timeLimitSec;
        router.push(
          `/presentation/record?sessionId=${encodeURIComponent(sessionId)}&limit=${limit}`,
        );
        return;
      }

      if (res.status === 402) {
        setApiError(
          'プレゼン対策は Premium 限定です（または今月の利用上限に達しています）。プランをご確認ください。',
        );
        return;
      }
      if (res.status === 401) {
        setApiError('ログインが必要です。ログインし直してください。');
        return;
      }
      if (res.status === 400) {
        setApiError('入力内容を確認してください。');
        return;
      }
      setApiError('セッションの作成に失敗しました。時間をおいて再度お試しください。');
    } catch {
      setApiError('通信エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PresentationPremiumGate>
      <Card padding="lg">
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {/* 大学選択画面で入力した内容（表示のみ）＋変更導線。 */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-800">志望大学情報</p>
              <Link
                href="/presentation/university"
                className="text-xs text-brand-700 hover:underline"
              >
                大学情報を変更する
              </Link>
            </div>
            {university?.universityName ? (
              <dl className="space-y-0.5 text-sm text-slate-700">
                <Row label="大学" value={university.universityName} />
                <Row label="学部" value={university.facultyName} />
                <Row label="学科" value={university.departmentName} />
                <Row label="入試方式" value={university.admissionType} />
                <Row label="プレゼン形式" value={university.presentationFormat} />
                <Row
                  label="想定制限時間"
                  value={
                    university.limitMinutes.trim()
                      ? `${university.limitMinutes} 分`
                      : ''
                  }
                />
                <Row label="備考" value={university.notes} />
              </dl>
            ) : (
              <p className="text-xs text-slate-500">
                大学情報が未設定です。「大学情報を変更する」から設定できます（任意）。
              </p>
            )}
          </div>

          {/* テーマ設定方法の選択 */}
          <div className="space-y-2">
            <p className="block text-sm font-semibold text-slate-800">テーマ設定方法</p>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="themeMode"
                  className="mt-1"
                  checked={themeMode === 'manual'}
                  onChange={() => setThemeMode('manual')}
                  disabled={submitting}
                />
                <span>自分でテーマを設定する</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="themeMode"
                  className="mt-1"
                  checked={themeMode === 'generated'}
                  onChange={() => setThemeMode('generated')}
                  disabled={submitting}
                />
                <span>
                  AIに即興テーマを作ってもらう
                  <span className="block text-xs text-slate-500">
                    志望大学情報をもとに、本番を想定したテーマ・発表条件・想定質問を生成します。
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* ① 自分で設定（manual） */}
          {themeMode === 'manual' && (
            <>
              <FormField label="プレゼンテーマ" required error={errors.theme}>
                <Input
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  maxLength={THEME_MAX}
                  placeholder="例: 私が大学で取り組みたい研究テーマ"
                />
              </FormField>

              <FormField
                label="発表原稿"
                hint="任意（入力すると AI 評価の補助に使われます）"
              >
                <Textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  maxLength={SCRIPT_MAX}
                  rows={6}
                  placeholder="発表する内容の原稿があれば貼り付けてください。"
                />
              </FormField>
            </>
          )}

          {/* ② AI即興テーマ（generated） */}
          {themeMode === 'generated' && (
            <div className="space-y-3">
              {!generated ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void generateTheme()}
                  disabled={generating || submitting}
                >
                  {generating ? '生成中…' : 'テーマを生成する'}
                </Button>
              ) : (
                <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                  {generated.angleLabel && (
                    <span className="inline-block rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                      テーマの切り口: {generated.angleLabel}
                    </span>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-slate-500">テーマ</p>
                    <p className="text-sm font-medium text-slate-800">
                      {generated.theme}
                    </p>
                  </div>
                  {generated.conditions.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500">発表条件</p>
                      <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                        {generated.conditions.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {generated.questions.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500">想定質問</p>
                      <ol className="list-decimal space-y-0.5 pl-5 text-sm text-slate-700">
                        {generated.questions.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void generateTheme()}
                    disabled={generating || submitting}
                  >
                    {generating ? '生成中…' : '別のテーマを作る'}
                  </Button>
                </div>
              )}
              {errors.theme && !generated && (
                <p className="text-sm text-red-600">{errors.theme}</p>
              )}
              {themeGenError && <AlertBox variant="error">{themeGenError}</AlertBox>}
            </div>
          )}

          <FormField
            label="制限時間（分）"
            required
            hint={`${MINUTES_MIN}〜${MINUTES_MAX} 分`}
            error={errors.minutes}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={MINUTES_MIN}
              max={MINUTES_MAX}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </FormField>

          {/* 発表資料（任意）。PDF/画像をアップロードすると AI が資料も見て評価する。 */}
          <div className="space-y-2">
            <p className="block text-sm font-semibold text-slate-800">
              発表資料{' '}
              <span className="font-normal text-slate-500">任意</span>
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              PDFや画像をアップロードすると、AIが資料と発表内容の両方を見て評価します。
              （PDF・PNG・JPG・JPEG / 最大10MB / 1ファイル）
            </p>
            {material ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                <span className="min-w-0 truncate text-sm text-slate-700">
                  {material.name}{' '}
                  <span className="text-slate-400">({formatBytes(material.size)})</span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setMaterial(null);
                    setMaterialError(null);
                  }}
                  disabled={submitting}
                >
                  削除
                </Button>
              </div>
            ) : (
              <input
                type="file"
                accept={MATERIAL_ACCEPT}
                onChange={onMaterialChange}
                disabled={submitting}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
            )}
            {materialError && <AlertBox variant="error">{materialError}</AlertBox>}
          </div>

          {apiError && <AlertBox variant="error">{apiError}</AlertBox>}

          <Button
            type="submit"
            variant="primary"
            disabled={submitting || (themeMode === 'generated' && !generated)}
          >
            {submitting
              ? '作成中…'
              : themeMode === 'generated'
                ? 'このテーマで練習する'
                : '録画に進む'}
          </Button>
        </form>
      </Card>
    </PresentationPremiumGate>
  );
}

// 大学情報サマリの 1 行（値が空なら「未設定」をグレー表示）。
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words">
        {value.trim() ? value : <span className="text-slate-400">未設定</span>}
      </dd>
    </div>
  );
}
