'use client';

// STEP-DA-1: 詳細分析専用ページ（view-only）。
// STEP-UI-CLEANUP-2: 「カードを並べる管理画面UI」から「1 枚の分析レポートを読むUI」へ寄せる。
//
// 設計方針:
//   - white 主体、border 最小、Card / AlertBox を使わない
//   - 使用色は slate / blue / red のみ。緑・黄 ベースの「状態色」を全廃
//   - section は box ではなく余白主体のレポートブロック
//   - status は WarningBadge / MutedBadge の 2 種だけ。色の意味論を単純化
//   - 詳細分析 3 種（NgWord / Structure / EvaluationAxis）は lib を直呼び出しして inline render。
//     既存 component（NgWordCheck / StructureCheck / EvaluationAxisCheck）は他箇所（InputFormView の
//     RewriteContextCard）で使用されているため touch せず、データ shape のみ共有する。
//
// 触らない（ロジック・契約完全保持）:
//   - statementReviewHistory の保存・削除ロジック
//   - /api/statement-review / /api/statement-prepare
//   - AI prompt / PROMPT_VERSION
//   - detectNgWords / analyzeStructure / getEvaluationAxes / checkAxis の判定ロジック
//   - status 条件（'maybe' / 'missing' / 'high' / 'medium' / score 0/1/2）

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LinkButton } from '@/components/ui/LinkButton';
import { detectNgWords, type NgWordIssue } from '@/lib/detectNgWords';
import {
  analyzeStructure,
  type StructureAnalysis,
  type StructureElement,
} from '@/lib/structureAnalysis';
import {
  getEvaluationAxes,
  checkAxis,
  type EvaluationAxisPreset,
  type AxisCheckResult,
} from '@/lib/admissionEvaluationAxes';
import { loadActivityData } from '@/lib/activityStorage';
import {
  loadReviewHistory,
  type ReviewHistoryItem,
} from '@/lib/statement/review/statementStorage';
import type { ActivityData } from '@/types/activity';

// SSR-stable mount flag。既存ページと同形パターン。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// ── 構造分析の表示順 / ラベル（StructureCheck と同一の固定 mapping） ──
const STRUCTURE_LABELS: Record<StructureElement, string> = {
  trigger: 'きっかけ',
  problem: '課題・問題意識',
  action: '行動',
  learning: '学び',
  future: '将来目標',
  universityConnection: '大学との接続',
};

const STRUCTURE_DISPLAY_ORDER: StructureElement[] = [
  'universityConnection',
  'action',
  'learning',
  'problem',
  'trigger',
  'future',
];

export default function StatementAnalysisPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  const entry = useMemo<ReviewHistoryItem | null>(
    () => {
      if (!isMounted) return null;
      return loadReviewHistory().find((h) => h.id === id) ?? null;
    },
    [isMounted, id],
  );

  const activities = useMemo<ActivityData | null>(
    () => (isMounted ? loadActivityData() : null),
    [isMounted],
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="mb-8">
        <Link
          href="/statement/score"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← 今のスコアに戻る
        </Link>
      </div>

      {isMounted && entry === null && <NotFound />}
      {isMounted && entry !== null && (
        <AnalysisReport entry={entry} activities={activities} />
      )}
    </div>
  );
}

// ── レポート本体 ──────────────────────────────────────────────────
// <article> 単位で見せる。section は枠ではなく余白で区切る。

function AnalysisReport({
  entry,
  activities,
}: {
  entry: ReviewHistoryItem;
  activities: ActivityData | null;
}) {
  return (
    <article>
      {/* Header: 枠なし、タイポグラフィのみ */}
      <header className="mb-14">
        <p className="text-xs text-slate-400 tabular-nums mb-3">
          {formatDateTime(entry.createdAt)}
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight mb-2">
          分析レポート
        </h1>
        <p className="text-sm text-slate-500 mb-5">
          {[entry.university || '大学未入力', entry.faculty, entry.department]
            .filter((v) => v && v.length > 0)
            .join(' / ')}
        </p>
        <p className="text-sm text-slate-600">
          総合スコア
          <span className="ml-2 text-2xl font-semibold text-slate-900 tabular-nums">
            {entry.result.overallScore}
          </span>
          <span className="text-xs text-slate-400 ml-1">/ 100</span>
        </p>
      </header>

      <Section title="本文">
        <pre className="whitespace-pre-wrap leading-relaxed text-slate-700 font-sans text-[15px]">
          {entry.essay}
        </pre>
      </Section>

      <Section title="総合分析">
        {entry.result.actions.length > 0 && (
          <Subsection title="改善のアクション">
            <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700 leading-relaxed marker:text-slate-400">
              {entry.result.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          </Subsection>
        )}
        {entry.result.weaknesses.length > 0 && (
          <Subsection title="弱い点">
            <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700 leading-relaxed marker:text-slate-400">
              {entry.result.weaknesses.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Subsection>
        )}
        {entry.result.strengths.length > 0 && (
          <Subsection title="良い点">
            <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700 leading-relaxed marker:text-slate-400">
              {entry.result.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </Subsection>
        )}
      </Section>

      <Section title="詳細分析">
        <EvaluationAxisReport
          text={entry.essay}
          university={entry.university}
          faculty={entry.faculty}
        />
        <StructureReport text={entry.essay} />
        <NgWordReport
          text={entry.essay}
          activities={activities}
          university={entry.university}
          faculty={entry.faculty}
        />
      </Section>
    </article>
  );
}

// ── レイアウト primitives ─────────────────────────────────────────
// section / subsection を「枠 + 背景」ではなく「余白 + 見出し」で区切る。

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-16">
      <h2 className="text-xl font-semibold text-slate-900 tracking-tight mb-6">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Subsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-10 last:mb-0">
      <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-4">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── Badge primitives ──────────────────────────────────────────────
// 全 status を 2 種に集約: 注意喚起 = WarningBadge / それ以外 = MutedBadge。
// 緑「OK」や黄色「中」も MutedBadge に寄せて色の主張を消す。

function MutedBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center text-[11px] font-medium text-slate-600 bg-slate-100 rounded-full px-2 py-0.5">
      {children}
    </span>
  );
}

function WarningBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center text-[11px] font-medium text-red-700 bg-red-50 rounded-full px-2 py-0.5">
      {children}
    </span>
  );
}

