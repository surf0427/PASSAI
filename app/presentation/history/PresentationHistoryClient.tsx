'use client';

// プレゼン練習履歴。本人の presentation_attempts / presentation_results を client 直読み
// （RLS owner SELECT で本人分のみ）。evaluated は結果詳細へ、未完了は状態表示＋録画へ戻る導線。

import { useEffect, useRef, useState } from 'react';

import { getBrowserSupabaseClient } from '@/lib/supabase/browserClient';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';

import { PresentationPremiumGate } from '../PresentationPremiumGate';
import {
  parseUniversityInfo,
  UniversityInfoLine,
  type UniversityInfo,
} from '../universityInfoView';

type Level = 'weak' | 'normal' | 'strong';

const CATEGORY_KEYS = [
  'composition',
  'persuasion',
  'concreteness',
  'clarity',
  'timeManagement',
  'completeness',
];

const STATUS_LABEL: Record<string, string> = {
  uploaded: 'アップロード済み（文字起こし待ち）',
  transcribed: '文字起こし済み（AI評価待ち）',
  evaluated: '評価完了',
  failed: '失敗',
};
const STATUS_CLASS: Record<string, string> = {
  uploaded: 'bg-slate-100 text-slate-700',
  transcribed: 'bg-indigo-100 text-indigo-800',
  evaluated: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-amber-100 text-amber-800',
};

type ResultInfo = { overallComment: string; categories: Record<string, unknown> };
type Item = {
  id: string;
  sessionId: string;
  status: string;
  durationSec: number;
  createdAt: string;
  result: ResultInfo | null;
  hasMaterial: boolean;
  // 発表資料が TTL（90日）で削除済みか。true なら「資料保存期限切れ」を表示する。
  materialDeleted: boolean;
  university: UniversityInfo | null;
  themeMode: string;
  // 永続化済みの発表後 Q&A 交換の件数。
  qaCount: number;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: Item[] };

function isLevel(v: unknown): v is Level {
  return v === 'weak' || v === 'normal' || v === 'strong';
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}

function categorySummary(categories: Record<string, unknown>): string {
  let strong = 0;
  let normal = 0;
  let weak = 0;
  for (const k of CATEGORY_KEYS) {
    const v = categories[k];
    if (v === 'strong') strong += 1;
    else if (v === 'weak') weak += 1;
    else if (isLevel(v)) normal += 1;
  }
  return `良い ${strong} / 標準 ${normal} / 要改善 ${weak}`;
}

function snippet(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function PresentationHistoryClient() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function load() {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) {
        if (!cancelledRef.current) setState({ kind: 'error' });
        return;
      }

      // attempts（新しい順）。RLS owner SELECT で本人分のみ。
      const { data: attempts, error: attemptsErr } = await supabase
        .from('presentation_attempts')
        .select('id, session_id, status, duration_sec, created_at')
        .order('created_at', { ascending: false });
      if (cancelledRef.current) return;
      if (attemptsErr) {
        setState({ kind: 'error' });
        return;
      }

      // results（本人分）→ attempt_id でマップ化。
      const { data: results, error: resultsErr } = await supabase
        .from('presentation_results')
        .select('attempt_id, feedback, categories');
      if (cancelledRef.current) return;
      if (resultsErr) {
        setState({ kind: 'error' });
        return;
      }

      const resultMap = new Map<string, ResultInfo>();
      for (const r of results ?? []) {
        const fb = (r.feedback ?? {}) as Record<string, unknown>;
        resultMap.set(r.attempt_id as string, {
          overallComment:
            typeof fb.overallComment === 'string' ? fb.overallComment : '',
          categories:
            r.categories && typeof r.categories === 'object'
              ? (r.categories as Record<string, unknown>)
              : {},
        });
      }

      // session 単位の情報（資料の有無 / 想定大学情報）。
      const { data: sessions } = await supabase
        .from('presentation_sessions')
        .select(
          'id, material_path, material_deleted_at, university_name, faculty_name, department_name, admission_type, presentation_format, presentation_limit_sec, university_notes, theme_mode',
        );
      if (cancelledRef.current) return;
      const materialSessionIds = new Set<string>();
      const materialDeletedSessionIds = new Set<string>();
      const universityMap = new Map<string, UniversityInfo | null>();
      const themeModeMap = new Map<string, string>();
      for (const s of sessions ?? []) {
        if (s.material_path) materialSessionIds.add(s.id as string);
        if (s.material_deleted_at) materialDeletedSessionIds.add(s.id as string);
        universityMap.set(s.id as string, parseUniversityInfo(s));
        themeModeMap.set(
          s.id as string,
          typeof s.theme_mode === 'string' ? s.theme_mode : 'manual',
        );
      }

      // 発表後 Q&A 履歴の件数（attempt 単位）。RLS owner SELECT で本人分のみ。失敗は 0 件扱い。
      const { data: qaRows } = await supabase
        .from('presentation_qa_reviews')
        .select('attempt_id');
      if (cancelledRef.current) return;
      const qaCountMap = new Map<string, number>();
      for (const q of qaRows ?? []) {
        const aid = q.attempt_id as string;
        qaCountMap.set(aid, (qaCountMap.get(aid) ?? 0) + 1);
      }

      const items: Item[] = (attempts ?? []).map((a) => ({
        id: a.id as string,
        sessionId: (a.session_id as string) ?? '',
        status: (a.status as string) ?? '',
        durationSec: (a.duration_sec as number) ?? 0,
        createdAt: (a.created_at as string) ?? '',
        result: resultMap.get(a.id as string) ?? null,
        hasMaterial: materialSessionIds.has((a.session_id as string) ?? ''),
        materialDeleted: materialDeletedSessionIds.has(
          (a.session_id as string) ?? '',
        ),
        university: universityMap.get((a.session_id as string) ?? '') ?? null,
        themeMode: themeModeMap.get((a.session_id as string) ?? '') ?? 'manual',
        qaCount: qaCountMap.get(a.id as string) ?? 0,
      }));

      setState({ kind: 'ready', items });
    }

    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  return (
    <PresentationPremiumGate>
      <HistoryBody state={state} />
    </PresentationPremiumGate>
  );
}

