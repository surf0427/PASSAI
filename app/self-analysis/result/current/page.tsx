'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import type {
  PersistedAnalyzeState,
  SummaryResult,
  WallHittingResult,
} from '@/types/analysis';
import type { SelfPR } from '@/types/selfPR';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadAnalyzeState } from '@/lib/analyzeStorage';
import { loadSelfPRs } from '@/lib/selfPRStorage';

// hub / result list と同形 mount gate。
// SSR では data=null（"読み込み中..."）にし、hydration 後に client で localStorage を読む。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

type TabKey = 'analysis' | 'deepdive' | 'reviews';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'analysis', label: '活動整理' },
  { key: 'deepdive', label: '深掘り' },
  { key: 'reviews', label: '添削結果' },
];

type LoadedData = {
  state: PersistedAnalyzeState | null;
  prs: SelfPR[];
};

export default function ResultDetailPage() {
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  const [activeTab, setActiveTab] = useState<TabKey>('analysis');

  // STEP-RESULT-2 MVP: 単一エントリ analyzeState + selfPRs[] を 1 回読むだけ。
  // API / fetch / cache helper には触らず、保存済みデータの参照に限定する。
  const data: LoadedData | null = useMemo(() => {
    if (!isMounted) return null;
    return {
      state: loadAnalyzeState(),
      prs: loadSelfPRs(),
    };
  }, [isMounted]);

  // "結果として表示可能か" は summary の有無で判定する（result list と同じ基準）。
  const hasResult = data !== null && data.state?.summary != null;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <BackLinks />
      <PageHeader
        title="自己分析結果"
        description="保存済みデータから直近の自己分析結果を表示しています。"
      />

      {!data && <p className="text-sm text-slate-400">読み込み中...</p>}

      {data && !hasResult && <EmptyState />}

      {data && hasResult && (
        <>
          <TabBar active={activeTab} onChange={setActiveTab} />
          {activeTab === 'analysis' && (
            <AnalysisTab analysis={data.state!.analysis} />
          )}
          {activeTab === 'deepdive' && (
            <DeepDiveTab state={data.state!} />
          )}
          {activeTab === 'reviews' && <ReviewsTab prs={data.prs} />}
        </>
      )}
    </div>
  );
}

// ─── ナビゲーション ─────────────────────────────────────────────────────────

function BackLinks() {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      <Link
        href="/self-analysis"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
      >
        ← 自己分析機能一覧に戻る
      </Link>
      <Link
        href="/self-analysis/result"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
      >
        ← 結果一覧に戻る
      </Link>
    </div>
  );
}

