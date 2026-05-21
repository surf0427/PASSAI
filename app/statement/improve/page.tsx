'use client';

// ④「書き直す」機能（do）の入口。STEP4-1: 一覧 → 詳細 → ② edit へ遷移、までを実装。
//
// 役割:
//   - 過去に書いた志望理由書（statementReviewHistory）の一覧を表示
//   - クリックで詳細（本文 / スコア / 改善点 / 弱い点 / 改善アクション / 詳細分析）を表示
//   - 詳細画面の最下部に「この内容をもとに書き直す」ボタンを置き、
//     `/statement/edit?rewriteFrom=<historyId>` へ遷移する
//
// ③ /statement/score との違い:
//   - ③ は閲覧専用（書き直し導線なし）
//   - ④ は「書き直しへ進む」CTA がある（書き直しは ② edit が担う）
//
// 触らない:
//   - statementReviewHistory の保存・削除ロジック（read のみ）
//   - /api/statement-review / /api/statement-prepare
//   - AI prompt / PROMPT_VERSION
//   - ② edit 側の本文入力処理・添削フロー
//   - /statement/improve/[slug] サブルート（軸別 rewrite ガイドは現状そのまま温存）
//
// STEP4-1 では `?rewriteFrom=<historyId>` URL 形式を固定するだけ。② edit 側の
// パラメータ受け取り＋本文 prefill ＋左サイド改善点表示は別 STEP で実装する。

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { AlertBox } from '@/components/ui/AlertBox';
import { Accordion } from '@/components/ui/Accordion';
import { PageHeader } from '@/components/ui/PageHeader';
import { LinkButton } from '@/components/ui/LinkButton';
import { Button } from '@/components/ui/Button';
import { TotalScoreCard } from '@/components/ScoreDashboard/TotalScoreCard';
import { RankBadge } from '@/components/ScoreDashboard/RankBadge';
import { ScoreBarCard } from '@/components/ScoreDashboard/ScoreBarCard';
import { RadarSummary } from '@/components/ScoreDashboard/RadarSummary';
import { ImprovementPriority } from '@/components/ScoreDashboard/ImprovementPriority';
import { DashboardSummary } from '@/components/ScoreDashboard/DashboardSummary';
import { NgWordCheck } from '@/components/statement/NgWordCheck';
import { StructureCheck } from '@/components/statement/StructureCheck';
import { EvaluationAxisCheck } from '@/components/statement/EvaluationAxisCheck';
import { detectNgWords } from '@/lib/detectNgWords';
import { loadActivityData } from '@/lib/activityStorage';
import {
  loadReviewHistory,
  type ReviewHistoryItem,
} from '@/lib/statement/review/statementStorage';
import { statementResultToScore } from '@/lib/statement/score/statementScore';
import { breakdownToRankItems } from '@/lib/statement/score/statementScoreSource';
import { getImprovementPriority } from '@/lib/scoreRank';
import { PASS_LINE_TARGETS } from '@/lib/passLineComparison';
import type { ActivityData } from '@/types/activity';

// SSR-stable mount flag。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

const TARGET_BY_KEY: Record<string, number> = Object.fromEntries(
  PASS_LINE_TARGETS.map((t) => [t.id, t.targetScore]),
);

const AXIS_DESCRIPTIONS: Record<string, string> = {
  logic:         '主張と根拠のつながり',
  specificity:   '体験の描写・具体性',
  universityFit: '大学固有のカリキュラム・教員への言及度',
  futureGoal:    '将来像の踏み込み度',
  originality:   '自分らしさ・独自性',
};

const SUMMARY_MESSAGE =
  '改善点と詳細分析を確認したら、下の「この内容をもとに書き直す」から ② 書く画面へ進めます。';

