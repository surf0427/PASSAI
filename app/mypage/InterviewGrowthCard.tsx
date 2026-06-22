'use client';

/**
 * マイページ「📈 AI面接 成長記録」カード。
 *
 * 役割分担:
 *   - 「受ける → 結果を見る → 終了」を「受ける → 成長が可視化される → 次の課題が見える」へ。
 *   - DB 変更・API 追加・新規 AI 評価・課金/usage 消費なし。
 *     本人の completed AI 面接（interview_ai_sessions + interview_ai_results.feedback）を
 *     client が RLS owner SELECT で直読みし（listCompletedAiInterviews）、
 *     lib/interviewAi/growthRecord.ts で「集計のみ」して表示する。
 *     PresentationGrowthCard と同パターン。
 *
 * 表示条件:
 *   - 未ログイン（userId なし）→ 何も描画しない。
 *   - completed AI 面接が 1 件以上 → 成長記録。0 件 → 空状態（練習導線）。
 *   - 取得失敗 → カード内にエラー文言（マイページ全体は壊さない）。
 */

import { useEffect, useRef, useState } from 'react';

import { useCurrentUserId } from '@/app/components/AuthProvider';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';
import { listCompletedAiInterviews } from '@/lib/supabase/interviewAiResults';
import {
  buildInterviewGrowthRecord,
  type AxisTrend,
  type GrowthCategory,
  type InterviewGrowthRecord,
  type TypeBreakdownItem,
} from '@/lib/interviewAi/growthRecord';
import type { InterviewType } from '@/lib/interviewAi/interviewTypes';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'ready'; record: InterviewGrowthRecord };

// タイプ別表示（emoji + 短縮ラベル）。emoji はカード UI 側で付与する方針。
const TYPE_DISPLAY: Record<InterviewType, { emoji: string; label: string }> = {
  self_analysis: { emoji: '👤', label: '自己分析' },
  statement: { emoji: '📝', label: '志望理由書' },
  essay: { emoji: '📚', label: '小論文' },
  free: { emoji: '🎯', label: '本番' },
  pressure: { emoji: '😈', label: '圧迫' },
};

// 成長カテゴリ → 表示（絵文字 + ラベル + 色）。
const CATEGORY_DISPLAY: Record<
  GrowthCategory,
  { icon: string; label: string; className: string }
> = {
  improving: { icon: '⬆️', label: '成長中', className: 'text-emerald-600' },
  stable: { icon: '➡️', label: '安定', className: 'text-slate-500' },
  needsWork: { icon: '⬇️', label: '要改善', className: 'text-amber-600' },
};

export function InterviewGrowthCard() {
  const userId = useCurrentUserId();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    cancelledRef.current = false;

    async function load() {
      try {
        const rows = await listCompletedAiInterviews(userId as string);
        if (cancelledRef.current) return;
        const record = buildInterviewGrowthRecord(
          rows.map((r) => ({
            createdAt: r.createdAt,
            interviewType: r.interviewType,
            feedback: r.feedback,
          })),
        );
        setState(record ? { kind: 'ready', record } : { kind: 'empty' });
      } catch {
        if (!cancelledRef.current) setState({ kind: 'error' });
      }
    }

    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [userId]);

  // 未ログインは描画しない（PresentationGrowthCard と同様、活動有無に依らず非表示）。
  if (!userId) return null;

  return (
    <Card padding="md" className="mt-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-bold text-slate-800">📈 AI面接 成長記録</h2>
        {state.kind === 'ready' && (
          <span className="text-xs text-slate-500">練習の積み重ね</span>
        )}
      </div>
      <CardBody state={state} />
    </Card>
  );
}

function CardBody({ state }: { state: LoadState }) {
  if (state.kind === 'loading') {
    return <p className="text-sm text-slate-500">読み込み中…</p>;
  }
  if (state.kind === 'error') {
    return (
      <p className="text-sm text-slate-500">
        AI面接の成長記録を読み込めませんでした
      </p>
    );
  }
  if (state.kind === 'empty') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600 leading-relaxed">
          まだAI面接の記録がありません。面接を受けると、ここに成長記録が表示されます。
        </p>
        <LinkButton href="/interview/ai" variant="primary" size="sm">
          AI面接を始める
        </LinkButton>
      </div>
    );
  }
  return <RecordBody record={state.record} />;
}

