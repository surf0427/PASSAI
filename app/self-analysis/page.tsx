'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { LinkButton } from '@/components/ui/LinkButton';
import { Button } from '@/components/ui/Button';
import { loadAnalyzeState, saveAnalyzeState } from '@/lib/analyzeStorage';
import { loadSelfPRs } from '@/lib/selfPRStorage';
import { loadSelfAnalysisLogs } from '@/lib/selfAnalysisLogStorage';
import type { AnalyzeStep } from '@/types/analysis';

// マウント前 false / マウント後 true。`/statement/page.tsx` と同形パターン。
// SSR では localStorage を読まず status=null（4 stat を `—`、カードは通常 description）にし、
// hydration 後に client で helper を呼んで再 render する。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

type Status = {
  // 「現在の作業バッファ」の step（無ければ null）。analyzeState は STEP-LOG-2 以降も
  // 単一エントリ。working state 用途であって、完了済みログ履歴ではない点に注意。
  resumeStep: AnalyzeStep | null;
  // 「現在の作業バッファ」に summary があるか。resume で再深掘り中は null になる。
  // ③ ゲートにはこの値ではなく selfAnalysisLogCount を使う（STEP-LOG-2 以降）。
  summaryReady: boolean;
  // selfPRs の件数（自己PR添削履歴）。
  prCount: number;
  // selfAnalysisLogs の件数。STEP-LOG-1 以降、summarize 完了のたびに append される。
  // ③「前回の続きからやる」のゲート条件と「結果ログ」表示の正本。
  // working state とは独立に過去履歴を保持するため、再深掘り中も増減しない。
  selfAnalysisLogCount: number;
};

export default function SelfAnalysisEntryPage() {
  const router = useRouter();
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  const status = useMemo<Status | null>(() => {
    if (!isMounted) return null;
    const state = loadAnalyzeState();
    return {
      resumeStep: state?.step ?? null,
      summaryReady: !!state?.summary,
      prCount: loadSelfPRs().length,
      selfAnalysisLogCount: loadSelfAnalysisLogs().length,
    };
  }, [isMounted]);

  // ① 0から自己PRを書く: 既存 analyzeState を壊さず step だけ 'confirm' に戻して /run へ。
  // /home/page.tsx:handleGoToSelfAnalysis と同形パターン。analyzeState の schema は触らない。
  function startFresh() {
    const saved = loadAnalyzeState();
    if (saved) {
      saveAnalyzeState({ ...saved, step: 'confirm' });
    }
    router.push('/self-analysis/run');
  }

  // ③ 前回の続きから: ゲートは selfAnalysisLogs の有無で判定する（STEP-LOG-2 以降）。
  //
  // 旧 (STEP-RESUME-1) は status.summaryReady でゲートしていたが、これは「working
  // analyzeState に summary があるか」を見ており、③ で再深掘り開始すると analyzeState の
  // summary は null に倒れる（resume が saveAnalyzeState で意図的にリセットするため）。
  // その状態で hub に戻ると ③ が disabled になる UX バグが生じていた。
  //
  // 完了済みログは STEP-LOG-1 で selfAnalysisLogs に独立保存されるようになったため、
  // 「再深掘りの材料が手元にあるか」は logs.length で判定するのが正しい。
  // resume 中の working state の状態には依存しない。
  const canResume = status !== null && status.selfAnalysisLogCount > 0;

  // STEP-UX-FIX-05-HUB-SUGGEST: 「次におすすめ」の派生。null 分岐は SSR / 初回
  // client render と一致させる first-time 用 fallback。
  const suggestion = useMemo(() => pickSelfAnalysisSuggestion(status), [status]);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <PageHeader
        title="自己分析"
        description="今やりたいことを選んでください。"
      />

      <Card variant="soft" padding="md" className="mb-5 sm:mb-6">
        <p className="text-[11px] font-bold text-blue-700 tracking-widest mb-3">
          現在地
        </p>
        <div className="grid grid-cols-2 gap-y-3 gap-x-4">
          <StatusItem label="進捗" value={displayProgress(status)} />
          <StatusItem label="活動まとめ" value={displaySummary(status)} />
          <StatusItem label="自己PR添削" value={displayPrCount(status)} />
          <StatusItem label="結果ログ" value={displayResultLog(status)} />
        </div>
      </Card>

      <SuggestionCard suggestion={suggestion} onStartFresh={startFresh} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <ModeCard
          title="0から自己PRを書く"
          description="活動整理から始めて、本文作成・添削まで進めます。"
          onClick={startFresh}
        />
        <ModeCard
          title="全文を自力で書く"
          description="活動整理を使わずに、自分で自己PR本文を書いて添削します。"
          href="/self-pr?mode=direct"
        />
        <ModeCard
          title="前回の続きからやる"
          description={
            canResume
              ? '過去の自己分析ログを選んで、もう一度深掘り質問から始めます。'
              : 'まず自己分析を完了してください。'
          }
          href={canResume ? '/self-analysis/resume' : undefined}
          disabled={!canResume}
        />
        <ModeCard
          title="過去の結果を見る"
          description="活動整理・深掘り・添削結果を確認できます。"
          href="/self-analysis/result"
        />
      </div>

      {/* hub 着地後、初回ユーザーには「まず ① から」と分かるよう一行だけ補足。
          mount 前は文言だけ出す（disabled 判定が走らないので CTA 文脈に影響なし）。*/}
      <p className="mt-6 text-xs text-slate-500 leading-relaxed">
        初めて使う方は「0から自己PRを書く」から始めてください。
      </p>

      {/* 旧来のホームへの戻り導線を簡易に。スマホでも視認しやすい位置に置く。*/}
      <div className="mt-8">
        <Link
          href="/home"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
        >
          ← ホームに戻る
        </Link>
      </div>
    </div>
  );
}

