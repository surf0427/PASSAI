'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCurrentUserId } from '@/app/components/AuthProvider';
import { useQuotaDialog } from '@/components/billing/QuotaExceededDialog';
import type { ActivityData } from '@/types/activity';
import type { SelfAnalysisLog } from '@/types/selfAnalysisLog';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadAnalyzeState, saveAnalyzeState } from '@/lib/analyzeStorage';
import { loadActivityData } from '@/lib/activityStorage';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import {
  loadSelfAnalysisLogs,
  persistSelfAnalysisLog,
} from '@/lib/selfAnalysisLogStorage';
import { buildUniversityContextFromBasicInfo } from '@/lib/buildUniversityContext';
import {
  ADDITIONAL_QUESTIONS_MODEL,
  ADDITIONAL_QUESTIONS_PROMPT_VERSION,
  hashAdditionalQuestionsInput,
} from '@/lib/aiInputHash';
import {
  loadAdditionalQuestionsCache,
  saveAdditionalQuestionsCache,
} from '@/lib/additionalQuestionsCache';
import { logAiCache } from '@/lib/aiCacheLog';
import { aiErrorMessage } from '@/lib/aiErrorMessage';
import { validateAdditionalQuestionInput } from '@/lib/validation/validateAdditionalQuestionInput';
import { logAiValidation } from '@/lib/aiValidationLog';
import { additionalQuestionsLimit, type DailyUsage } from '@/lib/dailyLimit';

// /self-analysis/run と同じ「AI に渡す活動データ」のソース順序。
// session 優先 → /run の cache lane と整合。空なら localStorage の form draft にフォールバック。
function getActivityData(): ActivityData | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem('activityData');
    if (stored) return JSON.parse(stored) as ActivityData;
  } catch {
    // ignore
  }
  return loadActivityData();
}