export default function StatementImprovePage() {
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // 履歴は read only。saveReviewHistory / delete / clear は本ページから一切呼ばない。
  const history = useMemo<ReviewHistoryItem[]>(
    () => (isMounted ? loadReviewHistory() : []),
    [isMounted],
  );

  // 詳細分析の NgWordCheck が require する activity data（view 文脈なので入力としてだけ使う）。
  const activities = useMemo<ActivityData | null>(
    () => (isMounted ? loadActivityData() : null),
    [isMounted],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected =
    selectedId === null ? null : history.find((h) => h.id === selectedId) ?? null;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <PageHeader
        title="書き直す"
        description="過去に書いた志望理由書を選んで、改善点と詳細分析を見てから書き直しに進めます。"
      />

      <div className="mb-6">
        <Link
          href="/statement"
          className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2"
        >
          ← 志望理由書トップへ
        </Link>
      </div>

      {isMounted && history.length === 0 && <NoHistoryYet />}

      {isMounted && history.length > 0 && selected === null && (
        <HistoryListView
          history={history}
          onSelect={(id) => setSelectedId(id)}
        />
      )}

      {isMounted && selected !== null && (
        <HistoryDetailView
          entry={selected}
          activities={activities}
          onBack={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

// ── 履歴ゼロのとき ─────────────────────────────────────────────────
// 「書き直す対象が無い」状態。② に誘導して新規作成を促す。
function NoHistoryYet() {
  return (
    <Card variant="soft" padding="lg" className="text-center mt-2 sm:mt-4">
      <h2 className="text-lg sm:text-xl font-bold text-slate-900 mb-3">
        まだ書き直す対象がありません
      </h2>
      <p className="text-sm text-slate-600 leading-relaxed mb-6 max-w-md mx-auto">
        志望理由書を書いて添削を受けると、ここから過去の結果を選んで書き直せます。
      </p>
      <LinkButton
        href="/statement/edit"
        variant="primary"
        size="md"
        className="w-full sm:w-auto"
      >
        志望理由書を書く
      </LinkButton>
    </Card>
  );
}

// ── 一覧表示 ─────────────────────────────────────────────────────
// 大学名 / 学部 / 学科 / 作成日時 / 総合スコア / 本文プレビュー。
// 構造は ③ score の HistoryListView と寄せている（review 容易性のため）。
function HistoryListView({
  history,
  onSelect,
}: {
  history: ReviewHistoryItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <p className="text-sm text-slate-600 mb-4 leading-relaxed">
        書き直したい志望理由書を選んでください。
      </p>
      <ul className="space-y-3">
        {history.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              className="block w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {item.university || '（大学未入力）'}
                  {item.faculty ? `　${item.faculty}` : ''}
                  {item.department ? `　${item.department}` : ''}
                </p>
                <div className="shrink-0 flex items-center gap-3">
                  <span className="text-base font-bold text-blue-700 tabular-nums">
                    {item.result.overallScore}
                    <span className="text-[11px] text-blue-500 font-normal ml-0.5">/100</span>
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 tabular-nums mb-1.5">
                {formatDateTime(item.createdAt)}
              </p>
              <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                {previewEssay(item.essay)}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── 詳細表示 ─────────────────────────────────────────────────────
// 本文 / 総合スコア / 改善点 / 弱い点 / 改善アクション / 詳細分析 +
// 「この内容をもとに書き直す」CTA。
function HistoryDetailView({
  entry,
  activities,
  onBack,
}: {
  entry: ReviewHistoryItem;
  activities: ActivityData | null;
  onBack: () => void;
}) {
  const score = statementResultToScore(entry.result);
  const items = breakdownToRankItems(score.breakdown);
  const radarItems = items.map(({ label, score: s }) => ({ label, score: s }));
  const priority = getImprovementPriority(items);

  // ② edit へ「書き直し対象」コンテキストを渡す URL。
  // STEP4-1: ここで URL 形式を固定する。② 側の受け取り実装は次 STEP。
  const rewriteHref = `/statement/edit?rewriteFrom=${encodeURIComponent(entry.id)}`;

  return (
    <>
      <div className="mb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2"
        >
          ← 一覧に戻る
        </button>
      </div>

      <Card variant="soft" padding="md" className="mb-5">
        <p className="text-[11px] font-bold text-blue-700 tracking-widest mb-2">
          書き直し対象
        </p>
        <p className="text-sm font-semibold text-slate-900">
          {entry.university || '（大学未入力）'}
          {entry.faculty ? `　${entry.faculty}` : ''}
          {entry.department ? `　${entry.department}` : ''}
        </p>
        <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
          {formatDateTime(entry.createdAt)}
        </p>
      </Card>

      <section className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 sm:gap-4 mb-4">
        <TotalScoreCard score={score.total} />
        <div className="bg-white border border-gray-200 rounded-2xl px-6 py-5 sm:px-8 flex items-center justify-center">
          <RankBadge score={score.total} size="lg" />
        </div>
      </section>

      <section className="mb-6">
        <DashboardSummary message={SUMMARY_MESSAGE} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 sm:gap-4 mb-6">
        <RadarSummary items={radarItems} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
          {items.map(({ key, label, score: itemScore }) => (
            <ScoreBarCard
              key={key}
              label={label}
              score={itemScore}
              description={AXIS_DESCRIPTIONS[key] ?? ''}
              targetScore={TARGET_BY_KEY[key]}
            />
          ))}
        </div>
      </section>

      <section className="mb-6">
        <ImprovementPriority items={priority} />
      </section>

      {/* 結果 text セクション（改善点 / 弱い点 / 改善アクション） */}
      <AlertBox variant="warning" className="mb-4">
        <h3 className="text-sm font-semibold text-yellow-800 mb-3">優先度順の改善アクション</h3>
        <ol className="space-y-2">
          {entry.result.actions.map((a, i) => (
            <li key={i} className="text-sm text-yellow-900 flex gap-2">
              <span className="font-bold shrink-0">{i + 1}.</span>
              <span>{a}</span>
            </li>
          ))}
        </ol>
      </AlertBox>

      <AlertBox variant="error" className="mb-4">
        <h3 className="text-sm font-semibold text-red-800 mb-3">弱い点</h3>
        <ul className="space-y-1">
          {entry.result.weaknesses.map((w, i) => (
            <li key={i} className="text-sm text-red-700 flex gap-2">
              <span>△</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      </AlertBox>

      <AlertBox variant="success" className="mb-6">
        <h3 className="text-sm font-semibold text-green-800 mb-3">良い点</h3>
        <ul className="space-y-1">
          {entry.result.strengths.map((s, i) => (
            <li key={i} className="text-sm text-green-700 flex gap-2">
              <span>✓</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </AlertBox>

      <Accordion title="この志望理由書の本文を見る">
        <Card>
          <pre className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed font-sans">
            {entry.essay}
          </pre>
        </Card>
      </Accordion>

      <div className="mt-4">
        <Accordion title="詳細分析を見る">
          <div className="space-y-4">
            <NgWordCheck
              issues={detectNgWords(entry.essay, activities, entry.university, entry.faculty)}
              // ④ 入口 view でも内部 rewrite/insert CTA は no-op。本格的な書き直しは
              // ② edit に遷移してから行う設計（書き直し先を 1 つに集約するため）。
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
        </Accordion>
      </div>

      {/* STEP-NAV-3: 詳細を最後まで読んだ後、上端の小型 underline link まで戻らずに
          一覧へ戻れるよう、最後の Accordion 直後にも副ボタンを置く。下の primary CTA
          （書き直し）と並べて、戻る = secondary / 進む = primary の役割を視覚的に分ける。 */}
      <div className="mt-6">
        <Button variant="secondary" onClick={onBack}>
          ← 一覧に戻る
        </Button>
      </div>

      {/* ── ④ → ② へ遷移する CTA ────────────────────────────────
          rewriteFrom URL パラメータ形式は本 STEP で固定。② 側の受け取りは次 STEP で実装。 */}
      <section className="mt-8 mb-6 bg-blue-50 border border-blue-100 rounded-2xl p-5 sm:p-6">
        <p className="text-[11px] font-bold text-blue-700 mb-1 tracking-widest">
          次のステップ
        </p>
        <p className="text-sm text-slate-700 leading-relaxed mb-4">
          選んだ志望理由書をもとに、② 書く画面で改善ポイントを参考にしながら書き直せます。
        </p>
        <LinkButton
          href={rewriteHref}
          variant="primary"
          size="md"
          className="w-full sm:w-auto"
        >
          この内容をもとに書き直す →
        </LinkButton>
      </section>
    </>
  );
}

// ── helpers ──────────────────────────────────────────────────────

function noopRewrite(_phrase: string, _answers: string[]): void {
  // ④ 入口 view では内部 rewrite CTA は無効化（書き直しは ② edit に集約）。
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

function previewEssay(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  const limit = 90;
  if (trimmed.length <= limit) return trimmed;
  return trimmed.slice(0, limit) + '…';
}