// ── 次におすすめ（STEP-UX-FIX-05-HUB-SUGGEST）─────────────────────
// status から「次にやること」を 1 つ選ぶ。null 分岐は first-time 用 fallback も兼ねる。
// 「0 から自己PRを書く」は onClick 経路 (startFresh) のため、Suggestion は
// kind: 'start' で表現し、SuggestionCard 側で Button を出し分ける。

type Suggestion =
  | {
      kind: 'start';
      title: string;
      description: string;
      cta: string;
    }
  | {
      kind: 'link';
      title: string;
      description: string;
      href: string;
      cta: string;
    };

const SELF_ANALYSIS_SUGGESTION_START: Suggestion = {
  kind: 'start',
  title: 'まず自己分析を始める',
  description: '活動整理から深掘り・まとめまで、一連の流れで進めます。',
  cta: '自己分析を始める →',
};

const SELF_ANALYSIS_SUGGESTION_PR: Suggestion = {
  kind: 'link',
  title: '自己PRを書いてみる',
  description: '自己分析の結果をもとに、自己PR本文を作って添削できます。',
  href: '/self-pr',
  cta: '自己PRに進む →',
};

const SELF_ANALYSIS_SUGGESTION_RESULT: Suggestion = {
  kind: 'link',
  title: '過去の結果を見直す',
  description: 'まとめログと自己PR履歴をまとめて確認できます。',
  href: '/self-analysis/result',
  cta: '結果を見る →',
};

function pickSelfAnalysisSuggestion(status: Status | null): Suggestion {
  if (status === null) return SELF_ANALYSIS_SUGGESTION_START;
  if (status.prCount > 0) return SELF_ANALYSIS_SUGGESTION_RESULT;
  if (status.summaryReady || status.selfAnalysisLogCount > 0) {
    return SELF_ANALYSIS_SUGGESTION_PR;
  }
  return SELF_ANALYSIS_SUGGESTION_START;
}