// ── 大学・学部との一致 ────────────────────────────────────────────
// EvaluationAxisCheck の判定ロジックを reuse、UI のみ list-row 化。
// status='missing' のみ WarningBadge、'maybe' は MutedBadge（緑/黄を排除）。

function EvaluationAxisReport({
  text,
  university,
  faculty,
}: {
  text: string;
  university: string;
  faculty: string;
}) {
  const preset = useMemo<EvaluationAxisPreset | null>(() => {
    if (!university.trim() && !faculty.trim()) return null;
    return getEvaluationAxes(university, faculty);
  }, [university, faculty]);

  const results = useMemo<AxisCheckResult[]>(
    () => (preset ? preset.axes.map((axis) => checkAxis(text, axis)) : []),
    [preset, text],
  );

  if (!preset || results.length === 0) return null;

  const missingCount = results.filter((r) => r.status === 'missing').length;

  return (
    <Subsection title="大学・学部との一致">
      <p className="text-xs text-slate-400 mb-5">
        参照：{preset.displayName}
        {missingCount > 0 && ` ・ ${missingCount} 件が確認できません`}
      </p>
      <ul className="divide-y divide-slate-100">
        {results.map((r) => (
          <li key={r.axis.id} className="py-5 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2 mb-2">
              {r.status === 'missing' ? (
                <WarningBadge>要確認</WarningBadge>
              ) : (
                <MutedBadge>含まれている可能性あり</MutedBadge>
              )}
              <span className="text-base font-medium text-slate-900">
                {r.axis.label}
              </span>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-2">
              {r.axis.description}
            </p>
            {r.status === 'missing' && (
              <p className="text-sm text-slate-500 leading-relaxed">
                → {r.axis.checkQuestion}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Subsection>
  );
}

// ── 構造分析 ──────────────────────────────────────────────────────
// score 0/1/2 の閾値ロジックは StructureAnalysis 側のまま。UI のみ簡略化。
// 既存の score>=2='green' / score=1='amber' / score=0='red' の 3 色出し分けを
// 「< 2 → WarningBadge / それ以外 → MutedBadge」の 2 値に集約。

function StructureReport({ text }: { text: string }) {
  const analysis = useMemo<StructureAnalysis[]>(() => {
    if (!text.trim()) return [];
    const result = analyzeStructure(text);
    return STRUCTURE_DISPLAY_ORDER.map(
      (t) => result.find((a) => a.type === t)!,
    ).filter(Boolean);
  }, [text]);

  if (analysis.length === 0) return null;

  return (
    <Subsection title="構造">
      <ul className="divide-y divide-slate-100">
        {analysis.map((item) => (
          <li key={item.type} className="py-5 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2 mb-2">
              {item.score < 2 ? (
                <WarningBadge>
                  {item.score === 0 ? '不足' : 'もう少し'}
                </WarningBadge>
              ) : (
                <MutedBadge>OK</MutedBadge>
              )}
              <span className="text-base font-medium text-slate-900">
                {STRUCTURE_LABELS[item.type]}
              </span>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-2">
              {item.reason}
            </p>
            {item.score < 2 && (
              <p className="text-sm text-slate-500 leading-relaxed">
                → {item.hint}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Subsection>
  );
}

// ── 抽象表現・文章品質（NGワード分析） ────────────────────────────
// NgWordCheck の DeepDive / QualityDeepDive / 各種ボタンは analysis page では出さない。
// 「修正候補リスト」として理由 / 改善方向 / 手がかり を読み物的に並べる。
// severity='high' のみ WarningBadge、それ以外は MutedBadge。

function NgWordReport({
  text,
  activities,
  university,
  faculty,
}: {
  text: string;
  activities: ActivityData | null;
  university: string;
  faculty: string;
}) {
  const issues = useMemo<NgWordIssue[]>(
    () => detectNgWords(text, activities, university, faculty),
    [text, activities, university, faculty],
  );

  if (issues.length === 0) return null;

  return (
    <Subsection title="抽象表現・文章品質">
      <ul className="divide-y divide-slate-100">
        {issues.map((issue, i) => (
          <li key={i} className="py-5 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2 mb-3">
              {issue.severity === 'high' ? (
                <WarningBadge>優先度 高</WarningBadge>
              ) : (
                <MutedBadge>優先度 中</MutedBadge>
              )}
              <span className="text-base font-medium text-slate-900">
                {issue.phrase}
              </span>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  なぜ弱い？
                </p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {issue.reason}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  改善の方向
                </p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {issue.suggestion}
                </p>
              </div>
              {issue.activityHint && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    手がかり
                  </p>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {issue.activityHint}
                  </p>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Subsection>
  );
}

// ── entry が見つからない時 ────────────────────────────────────────
function NotFound() {
  return (
    <div className="py-16 text-center">
      <h2 className="text-base font-medium text-slate-900 mb-2">
        分析データが見つかりません
      </h2>
      <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-md mx-auto">
        指定された志望理由書の記録が見つかりませんでした。
      </p>
      <LinkButton href="/statement/score" variant="primary" size="md">
        今のスコアへ戻る
      </LinkButton>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────

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
