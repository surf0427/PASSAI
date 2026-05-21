'use client';

// ③「今のスコアを見る」機能（view）。
//
// 役割:
//   - 過去に書いた志望理由書（statementReviewHistory）の一覧を表示
//   - クリックで詳細（本文 / スコア / 良い点 / 弱い点 / 改善アクション / 詳細分析）を表示
//   - 閲覧専用。書き直し / 再添削 / 削除はここでは扱わない
//
// 触らない:
//   - statementReviewHistory の保存・削除ロジック（read のみ）
//   - /api/statement-review / /api/statement-prepare
//   - AI prompt / PROMPT_VERSION
//   - ② edit の添削フロー、④ rewrite 機能
//
// 履歴データは [lib/statement/review/statementStorage.ts](../../../lib/statement/review/statementStorage.ts) の
// loadReviewHistory() で取得。スコア breakdown は statementResultToScore() で再計算。

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

// SSR-stable mount flag（他ページと同形パターン）。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// axis id → 合格ライン目安スコア（ScoreBarCard の目安マーカー描画用）。
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
  '過去の添削結果を確認できます。書き直しはトップから ④「書き直す」を選んでください。';

export default function StatementScorePage() {
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // 履歴は read のみ（保存は ② edit から、削除はここでは扱わない）。
  const history = useMemo<ReviewHistoryItem[]>(
    () => (isMounted ? loadReviewHistory() : []),
    [isMounted],
  );

  // 詳細分析の NgWordCheck が require する activity data。view-only でも入力としては必要。
  const activities = useMemo<ActivityData | null>(
    () => (isMounted ? loadActivityData() : null),
    [isMounted],
  );

  // 詳細表示中の履歴 id。null なら一覧表示。
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected =
    selectedId === null ? null : history.find((h) => h.id === selectedId) ?? null;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <PageHeader
        title="今のスコアを見る"
        description="過去に作成した志望理由書の完成度と詳細分析を確認できます（閲覧専用）。"
      />

      <div className="mb-6">
        <Link
          href="/statement"
          className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2"
        >
          ← 志望理由書トップへ
        </Link>
      </div>

      {/* SSR 時は何も描画しない（hydration セーフ）。mount 後に判定して描画。 */}
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
// 「ここはまだ使えない」より「まず書けばここで見られる」と読ませる soft トーン。
function NoHistoryYet() {
  return (
    <Card variant="soft" padding="lg" className="text-center mt-2 sm:mt-4">
      <h2 className="text-lg sm:text-xl font-bold text-slate-900 mb-3">
        まだ過去に書いた志望理由書はありません
      </h2>
      <p className="text-sm text-slate-600 leading-relaxed mb-6 max-w-md mx-auto">
        志望理由書を書いて添削を受けると、ここで過去の結果を一覧で確認できます。
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
// 大学名 / 学部 / 学科 / 作成日時 / 総合スコア / 本文プレビューを 1 件ずつカード表示。
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
        過去に書いた志望理由書が {history.length} 件あります。クリックで詳細を表示します。
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
// 本文 / 総合スコア / 各評価軸 / 良い点 / 弱い点 / 改善アクション / 詳細分析。
// 閲覧専用なので「書き直す」「再添削」「削除」ボタンは出さない。
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
          表示中の志望理由書
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

      {/* 結果 text セクション（良い点 / 弱い点 / 改善アクション） */}
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

      {/* 本文（折りたたみで邪魔にならない位置）*/}
      <Accordion title="この志望理由書の本文を見る">
        <Card>
          <pre className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed font-sans">
            {entry.essay}
          </pre>
        </Card>
      </Accordion>

      {/* 詳細分析（折りたたみ）*/}
      <div className="mt-4">
        <Accordion title="詳細分析を見る">
          <div className="space-y-4">
            <NgWordCheck
              issues={detectNgWords(entry.essay, activities, entry.university, entry.faculty)}
              // ③ は閲覧専用。NgWordCheck 内の rewrite / insert CTA は no-op に縛る
              // （edit feature の書き直し導線は ② / ④ に分離済み。ここから直接書き換えない）。
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
          一覧へ戻れるよう、最下部にも副ボタンを置く。onBack は既存 prop を流用。 */}
      <div className="mt-6">
        <Button variant="secondary" onClick={onBack}>
          ← 一覧に戻る
        </Button>
      </div>
    </>
  );
}

// ── helpers ──────────────────────────────────────────────────────

function noopRewrite(_phrase: string, _answers: string[]): void {
  // ③ view-only: rewrite CTA は機能させない（② edit / ④ rewrite に分離済み）。
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