function SuggestionCard({
  suggestion,
  onStartFresh,
}: {
  suggestion: Suggestion;
  onStartFresh: () => void;
}) {
  return (
    <Card variant="soft" padding="md" className="mb-5 sm:mb-6">
      <p className="text-[11px] font-bold text-blue-700 tracking-widest mb-2">
        次におすすめ
      </p>
      <p className="text-sm font-bold text-slate-800 mb-1">{suggestion.title}</p>
      <p className="text-xs text-slate-500 leading-relaxed mb-3">
        {suggestion.description}
      </p>
      {suggestion.kind === 'start' ? (
        <Button
          variant="primary"
          size="md"
          onClick={onStartFresh}
          className="w-full sm:w-auto"
        >
          {suggestion.cta}
        </Button>
      ) : (
        <LinkButton
          href={suggestion.href}
          variant="primary"
          size="md"
          className="w-full sm:w-auto"
        >
          {suggestion.cta}
        </LinkButton>
      )}
    </Card>
  );
}

const EM_DASH = '—';

function displayProgress(status: Status | null): string {
  if (!status || status.resumeStep === null) return EM_DASH;
  switch (status.resumeStep) {
    case 'confirm':
      return '活動確認';
    case 'answering':
      return '深掘り中';
    case 'summary':
      return 'まとめ済';
  }
}

function displaySummary(status: Status | null): string {
  if (!status) return EM_DASH;
  return status.summaryReady ? 'あり' : EM_DASH;
}

function displayPrCount(status: Status | null): string {
  if (!status || status.prCount === 0) return EM_DASH;
  return `${status.prCount}件`;
}

// STEP-LOG-1 以降、selfAnalysisLogs に完了済みログが履歴として蓄積されるため、
// 「結果ログ」の件数は logs.length をそのまま反映する。
// working state の summary 状態とは独立（resume 中に working summary=null になっても
// 過去ログ件数は減らない）。
function displayResultLog(status: Status | null): string {
  if (!status || status.selfAnalysisLogCount === 0) return EM_DASH;
  return `${status.selfAnalysisLogCount}件`;
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm font-semibold truncate text-slate-800">{value}</p>
    </div>
  );
}

const CARD_BASE =
  'block w-full text-left rounded-2xl bg-white ring-1 ring-slate-200 shadow-card transition-all p-4 sm:p-5 min-h-[120px]';
const CARD_ACTIVE = 'hover:shadow-md active:bg-slate-50';
const CARD_DISABLED = 'opacity-60 pointer-events-none';

type ModeCardProps = {
  title: string;
  description: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
};

// 「使えない」より「まだ今ではない」空気感を出すため、disabled でも
// ring/shadow/レイアウトは維持し、テキスト彩度だけ下げる（/statement と同じ思想）。
function ModeCard({ title, description, href, onClick, disabled, badge }: ModeCardProps) {
  const titleClass = `text-sm sm:text-base font-bold mb-1.5 leading-snug ${
    disabled ? 'text-slate-400' : 'text-slate-900'
  }`;
  const descClass = `text-xs leading-relaxed ${
    disabled ? 'text-slate-400' : 'text-slate-500'
  }`;

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h2 className={titleClass}>{title}</h2>
        {badge && (
          <span className="shrink-0 text-[10px] font-bold tracking-wider text-slate-400 border border-slate-200 rounded-full px-2 py-0.5">
            {badge}
          </span>
        )}
      </div>
      <p className={descClass}>{description}</p>
    </>
  );

  if (disabled) {
    return (
      <div aria-disabled="true" className={`${CARD_BASE} ${CARD_DISABLED}`}>
        {inner}
      </div>
    );
  }

  if (href) {
    return (
      <Link href={href} className={`${CARD_BASE} ${CARD_ACTIVE}`}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={`${CARD_BASE} ${CARD_ACTIVE}`}>
      {inner}
    </button>
  );
}
