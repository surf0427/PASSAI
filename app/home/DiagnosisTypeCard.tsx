'use client';

import { useEffect, useState } from 'react';
import { LinkButton } from '@/components/ui/LinkButton';
import {
  loadDiagnosisResult,
  type DiagnosisResult,
} from '@/lib/diagnosisStorage';
import type { DiagnosisType } from '@/types/diagnosis';

// ── /home 上部に表示する「あなたの診断タイプ」カード ──────────────
// /diagnosis で localStorage に保存した結果を読み取り、タイプ別の
// 「次にやるべきこと」を提示する。診断結果が無い／壊れている場合は
// 受験タイプ診断への誘導カード（PromoCard）にフォールバックする。
//
// 既存 /home の UI は触らず、このカードを 1 行差し込むだけで動く設計。

type ActionInfo = {
  recommend: string;
  reason: string;
  ctaLabel: string;
  ctaHref: string;
};

// タイプ別の次アクション。リンク先は実在する既存ルートに合わせる。
//   1: 活動整理 → /input/activity
//   2: 自己分析 → /self-analysis
//   3: 志望理由書 → /statement
//   4: 一般受験並行 → 短時間ルートとしてまず /input/activity から
const NEXT_ACTIONS: Record<DiagnosisType, ActionInfo> = {
  1: {
    recommend: 'まずは活動整理から始めましょう。',
    reason:
      '今は「実績がない」のではなく、経験をどう整理するかが見えていない状態です。活動整理で、過去の経験を一つずつ言葉にしていきましょう。',
    ctaLabel: '活動整理を始める',
    ctaHref: '/input/activity',
  },
  2: {
    recommend: '自己分析で強みを言葉にしましょう。',
    reason:
      '活動や経験はあるので、それを志望理由書や面接で使える言葉に変えることが大事です。自己分析から進めましょう。',
    ctaLabel: '自己分析を始める',
    ctaHref: '/self-analysis',
  },
  3: {
    recommend: '志望理由書の完成度を上げましょう。',
    reason:
      'すでに書き始めている場合は、具体性・大学との一致・面接で話せる深さを高めることが重要です。',
    ctaLabel: '志望理由書を見直す',
    ctaHref: '/statement',
  },
  4: {
    recommend: '短時間で進める優先ルートから始めましょう。',
    reason:
      '一般受験と並行する場合は、まず活動整理・自己分析・志望理由書の順に、短時間でつながる部分から進めるのがおすすめです。',
    ctaLabel: '最短ルートで始める',
    ctaHref: '/input/activity',
  },
};

// 保存データが壊れていてもクラッシュしないよう、必要 field を最低限ガード
function isResultUsable(r: DiagnosisResult): boolean {
  const t = r.resultType;
  if (t !== 1 && t !== 2 && t !== 3 && t !== 4) return false;
  if (typeof r.resultTitle !== 'string' || !r.resultTitle.trim()) return false;
  if (typeof r.resultDescription !== 'string') return false;
  return true;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function DiagnosisTypeCard() {
  // hydration mismatch 回避：マウント前は何も描画しない
  const [loaded, setLoaded] = useState(false);
  const [result, setResult] = useState<DiagnosisResult | null>(null);

  useEffect(() => {
    setResult(loadDiagnosisResult());
    setLoaded(true);
  }, []);

  if (!loaded) return null;

  if (!result || !isResultUsable(result)) {
    return <PromoCard />;
  }

  const action = NEXT_ACTIONS[result.resultType];
  const dateStr = formatDate(result.createdAt);

  return (
    <div className="mb-8 bg-white rounded-2xl border border-accent-200 shadow-sm overflow-hidden">
      {/* ヘッダ：診断タイプ + 説明 + 診断日 */}
      <div className="bg-accent-50/70 px-5 py-5 sm:px-6 border-b border-accent-100">
        <p className="text-xs font-semibold text-accent-600 mb-2">
          あなたの診断タイプ
        </p>
        <div className="flex items-center gap-3 mb-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-accent-100 text-accent-700 text-base font-extrabold shrink-0">
            {result.resultType}
          </span>
          <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 leading-tight">
            {result.resultTitle}
          </h2>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
          {result.resultDescription}
        </p>
        {dateStr && (
          <p className="mt-3 text-xs text-slate-400">診断日：{dateStr}</p>
        )}
      </div>

      {/* おすすめの次アクション */}
      <div className="px-5 py-5 sm:px-6">
        <p className="text-xs font-semibold text-brand-600 mb-2">
          おすすめの次アクション
        </p>
        <p className="text-base font-bold text-slate-900 mb-2 leading-relaxed">
          {action.recommend}
        </p>
        <p className="text-sm text-slate-600 leading-relaxed mb-4">
          {action.reason}
        </p>
        {/* font-bold は BASE の font-medium を上書きするため className で指定。
            shadow-sm は Button BASE には無いので追加で乗せる。
            text-sm sm:text-base → text-base に揃う点は許容（モバイルで微増）。 */}
        <LinkButton
          href={action.ctaHref}
          variant="accent"
          size="lg"
          className="font-bold shadow-sm"
        >
          {action.ctaLabel}
          <span aria-hidden="true" className="ml-2">→</span>
        </LinkButton>
      </div>
    </div>
  );
}

// 診断未実施 or 結果が壊れている場合のフォールバック
function PromoCard() {
  return (
    <div className="mb-8 bg-white rounded-2xl border border-brand-200 shadow-sm p-5 sm:p-6">
      <p className="text-xs font-semibold text-accent-600 mb-2">
        受験タイプ診断
      </p>
      <p className="text-base font-bold text-slate-900 mb-2 leading-relaxed">
        まずは無料診断から始めてみませんか？
      </p>
      <p className="text-sm text-slate-600 leading-relaxed mb-4">
        30秒の診断で、あなたに合った総合型・学校推薦型選抜の始め方が分かります。
      </p>
      <LinkButton
        href="/diagnosis"
        variant="accent"
        size="lg"
        className="font-bold shadow-sm"
      >
        受験タイプ診断をする
        <span aria-hidden="true" className="ml-2">→</span>
      </LinkButton>
    </div>
  );
}