function TabBar({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (next: TabKey) => void;
}) {
  return (
    // mobile: 各タブが等幅。スクロールせず 3 タブ収まるサイズ感（label は短い）。
    <div className="flex border-b border-slate-200 mb-6 sticky top-0 bg-white z-10">
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            aria-pressed={isActive}
            className={`flex-1 px-3 py-3 text-sm font-semibold transition-colors border-b-2 -mb-px ${
              isActive
                ? 'text-blue-600 border-blue-600'
                : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── empty state ───────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="text-center py-16">
      <p className="text-gray-400 text-base mb-8">
        表示できる自己分析結果がありません
      </p>
      <div className="flex flex-col items-center gap-3 max-w-sm mx-auto">
        <Link
          href="/self-analysis"
          className="w-full inline-block text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
        >
          自己分析トップに戻る
        </Link>
        <Link
          href="/self-analysis/run"
          className="w-full inline-block text-center border border-blue-300 text-blue-600 hover:bg-blue-50 font-semibold px-8 py-3 rounded-lg text-base transition-colors"
        >
          0から自己PRを書く
        </Link>
      </div>
    </div>
  );
}

// ─── タブ1: 活動整理結果 ─────────────────────────────────────────────────────

function AnalysisTab({ analysis }: { analysis: WallHittingResult | null }) {
  if (!analysis) {
    // summary はあるが analysis が無い legacy state。ガード表示。
    return (
      <p className="text-sm text-slate-500">
        活動整理結果のデータが保存されていません。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Section title="活動ストーリー" tone="blue">
        <p className="text-sm text-blue-900 leading-relaxed whitespace-pre-wrap">
          {analysis.summary}
        </p>
      </Section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Section title="強み" tone="green">
          <BulletList items={analysis.strengths} tone="green" />
        </Section>
        <Section title="補強ポイント" tone="orange">
          <BulletList items={analysis.weaknesses} tone="orange" />
        </Section>
      </div>

      <Section title="将来とのつながり（仮説）" tone="purple">
        <BulletList items={analysis.futureConnections} tone="purple" arrow />
      </Section>

      <Section title="生成された深掘り質問" tone="slate">
        {analysis.questions.length === 0 ? (
          <p className="text-sm text-slate-500">質問は保存されていません。</p>
        ) : (
          <ol className="space-y-2 list-decimal list-inside text-sm text-slate-800">
            {analysis.questions.map((q, i) => (
              <li key={i} className="leading-relaxed">
                {q}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

// ─── タブ2: 深掘り質問・回答・まとめ ─────────────────────────────────────────

function DeepDiveTab({ state }: { state: PersistedAnalyzeState }) {
  // displayedQuestions が無い旧データは analysis.questions 先頭5問にフォールバック
  // （/self-analysis/run 側の初期化ロジックと同じ方針）。
  const questions =
    state.displayedQuestions && state.displayedQuestions.length > 0
      ? state.displayedQuestions
      : state.analysis?.questions.slice(0, 5) ?? [];
  const answers = state.answers ?? [];
  const deepAnswers = state.deepAnswers ?? [];
  const freeMemo = typeof state.freeMemo === 'string' ? state.freeMemo : '';
  const summary = state.summary;

  return (
    <div className="space-y-6">
      {/* 質問と回答 */}
      <div>
        <h3 className="text-sm font-bold text-slate-800 mb-3">深掘り質問への回答</h3>
        {questions.length === 0 ? (
          <p className="text-sm text-slate-500">深掘り質問は保存されていません。</p>
        ) : (
          <div className="space-y-4">
            {questions.map((q, i) => (
              <QuestionItem
                key={i}
                index={i}
                question={q}
                answer={answers[i] ?? ''}
                deepAnswer={deepAnswers[i] ?? ''}
              />
            ))}
          </div>
        )}
      </div>

      {/* 自由メモ */}
      <div>
        <h3 className="text-sm font-bold text-slate-800 mb-2">自由メモ</h3>
        {freeMemo.trim() === '' ? (
          <p className="text-sm text-slate-400">未入力</p>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
              {freeMemo}
            </p>
          </div>
        )}
      </div>

      {/* 最終まとめ */}
      <div>
        <h3 className="text-sm font-bold text-slate-800 mb-3">最終まとめ</h3>
        {summary ? (
          <SummaryBlock summary={summary} />
        ) : (
          <p className="text-sm text-slate-500">まとめは保存されていません。</p>
        )}
      </div>
    </div>
  );
}

function QuestionItem({
  index,
  question,
  answer,
  deepAnswer,
}: {
  index: number;
  question: string;
  answer: string;
  deepAnswer: string;
}) {
  const trimmedAnswer = answer.trim();
  const trimmedDeep = deepAnswer.trim();
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-800 mb-2">
        Q{index + 1}. {question}
      </p>
      <div className="text-sm text-slate-700 leading-relaxed">
        {trimmedAnswer === '' ? (
          <p className="text-slate-400">回答なし</p>
        ) : (
          <p className="whitespace-pre-wrap">{trimmedAnswer}</p>
        )}
      </div>
      {trimmedDeep !== '' && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-500 mb-1">追加メモ</p>
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
            {trimmedDeep}
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryBlock({ summary }: { summary: SummaryResult }) {
  return (
    <div className="space-y-3">
      <SummaryItem label="活動の要約" body={summary.activitySummary} />
      <SummaryItem label="強み" body={summary.strengths} />
      <SummaryItem label="アピールポイント" body={summary.appealPoints} />
    </div>
  );
}

function SummaryItem({ label, body }: { label: string; body: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
        {label}
      </p>
      <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
        {body || '—'}
      </p>
    </div>
  );
}

// ─── タブ3: 自己PR添削結果 ───────────────────────────────────────────────────

function ReviewsTab({ prs }: { prs: SelfPR[] }) {
  if (prs.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400 text-base mb-6">
          まだ自己PR添削結果はありません
        </p>
        <Link
          href="/self-pr"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
        >
          自己PRを書く →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {prs.map((pr) => (
        <PrReviewCard key={pr.id} pr={pr} />
      ))}
    </div>
  );
}

function PrReviewCard({ pr }: { pr: SelfPR }) {
  const title = pr.title?.trim() || resolveFallbackTitle(pr);
  const hasReview = !!pr.latestResult && pr.latestResult.trim() !== '';

  return (
    <Card variant="default" padding="md">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-full">
          {pr.index}回目
        </span>
        <span className="text-xs text-slate-400">
          {formatDate(pr.createdAt ?? pr.updatedAt)} 作成
        </span>
        {hasReview && (
          <span className="text-xs text-emerald-600 font-medium ml-auto">
            添削済み
          </span>
        )}
      </div>
      <p className="text-sm font-semibold text-slate-800 mb-2">{title}</p>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3">
        <p className="text-[11px] font-bold text-slate-500 mb-1">本文</p>
        <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
          {pr.text.trim() === '' ? '（本文未入力）' : pr.text}
        </p>
      </div>

      <div>
        <p className="text-[11px] font-bold text-slate-500 mb-1">添削結果</p>
        {hasReview ? (
          <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_hr]:my-4 [&_strong]:font-semibold [&_p]:my-2">
            <ReactMarkdown>{pr.latestResult}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-slate-400">まだ添削結果はありません</p>
        )}
      </div>
    </Card>
  );
}

function resolveFallbackTitle(pr: SelfPR): string {
  const text = pr.text.trim();
  if (text === '') return '（本文未入力）';
  return text.length > 20 ? `${text.slice(0, 20)}…` : text;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}/${m}/${day}`;
}

// ─── 共通: セクションとリスト ───────────────────────────────────────────────

type Tone = 'blue' | 'green' | 'orange' | 'purple' | 'slate';

const SECTION_TONE: Record<Tone, string> = {
  blue: 'bg-blue-50 border-blue-200',
  green: 'bg-green-50 border-green-200',
  orange: 'bg-orange-50 border-orange-200',
  purple: 'bg-purple-50 border-purple-200',
  slate: 'bg-slate-50 border-slate-200',
};

const SECTION_HEADING_TONE: Record<Tone, string> = {
  blue: 'text-blue-800',
  green: 'text-green-800',
  orange: 'text-orange-800',
  purple: 'text-purple-800',
  slate: 'text-slate-700',
};

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <div className={`border rounded-xl p-5 ${SECTION_TONE[tone]}`}>
      <h3 className={`text-sm font-bold mb-3 ${SECTION_HEADING_TONE[tone]}`}>
        {title}
      </h3>
      {children}
    </div>
  );
}

const BULLET_TONE: Record<Tone, string> = {
  blue: 'text-blue-900',
  green: 'text-green-900',
  orange: 'text-orange-900',
  purple: 'text-purple-900',
  slate: 'text-slate-800',
};

function BulletList({
  items,
  tone,
  arrow,
}: {
  items: string[];
  tone: Tone;
  arrow?: boolean;
}) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-slate-500">該当なし</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li
          key={i}
          className={`flex gap-2 text-sm leading-relaxed ${BULLET_TONE[tone]}`}
        >
          <span className="shrink-0 opacity-60 mt-0.5">{arrow ? '→' : '・'}</span>
          <span className="whitespace-pre-wrap">{item}</span>
        </li>
      ))}
    </ul>
  );
}