function HistoryBody({ state }: { state: LoadState }) {
  if (state.kind === 'loading') {
    return <p className="text-sm text-slate-500">読み込み中…</p>;
  }
  if (state.kind === 'error') {
    return (
      <AlertBox variant="error">
        履歴の読み込みに失敗しました。時間をおいて再度お試しください。
      </AlertBox>
    );
  }
  if (state.items.length === 0) {
    return (
      <Card padding="lg" className="space-y-4">
        <p className="text-sm text-slate-600">まだプレゼン練習の履歴がありません。</p>
        <LinkButton href="/presentation/setup" variant="primary">
          テーマ設定へ
        </LinkButton>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {state.items.map((item) => (
        <HistoryCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function HistoryCard({ item }: { item: Item }) {
  const isEvaluated = item.status === 'evaluated' && item.result !== null;
  return (
    <Card padding="lg" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-500">{formatDateTime(item.createdAt)}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            STATUS_CLASS[item.status] ?? 'bg-slate-100 text-slate-700'
          }`}
        >
          {STATUS_LABEL[item.status] ?? item.status}
        </span>
      </div>

      {item.university && <UniversityInfoLine info={item.university} />}

      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span>録画時間: {formatDuration(item.durationSec)}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            item.materialDeleted
              ? 'bg-amber-50 text-amber-700'
              : item.hasMaterial
                ? 'bg-indigo-50 text-indigo-700'
                : 'bg-slate-100 text-slate-500'
          }`}
        >
          {item.materialDeleted
            ? '資料保存期限切れ'
            : item.hasMaterial
              ? '資料あり'
              : '資料なし'}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          {item.themeMode === 'generated' ? 'AI即興テーマ' : '自分で設定'}
        </span>
        {item.qaCount > 0 && (
          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
            Q&A {item.qaCount}件
          </span>
        )}
      </div>

      {isEvaluated && item.result && (
        <>
          <p className="text-sm text-slate-700">{categorySummary(item.result.categories)}</p>
          {item.result.overallComment && (
            <p className="text-sm leading-relaxed text-slate-700">
              {snippet(item.result.overallComment)}
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-3">
        {isEvaluated ? (
          <LinkButton
            href={`/presentation/result?attemptId=${encodeURIComponent(item.id)}`}
            variant="primary"
          >
            結果を見る
          </LinkButton>
        ) : item.sessionId ? (
          <LinkButton
            href={`/presentation/record?sessionId=${encodeURIComponent(item.sessionId)}`}
            variant="secondary"
          >
            録画に戻る
          </LinkButton>
        ) : (
          <Button variant="secondary" disabled>
            録画に戻る
          </Button>
        )}
      </div>
    </Card>
  );
}