export default function ResumePage() {
  // STEP-GATE-COMPLETE: 402 quota-exceeded ハンドラ。
  const { handleResponse: handleQuotaResponse, dialog: quotaDialog } =
    useQuotaDialog();

  const router = useRouter();
  // logs === null は「mount/backfill がまだ完了していない」。
  // 空配列 (logs.length === 0) の「ログ無し」状態と明確に区別する。
  const [logs, setLogs] = useState<SelfAnalysisLog[] | null>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [usage, setUsage] = useState<DailyUsage>(
    () => additionalQuestionsLimit.loadUsage(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // STEP-SUPABASE-COMPLETE-04D: legacy 救済 persist の dualWrite に使う owner key。
  // mount-once effect（deps []）から参照するため ref で最新値を保持する
  // （effect の deps を [] に保ち、auth 確定タイミングに依存しない）。
  const currentUserId = useCurrentUserId();
  const currentUserIdRef = useRef<string | null>(currentUserId);
  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  // mount 1 回限り。既存ユーザ救済のため、selfAnalysisLogs 空かつ analyzeState に
  // summary + analysis が揃っているケースだけ、persistSelfAnalysisLog で legacy
  // entry を 1 件作る (summaryInputHash='legacy:v1')。idempotent: 2 回目以降の mount
  // では logs.length > 0 なので backfill 経路に入らない。
  //
  // genuine write side-effect (localStorage への persist) + render に必要な state 初期化を
  // 兼ねるため react-hooks/set-state-in-effect は scoped に disable する。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let stored = loadSelfAnalysisLogs();
    if (stored.length === 0) {
      const state = loadAnalyzeState();
      if (state?.summary && state.analysis) {
        const legacyLog = persistSelfAnalysisLog({
          summaryInputHash: 'legacy:v1',
          analysis: state.analysis,
          displayedQuestions: state.displayedQuestions ?? [],
          answers: state.answers ?? [],
          deepAnswers: state.deepAnswers ?? [],
          freeMemo: typeof state.freeMemo === 'string' ? state.freeMemo : '',
          summary: state.summary,
        });
        // 即時 mirror（best-effort）。summaryInputHash='legacy:v1' でも
        // UNIQUE(user_id, summary_input_hash) により冪等 upsert される。
        // userId 未確定（mount 直後で auth 未確定なケースが多い）なら no-op とし、
        // AuthProvider の backfill が後で拾う。
        const userId = currentUserIdRef.current;
        if (userId) {
          void import('@/lib/repository/selfAnalysisLogRepository')
            .then((mod) =>
              mod.dualWriteSelfAnalysisLog({ log: legacyLog, userId }),
            )
            .catch(() => {});
        }
        stored = loadSelfAnalysisLogs();
      }
    }
    setLogs(stored);
    setSelectedLogId(stored[0]?.id ?? null);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectedLog = logs?.find((l) => l.id === selectedLogId) ?? null;

  async function handleResume() {
    if (loading) return;
    setError('');

    if (!selectedLog) {
      setError('ログが選択されていません。');
      return;
    }

    if (!additionalQuestionsLimit.canUse(usage)) return;

    const activityData = getActivityData();
    if (!activityData) {
      setError(
        '活動データが見つかりませんでした。活動整理ページを一度開いてから戻ってきてください。',
      );
      return;
    }

    // deterministic validation: 活動内容が空のときに AI を呼ばないようにする。
    // additional の thresholds は緩く（EMPTY のみ）。
    const additionalValidation = validateAdditionalQuestionInput(activityData);
    if (!additionalValidation.ok) {
      logAiValidation({
        type: 'validation_reject',
        route: 'additional-questions',
        code: additionalValidation.code,
      });
      setError(additionalValidation.message);
      return;
    }
    logAiValidation({ type: 'validation_pass', route: 'additional-questions' });

    const basicInfo = loadBasicInfo();
    const universityContext = buildUniversityContextFromBasicInfo(basicInfo);
    // existingQuestions は selectedLog 由来。selectedLog.displayedQuestions が
    // 空なら analysis.questions の先頭 5 問を fallback として使う。
    const existingQuestions =
      selectedLog.displayedQuestions.length > 0
        ? selectedLog.displayedQuestions
        : selectedLog.analysis.questions.slice(0, 5);

    const inputHash = hashAdditionalQuestionsInput({
      activityData,
      basicInfo,
      universityContext,
      existingQuestions,
      model: ADDITIONAL_QUESTIONS_MODEL,
      promptVersion: ADDITIONAL_QUESTIONS_PROMPT_VERSION,
    });

    const cached = loadAdditionalQuestionsCache();
    if (
      cached &&
      cached.inputHash === inputHash &&
      cached.model === ADDITIONAL_QUESTIONS_MODEL &&
      cached.promptVersion === ADDITIONAL_QUESTIONS_PROMPT_VERSION &&
      cached.questions.length > 0
    ) {
      logAiCache({ route: 'api/analysis/additional', action: 'hit', inputHash });
      applyResumedQuestions(selectedLog, cached.questions);
      router.push('/self-analysis/run');
      return;
    }
    logAiCache({ route: 'api/analysis/additional', action: 'miss', inputHash });

    setLoading(true);
    try {
      const res = await fetch('/api/analysis/additional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityData, existingQuestions, basicInfo }),
      });
      // STEP-GATE-COMPLETE: 402 はダイアログで吸収して早期 return。
      if (await handleQuotaResponse(res)) {
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        // data.detail（英語の実装詳細）は表示せず、error code を日本語文言にマップする。
        setError(aiErrorMessage(data.error));
        return;
      }
      const newQuestions: string[] = Array.isArray(data.questions) ? data.questions : [];
      if (newQuestions.length === 0) {
        setError('深掘り質問が生成できませんでした。時間をおいて再試行してください。');
        return;
      }
      saveAdditionalQuestionsCache({
        inputHash,
        model: ADDITIONAL_QUESTIONS_MODEL,
        promptVersion: ADDITIONAL_QUESTIONS_PROMPT_VERSION,
        savedAt: new Date().toISOString(),
        questions: newQuestions,
      });
      setUsage((prev) => additionalQuestionsLimit.incrementUsage(prev));
      applyResumedQuestions(selectedLog, newQuestions);
      router.push('/self-analysis/run');
    } catch {
      setError('通信エラーが発生しました。インターネット接続を確認してください。');
    } finally {
      setLoading(false);
    }
  }

  // 選択した log を working analyzeState に "戻す" 副作用。
  // log の content を canonical material として analyzeState に書き戻し、
  // 新規 2 問だけで answering ステップを開始する。「再深掘り」の語感どおり
  // 旧 displayedQuestions / answers / deepAnswers / freeMemo / summary は全て破棄。
  // analysis (WallHittingResult) は selectedLog から保持する。
  function applyResumedQuestions(log: SelfAnalysisLog, newQuestions: string[]): void {
    const len = newQuestions.length;
    saveAnalyzeState({
      step: 'answering',
      analysis: log.analysis,
      displayedQuestions: newQuestions,
      answers: new Array(len).fill(''),
      deepAnswers: new Array(len).fill(''),
      freeMemo: '',
      summary: null,
    });
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="mb-4">
        <Link
          href="/self-analysis"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
        >
          ← 自己分析機能一覧に戻る
        </Link>
      </div>

      <PageHeader
        title="過去の自己分析ログを選択"
        description="再度深掘りしたい自己分析ログを選んでください。"
      />

      {logs === null && <p className="text-sm text-slate-400">読み込み中...</p>}

      {logs !== null && logs.length === 0 && <EmptyState />}

      {logs !== null && logs.length > 0 && (
        <LogList
          logs={logs}
          selectedLogId={selectedLogId}
          onSelect={setSelectedLogId}
          usage={usage}
          loading={loading}
          error={error}
          onResume={handleResume}
        />
      )}

      {/* STEP-GATE-COMPLETE: 402 quota-exceeded ダイアログ。 */}
      {quotaDialog}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16">
      <p className="text-gray-400 text-base mb-3">
        再開できる自己分析ログがまだありません
      </p>
      <p className="text-gray-500 text-sm mb-8 leading-relaxed">
        ログを作るには、活動整理 → 深掘り → まとめ生成<br />
        を 1 度完了させてください。
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

function LogList({
  logs,
  selectedLogId,
  onSelect,
  usage,
  loading,
  error,
  onResume,
}: {
  logs: SelfAnalysisLog[];
  selectedLogId: string | null;
  onSelect: (id: string) => void;
  usage: DailyUsage;
  loading: boolean;
  error: string;
  onResume: () => void;
}) {
  const remaining = additionalQuestionsLimit.getRemainingCount(usage);
  const canUse = additionalQuestionsLimit.canUse(usage);
  const selectedLog = logs.find((l) => l.id === selectedLogId) ?? null;

  return (
    <section>
      <p className="text-[11px] font-bold text-blue-700 tracking-widest mb-3">
        保存されている自己分析ログ（{logs.length}件）
      </p>
      <ul className="space-y-3">
        {logs.map((log, idx) => (
          <li key={log.id}>
            <LogCard
              log={log}
              index={logs.length - idx}
              selected={log.id === selectedLogId}
              onSelect={() => onSelect(log.id)}
            />
          </li>
        ))}
      </ul>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mt-5">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={onResume}
          disabled={loading || !canUse || !selectedLog}
          className="block w-full text-center bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-lg text-sm transition-colors"
        >
          {loading
            ? '深掘り質問を生成中...'
            : !canUse
              ? '本日の深掘り回数に達しました'
              : !selectedLog
                ? 'ログを選択してください'
                : 'このログで再度深掘りする →'}
        </button>
        <p className="text-xs text-slate-400 text-right mt-2">
          本日あと{remaining}回 深掘り可
        </p>
      </div>

      <div className="mt-6 text-center">
        <Link
          href="/self-analysis/result/current"
          className="inline-block text-xs text-slate-500 hover:text-slate-700 underline-offset-2 hover:underline"
        >
          まず結果を詳しく見る →
        </Link>
      </div>
    </section>
  );
}

function LogCard({
  log,
  index,
  selected,
  onSelect,
}: {
  log: SelfAnalysisLog;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const activitySummary = log.summary.activitySummary.trim();
  const previousQuestionsCount = log.displayedQuestions.length;

  return (
    <Card
      variant="default"
      padding="md"
      className={selected ? 'ring-2 ring-blue-500' : ''}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="block w-full text-left"
      >
        <div className="flex items-center gap-3 mb-3">
          <RadioMark selected={selected} />
          <h2 className="text-base font-bold text-slate-800 flex-1 min-w-0 truncate">
            自己分析ログ #{index}
          </h2>
          {selected && (
            <span className="shrink-0 text-[10px] font-bold tracking-wider text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
              選択中
            </span>
          )}
        </div>

        <p className="text-xs text-slate-400 mb-3">
          {formatLogDate(log.updatedAt)} 更新
          {log.createdAt !== log.updatedAt && (
            <span> · 作成 {formatLogDate(log.createdAt)}</span>
          )}
        </p>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
          <p className="text-[11px] font-bold text-slate-500 mb-1">活動まとめ</p>
          <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
            {activitySummary === ''
              ? '（要約は保存されていません）'
              : previewText(activitySummary, 120)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatusItem
            label="前回の深掘り質問"
            value={previousQuestionsCount > 0 ? `${previousQuestionsCount}問` : 'なし'}
          />
          <StatusItem label="活動整理結果" value="あり" />
        </div>
      </button>
    </Card>
  );
}

function RadioMark({ selected }: { selected: boolean }) {
  if (selected) {
    return (
      <span
        aria-hidden="true"
        className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600"
      >
        <span className="w-2 h-2 rounded-full bg-white" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="shrink-0 inline-block w-5 h-5 rounded-full border-2 border-slate-300 bg-white"
    />
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm font-semibold truncate text-slate-800">{value}</p>
    </div>
  );
}

function previewText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function formatLogDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${h}:${min}`;
}
