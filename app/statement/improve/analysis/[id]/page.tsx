'use client';

// STEP-IA-1: ④ improve flow 専用 analysis page。
//   入口 = improve hub（一覧）の各カードクリック。
//   出口 = 下部 primary CTA 「書き直し準備へ進む →」→ /statement/improve/rewrite/[id]。
//   戻り = 「← 一覧に戻る」 → /statement/improve。
//
//   ③ score の view-only analysis（/statement/analysis/[id]）とは別ページに分離した。
//   shared component 化は意図的に避け、両ページが今後 hierarchy / CTA / tone でズレても
//   片方の変更がもう片方を壊さないようにしている。analysis intelligence （lib の
//   detectNgWords / analyzeStructure / getEvaluationAxes / checkAxis / result.actions /
//   weaknesses / strengths）自体は両ページで reuse する。
//
// hierarchy（do oriented）:
//   1. 改善ポイント（最優先・violet accent）             ← result.actions
//   2. なぜ弱いか                                          ← result.weaknesses
//   3. 現在の本文（推敲対象として読ませる）                  ← entry.essay
//   4. 改善の方向（具体的にどこを直すか）                    ← Evaluation / Structure / NgWord
//   5. 残したい良い点（compact, 末尾）                       ← result.strengths
//   6. 書き直し準備へ進む CTA                              → /statement/improve/rewrite/[id]
//
//   score-analysis 側は「現在の状態」が主役、improve-analysis 側は「どこを直すべきか」が主役。
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

export default function StatementImproveAnalysisPage() {
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
          href="/statement/improve"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← 一覧に戻る
        </Link>
      </div>

      {isMounted && entry === null && <NotFound />}
      {isMounted && entry !== null && (
        <ImproveReport entry={entry} activities={activities} />
      )}
    </div>
  );
}

// ── レポート本体 ──────────────────────────────────────────────────
// do oriented hierarchy: 何を / なぜ / どこを / どう直すか の順に積み上げる。

function ImproveReport({
  entry,
  activities,
}: {
  entry: ReviewHistoryItem;
  activities: ActivityData | null;
}) {
  return (
    <article>
      <header className="mb-14">
        <p className="text-xs text-slate-400 tabular-nums mb-3">
          {formatDateTime(entry.createdAt)}
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight mb-2">
          改善レポート
        </h1>
        <p className="text-sm text-slate-500 mb-5">
          {[entry.university || '大学未入力', entry.faculty, entry.department]
            .filter((v) => v && v.length > 0)
            .join(' / ')}
        </p>
        <p className="text-sm text-slate-600 leading-relaxed max-w-xl">
          どこを直すかを決めて、書き直し準備に進みましょう。
        </p>
      </header>

      {/* 1. 改善ポイント（最優先・violet accent） ─────────────────── */}
      {entry.result.actions.length > 0 && (
        <section className="mb-16">
          <div className="rounded-lg bg-violet-50/40 border border-violet-100 px-5 sm:px-6 py-5 sm:py-6">
            <h2 className="text-xs font-semibold text-violet-700 uppercase tracking-wider mb-4">
              改善ポイント
            </h2>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700 leading-relaxed marker:text-violet-400">
              {entry.result.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* 2. なぜ弱いか ─────────────────────────────────────────── */}
      {entry.result.weaknesses.length > 0 && (
        <Section title="なぜ弱いか">
          <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700 leading-relaxed marker:text-slate-400">
            {entry.result.weaknesses.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* 3. 現在の本文（推敲対象として読ませる） ────────────────────── */}
      <Section title="現在の本文">
        <pre className="whitespace-pre-wrap leading-relaxed text-slate-700 font-sans text-[15px]">
          {entry.essay}
        </pre>
      </Section>

      {/* 4. 改善の方向（具体的にどこを直すか） ────────────────────── */}
      <Section title="改善の方向">
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

      {/* 5. 残したい良い点（compact, 末尾） ───────────────────────── */}
      {entry.result.strengths.length > 0 && (
        <Section title="残したい良い点">
          <p className="text-sm text-slate-500 leading-relaxed mb-4">
            書き直すときも、ここは活かしましょう。
          </p>
          <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700 leading-relaxed marker:text-slate-400">
            {entry.result.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* 6. primary CTA → 書き直し準備 ─────────────────────────── */}
      <section className="mt-4 mb-8">
        <LinkButton
          href={`/statement/improve/rewrite/${encodeURIComponent(entry.id)}`}
          variant="primary"
          size="lg"
          className="w-full sm:w-auto"
        >
          書き直し準備へ進む →
        </LinkButton>
        <p className="text-xs text-slate-400 mt-3 leading-relaxed">
          改善ポイントをもとに、Before / After や書き直しメモを整理する準備ページへ進みます。
        </p>
      </section>
    </article>
  );
}

// ── レイアウト primitives ─────────────────────────────────────────

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
// improve flow では「改善の方向」ラベルを復活させる（do oriented）。

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
      <LinkButton href="/statement/improve" variant="primary" size="md">
        一覧へ戻る
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