function RecordBody({ record }: { record: InterviewGrowthRecord }) {
  return (
    <div className="space-y-6">
      {/* ①② 総練習回数 / 連続練習 ─────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <Metric icon="🎤" label="総練習回数" value={`${record.totalCount} 回`} />
        <Metric icon="🔥" label="連続練習" value={`${record.streakDays} 日`} />
      </div>

      {/* ③ タイプ別練習回数 ─────────────────────────────── */}
      <TypeBreakdown items={record.typeBreakdown} />

      {/* ④ 成長推移 ────────────────────────────────────── */}
      <GrowthTrend trend={record.growthTrend} />

      {/* ⑤ 最近の課題 ───────────────────────────────────── */}
      {record.topIssues.length > 0 && (
        <ListSection
          title="📌 最近の課題"
          items={record.topIssues}
          marker="・"
        />
      )}

      {/* ⑥ 最近の強み ───────────────────────────────────── */}
      {record.topStrengths.length > 0 && (
        <ListSection
          title="✨ 最近の強み"
          items={record.topStrengths}
          marker="・"
        />
      )}

      {/* ⑦ 次にやるべき練習 ─────────────────────────────── */}
      {record.recommendation && (
        <div className="rounded-xl bg-brand-50 ring-1 ring-brand-100 px-4 py-3">
          <p className="text-xs font-semibold text-brand-700 mb-1">
            🎯 次にやるべき練習
          </p>
          <p className="text-sm font-bold text-slate-900">
            {TYPE_DISPLAY[record.recommendation.type].emoji}{' '}
            {TYPE_DISPLAY[record.recommendation.type].label}面接
          </p>
          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            {record.recommendation.reason}
          </p>
        </div>
      )}

      <div className="pt-1">
        <LinkButton href="/interview/history" variant="secondary" size="sm">
          詳しい履歴を見る
        </LinkButton>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">
        成長推移は過去のフィードバックから推定した練習の目安です（厳密な成績ではありません）。
      </p>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-xs text-slate-500">
        <span aria-hidden className="mr-1">
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-0.5 text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}

function TypeBreakdown({ items }: { items: TypeBreakdownItem[] }) {
  // 練習実績のあるタイプのみ表示（0 回のタイプは並べない）。
  const practiced = items.filter((i) => i.count > 0);
  if (practiced.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-slate-600 mb-2">📊 タイプ別</p>
      <ul className="flex flex-wrap gap-2">
        {practiced.map((item) => {
          const d = TYPE_DISPLAY[item.type];
          return (
            <li
              key={item.type}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
            >
              <span aria-hidden>{d.emoji}</span>
              <span>{d.label}</span>
              <span className="font-semibold text-slate-900">{item.count}回</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GrowthTrend({ trend }: { trend: AxisTrend[] }) {
  if (trend.length === 0) {
    return (
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-2">📈 成長推移</p>
        <p className="text-xs text-slate-500 leading-relaxed">
          もう一度練習すると、初回からの成長推移が表示されます。
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs font-semibold text-slate-600 mb-2">
        📈 成長推移 <span className="text-slate-400">（🌱 初期 → 現在）</span>
      </p>
      <ul className="space-y-1.5">
        {trend.map((t) => {
          const c = CATEGORY_DISPLAY[t.category];
          return (
            <li
              key={t.axis}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-slate-700">{t.label}</span>
              <span className={`inline-flex items-center gap-1 font-semibold ${c.className}`}>
                <span aria-hidden>{c.icon}</span>
                {c.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ListSection({
  title,
  items,
  marker,
}: {
  title: string;
  items: string[];
  marker: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-600 mb-2">{title}</p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-1.5 text-sm text-slate-700 leading-relaxed">
            <span aria-hidden className="text-slate-400 shrink-0">
              {marker}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
