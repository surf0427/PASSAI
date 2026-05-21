'use client';

// STEP-DA-1: 詳細分析専用ページ（view-only）。並走追加のみ。
//
// 役割:
//   - URL `/statement/analysis/[id]` を直接開き、ReviewHistoryItem を read-only で表示
//   - 1 ページ 1 レポート構造（本文 → 総合分析 → 詳細分析）
//   - 既存 ② edit / ③ score / ④ improve の UI は触らない（このページからリンクも張らない）
//
// データ:
//   - useParams<{ id: string }>() で id 取得
//   - loadReviewHistory() の find で entry 復元（既存 storage 流用、書き込み一切なし）
//   - loadActivityData() を NgWordCheck の detectNgWords 入力として読む（既存 ②③④ と同形）
//   - 新 storage / 新 state machine / 新 API なし
//
// 触らない:
//   - statementReviewHistory の保存・削除ロジック
//   - /api/statement-review / /api/statement-prepare
//   - AI prompt / PROMPT_VERSION / 添削フロー
//   - ② edit / ③ score / ④ improve / DetailAnalysisAccordionView
//   - NgWordCheck の signature（readOnly prop 追加もしない。no-op handler 戦略で view 化）
//
// 設計方針:
//   - 白背景・section 区切り・余白主体・Card 最小限
//   - AlertBox 多用や dashboard 風レイアウトは避ける
//   - 既存 detail-analysis component（NgWordCheck/StructureCheck/EvaluationAxisCheck）は
//     ロジック流用優先で UI 完全刷新はしない（次 STEP 以降）

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LinkButton } from '@/components/ui/LinkButton';
import { NgWordCheck } from '@/components/statement/NgWordCheck';
import { StructureCheck } from '@/components/statement/StructureCheck';
import { EvaluationAxisCheck } from '@/components/statement/EvaluationAxisCheck';
import { detectNgWords } from '@/lib/detectNgWords';
import { loadActivityData } from '@/lib/activityStorage';
import {
  loadReviewHistory,
  type ReviewHistoryItem,
} from '@/lib/statement/review/statementStorage';
import type { ActivityData } from '@/types/activity';

// SSR-stable mount flag。既存 ③④ と同形パターン。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function StatementAnalysisPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // 履歴 read only。save / delete / clear は呼ばない（loadReviewHistory のみ）。
  const entry = useMemo<ReviewHistoryItem | null>(
    () => {
      if (!isMounted) return null;
      return loadReviewHistory().find((h) => h.id === id) ?? null;
    },
    [isMounted, id],
  );

  // NgWordCheck の detectNgWords が require する活動データ。view 文脈なので入力としてだけ使う。
  const activities = useMemo<ActivityData | null>(
    () => (isMounted ? loadActivityData() : null),
    [isMounted],
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="mb-6">
        <Link
          href="/statement/score"
          className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2"
        >
          ← 今のスコアに戻る
        </Link>
      </div>

      {/* SSR では何も描画しない（hydration セーフ）。mount 後に entry 有無で分岐。 */}
      {isMounted && entry === null && <NotFound />}

      {isMounted && entry !== null && (
        <AnalysisReport entry={entry} activities={activities} />
      )}
    </div>
  );
}

// ── レポート本体 ──────────────────────────────────────────────────

function AnalysisReport({
  entry,
  activities,
}: {
  entry: ReviewHistoryItem;
  activities: ActivityData | null;
}) {
  return (
    <>
      {/* ── ヘッダー（白背景・タイポグラフィのみ。色付きカードは使わない） ── */}
      <header className="mb-10 border-b border-slate-200 pb-6">
        <p className="text-xs text-slate-500 tabular-nums mb-2">
          {formatDateTime(entry.createdAt)}
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
          {entry.university || '（大学未入力）'}　分析レポート
        </h1>
        <p className="text-sm text-slate-600 mb-3">
          {entry.faculty || '（学部未入力）'}
          {entry.department ? `　${entry.department}` : ''}
        </p>
        <p className="text-sm text-slate-700">
          総合スコア
          <span className="text-xl font-bold text-slate-900 tabular-nums ml-2">
            {entry.result.overallScore}
          </span>
          <span className="text-xs text-slate-500"> / 100</span>
        </p>
      </header>

      {/* ── 本文 ─────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="text-lg font-bold text-slate-900 mb-4 border-b border-slate-200 pb-2">
          本文
        </h2>
        <pre className="whitespace-pre-wrap leading-relaxed text-slate-800 font-sans text-sm sm:text-base">
          {entry.essay}
        </pre>
      </section>

      {/* ── 総合分析（actions / weaknesses / strengths をシンプル section に） ──
          現状の AlertBox / Card 乱立 UI を持ち込まず、見出し + リストだけのレポート風に統一する。 */}
      <section className="mb-12">
        <h2 className="text-lg font-bold text-slate-900 mb-6 border-b border-slate-200 pb-2">
          総合分析
        </h2>

        {entry.result.actions.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              改善のアクション
            </h3>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm text-slate-700 leading-relaxed">
              {entry.result.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          </div>
        )}

        {entry.result.weaknesses.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              弱い点
            </h3>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700 leading-relaxed">
              {entry.result.weaknesses.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {entry.result.strengths.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              良い点
            </h3>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700 leading-relaxed">
              {entry.result.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── 詳細分析（既存 component をそのまま流用） ───────────────
          UI 完全刷新は次 STEP 以降。今回は「ここに置ける」状態を作ることが目的。
          各 component が内部で Card を持つため、本 page で外側 Card は被せない（二重カード回避）。 */}
      <section className="mb-12">
        <h2 className="text-lg font-bold text-slate-900 mb-6 border-b border-slate-200 pb-2">
          詳細分析
        </h2>
        <div className="space-y-6">
          <NgWordCheck
            issues={detectNgWords(
              entry.essay,
              activities,
              entry.university,
              entry.faculty,
            )}
            // 分析ページは閲覧専用。書き直し導線は ② edit / ④ improve に集約。
            // NgWordCheck の signature は変えず、no-op handler を渡す既存パターン（③④ と同じ）。
            onStartRewrite={noopRewrite}
            onInsertStarterHint={noopInsert}
          />
          <StructureCheck text={entry.essay} />
          <EvaluationAxisCheck
            university={entry.university}
            faculty={entry.faculty}
            text={entry.essay}
          />
        </div>
      </section>
    </>
  );
}

// ── entry が見つからない時 ────────────────────────────────────────
// URL の id が不正・履歴が削除済み・別端末で参照、などのケース。
// Card / AlertBox を使わない最小 empty state。
function NotFound() {
  return (
    <div className="text-center py-12">
      <h2 className="text-lg sm:text-xl font-bold text-slate-900 mb-3">
        分析データが見つかりません
      </h2>
      <p className="text-sm text-slate-600 leading-relaxed mb-6 max-w-md mx-auto">
        指定された志望理由書の記録が見つかりませんでした。
      </p>
      <LinkButton href="/statement/score" variant="primary" size="md">
        今のスコアへ戻る
      </LinkButton>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────

function noopRewrite(_phrase: string, _answers: string[]): void {
  // 分析ページは view-only。書き直し導線は ② edit / ④ improve に集約。
}

function noopInsert(_hint: string): void {
  // 同上。
}

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${h}:${min}`;
}
