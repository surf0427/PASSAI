'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ActivityData } from '@/types/activity';
import type { SummaryResult, WallHittingResult, AnalyzeStep } from '@/types/analysis';
import type { BasicInfo } from '@/types/basicInfo';
import { useWallHitting } from '@/hooks/useWallHitting';
import { StepIndicator } from '@/app/analyze/components/StepIndicator';
import { QuestionsSection } from '@/app/analyze/components/QuestionsSection';
import { SummarySection } from '@/app/analyze/components/SummarySection';
import { additionalQuestionsLimit, type DailyUsage } from '@/lib/dailyLimit';
import { saveSelfPRDraft } from '@/lib/selfPRDraftStorage';
import { saveWallHittingResult } from '@/lib/wallHittingStorage';
import { saveAnalyzeState, loadAnalyzeState, clearAnalyzeState } from '@/lib/analyzeStorage';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import BasicInfoSummary from '@/components/shared/BasicInfoSummary';
import { AiInlineThinking, ImprovementList } from '@/components/shared/result';

// マウント前 false / マウント後 true を返す flag。
// loadBasicInfo() は localStorage 依存のため SSR では null を返したい。
// useSyncExternalStore の getServerSnapshot/getSnapshot で setState なしにこの semantics を表現する。
// （STEP9/10/14 と同形パターン）
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function SelfAnalysisPage() {
  const router = useRouter();
  const [step, setStep] = useState<AnalyzeStep>(() => {
    const savedState = loadAnalyzeState();
    if (!savedState) return 'confirm';

    // summaryステップなのにsummaryデータがない → 不整合なのでconfirmに戻す
    if (savedState.step === 'summary' && !savedState.summary) {
      clearAnalyzeState();
      return 'confirm';
    }

    // answeringステップなのに質問データがない → 不整合なのでconfirmに戻す
    const hasDisplayedQuestions = savedState.displayedQuestions && savedState.displayedQuestions.length > 0;
    const hasFallbackQuestions = savedState.analysis?.questions && savedState.analysis.questions.length > 0;
    if (savedState.step === 'answering' && !hasDisplayedQuestions && !hasFallbackQuestions) {
      clearAnalyzeState();
      return 'confirm';
    }

    return savedState.step;
  });
  const [activityData] = useState<ActivityData | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = sessionStorage.getItem('activityData');
      return stored ? JSON.parse(stored) as ActivityData : null;
    } catch {
      return null;
    }
  });
  // SSRとCSRのHTML不一致（Hydration error）を防ぐためのフラグ。
  // localStorageから復元した値に依存するUIはこれが true になってから描画する。
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  // basicInfo は 3 つの自己分析API（analysis / analysis/additional / summarize）に同梱して、
  // AI が志望大学・学部・学科・受験方式・文理・学年を踏まえた分析を返せるようにする。
  // 共通関数 loadBasicInfo() 経由で取得し、null フォールバック対応済み。
  // マウント前は null、マウント後に loadBasicInfo() を 1度だけ呼んで以降は memo 値を返す。
  const basicInfo = useMemo<BasicInfo | null>(
    () => (isMounted ? loadBasicInfo() : null),
    [isMounted],
  );
  const [answers, setAnswers] = useState<string[]>(
    () => loadAnalyzeState()?.answers ?? [],
  );
  const [summary, setSummary] = useState<SummaryResult | null>(
    () => loadAnalyzeState()?.summary ?? null,
  );
  // hookの新規分析結果とは別に、localStorage から復元した分析結果を管理する
  const [restoredAnalysis, setRestoredAnalysis] = useState<WallHittingResult | null>(
    () => loadAnalyzeState()?.analysis ?? null,
  );
  // 表示中の質問（初期5問 + 「再び深掘る」で追加した分）
  const [displayedQuestions, setDisplayedQuestions] = useState<string[]>(() => {
    const savedState = loadAnalyzeState();
    // displayedQuestions が保存済みならそれを使う
    if (savedState?.displayedQuestions && savedState.displayedQuestions.length > 0) {
      return savedState.displayedQuestions;
    }
    // 旧データ互換: analysis.questions の最初5問にフォールバック
    if (savedState?.analysis?.questions) {
      return savedState.analysis.questions.slice(0, 5);
    }
    return [];
  });
  // 「再び深掘る」の1日あたり利用回数
  const [additionalUsage, setAdditionalUsage] = useState<DailyUsage>(
    () => additionalQuestionsLimit.loadUsage(),
  );
  const [summarizeLoading, setSummarizeLoading] = useState(false);
  const [summarizeError, setSummarizeError] = useState('');
  const [addQuestionsLoading, setAddQuestionsLoading] = useState(false);
  const [addQuestionsError, setAddQuestionsError] = useState('');

  // freshAnalysis: APIから取得した新規結果。analysis: 新規 or 復元のいずれか
  const { result: freshAnalysis, loading: analysisLoading, error: analysisError, run: runAnalysis } = useWallHitting(activityData, basicInfo);
  const analysis = freshAnalysis ?? restoredAnalysis;

  // 新規分析完了時のみステップ2へ遷移（復元時は answers をリセットしない）
  useEffect(() => {
    if (!freshAnalysis) return;
    saveWallHittingResult(freshAnalysis);
    setRestoredAnalysis(freshAnalysis);
    // 新規分析を開始するので、古いsummaryをクリアする
    setSummary(null);
    // 初期表示は最初の5問のみ。「再び深掘る」で2問ずつ追加していく
    const initialQuestions = freshAnalysis.questions.slice(0, 5);
    setDisplayedQuestions(initialQuestions);
    setAnswers(new Array(initialQuestions.length).fill(''));
    setStep('answering');
  }, [freshAnalysis]);

  // step / answers / analysis / summary / displayedQuestions が変わるたびに保存
  useEffect(() => {
    if (step === 'confirm') return; // confirm 中は保存しない
    saveAnalyzeState({ step, answers, analysis, summary, displayedQuestions });
  }, [step, answers, analysis, summary, displayedQuestions]);

  async function handleAnalyze() {
    if (loading) return;
    await runAnalysis();
  }

  // 「再び深掘る」ボタン: 2問追加生成して既存の質問に追記する
  async function handleAddMoreQuestions() {
    if (addQuestionsLoading || !activityData) return;
    setAddQuestionsLoading(true);
    setAddQuestionsError('');
    try {
      const res = await fetch('/api/analysis/additional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityData, existingQuestions: displayedQuestions, basicInfo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddQuestionsError(data.detail ?? '質問の追加に失敗しました');
        return;
      }
      const newQuestions: string[] = data.questions;
      setDisplayedQuestions((prev) => [...prev, ...newQuestions]);
      setAnswers((prev) => [...prev, ...new Array(newQuestions.length).fill('')]);
      setAdditionalUsage((prev) => additionalQuestionsLimit.incrementUsage(prev));
    } catch {
      setAddQuestionsError('エラーが発生しました。しばらくしてから再試行してください。');
    } finally {
      setAddQuestionsLoading(false);
    }
  }

  async function handleSummarize() {
    if (!analysis) return;
    if (!activityData) {
      setSummarizeError('活動データが見つかりません。活動整理ページで保存してから再度お試しください。');
      return;
    }
    setSummarizeLoading(true);
    setSummarizeError('');
    try {
      // displayedQuestions（実際に表示・回答した質問）を使ってまとめを生成する
      const analysisWithDisplayedQuestions = { ...analysis, questions: displayedQuestions };
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityData, analysis: analysisWithDisplayedQuestions, answers, basicInfo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSummarizeError(data.detail ?? 'まとめの生成に失敗しました');
        return;
      }
      setSummary(data.summary as SummaryResult);
      setStep('summary');
    } catch {
      setSummarizeError('エラーが発生しました。しばらくしてから再試行してください。');
    } finally {
      setSummarizeLoading(false);
    }
  }

  function handleGoToSelfPR() {
    if (!summary?.selfPRDraft?.trim()) return;
    saveSelfPRDraft(summary.selfPRDraft);
    router.push('/self-pr');
  }

  function updateAnswer(index: number, value: string) {
    const next = [...answers];
    next[index] = value;
    setAnswers(next);
    saveAnalyzeState({ step, answers: next, analysis, summary, displayedQuestions });
  }

  function handleBack() {
    setSummarizeError('');
    if (step === 'summary') { setStep('answering'); return; }
    if (step === 'answering') { setStep('confirm'); return; }
  }

  const error = analysisError || summarizeError || addQuestionsError;
  const loading = analysisLoading || summarizeLoading || addQuestionsLoading;

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="flex items-center gap-4 mb-8">
        {isMounted && step !== 'confirm' && (
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
          >
            ← 戻る
          </button>
        )}
        <h1 className="text-2xl font-bold text-gray-800">AI壁打ち・活動まとめ</h1>
      </div>
      {isMounted && <BasicInfoSummary basicInfo={basicInfo} />}
      {isMounted && step === 'confirm' && (
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          入力した活動をAIが分析します。その後、あなたに合った深掘り質問を出します。
          回答すると自己PRのたたき台が完成します。<span className="text-gray-400">（所要15〜20分）</span>
        </p>
      )}
      {isMounted && <StepIndicator current={step} />}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-red-700 text-sm font-semibold">エラーが発生しました</p>
          <p className="text-red-600 text-sm mt-1">{error}</p>
        </div>
      )}

      {/* ステップ1: 活動確認 */}
      {isMounted && step === 'confirm' && (
        <section>
          {!activityData ? (
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="font-bold text-gray-900">まだ活動データがありません</h2>
              <p className="mt-2 text-sm text-gray-600">
                先に活動整理を入力すると、AIが自己分析に使える材料を読み込めます。
              </p>
              <Link
                href="/activity"
                className="mt-4 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
              >
                活動整理を入力する
              </Link>
            </div>
          ) : (
            <div>
              <ActivityDataPreview activityData={activityData} />
              <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
                <p className="font-semibold mb-1">AIが分析すること</p>
                <ul className="list-disc list-inside space-y-1 text-blue-700">
                  <li>活動の要約（ストーリー化）</li>
                  <li>強み・弱み・補強ポイント</li>
                  <li>将来とのつながりの仮説</li>
                  <li>面接・志望理由書のための深掘り質問（5〜8問）</li>
                </ul>
              </div>
              <div className="mt-6 flex flex-wrap gap-3 items-start">
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors flex items-center gap-2"
                >
                  {loading ? (
                    <AiInlineThinking>AIが分析中...（30秒ほどかかります）</AiInlineThinking>
                  ) : (
                    'AIに分析させる'
                  )}
                </button>
                {displayedQuestions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep('answering')}
                    disabled={loading}
                    className="bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 font-semibold px-6 py-3 rounded-lg text-base transition-colors"
                  >
                    次に進む →
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ステップ2: AI分析結果 + 深掘り質問 */}
      {isMounted && step === 'answering' && analysis && (
        <section>
          <AnalysisResultCard analysis={analysis} />
          <div className="mt-8">
            <h2 className="text-base font-bold text-gray-800 mb-2">深掘り質問への回答</h2>
            <p className="text-sm text-gray-500 mb-5">
              分かる範囲で答えてください。短文・箇条書きでもOKです。
              回答が充実するほど、次のまとめの質が上がります。
            </p>
            <QuestionsSection
              questions={displayedQuestions}
              answers={answers}
              onChange={updateAnswer}
              onSubmit={handleSummarize}
              onReanalyze={handleAddMoreQuestions}
              loading={summarizeLoading || addQuestionsLoading}
              remainingCount={additionalQuestionsLimit.getRemainingCount(additionalUsage)}
            />
            {summary && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setStep('summary')}
                  disabled={summarizeLoading || addQuestionsLoading}
                  className="bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 font-semibold px-6 py-3 rounded-lg text-base transition-colors"
                >
                  次に進む →
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ステップ3: 活動まとめ */}
      {isMounted && step === 'summary' && summary && (
        <section>
          <div className="mb-5">
            <h2 className="text-base font-bold text-gray-800">活動まとめ</h2>
          </div>
          <SummarySection summary={summary} />
          <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded-xl">
            <p className="text-sm font-semibold text-gray-700 mb-3">次のステップ</p>
            <div className="space-y-3">
              {summary.selfPRDraft.trim() ? (
                <button
                  type="button"
                  onClick={handleGoToSelfPR}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg text-sm transition-colors"
                >
                  自己PR添削ページへ進む →
                </button>
              ) : (
                <p className="text-sm text-orange-600">
                  自己PRのたたき台が生成されていません。もう一度まとめを生成してください。
                </p>
              )}
              <Link
                href="/self-pr"
                className="block w-full text-center border border-blue-300 text-blue-600 hover:bg-blue-50 font-semibold px-6 py-3 rounded-lg text-sm transition-colors"
              >
                過去の自己PR添削一覧を見る →
              </Link>
            </div>
          </div>
        </section>
      )}

    </div>
  );
}

// ─── 小コンポーネント ─────────────────────────────────────────────────────────

// LoadingSpinner（ローカル定義）は components/shared/result/AiInlineThinking に
// 統合されたため削除済み。ボタン内ローディング表示は <AiInlineThinking> を使う。

function ActivityDataPreview({ activityData }: { activityData: ActivityData }) {
  const counts = [
    { label: '部活動', count: activityData.clubActivities.length },
    { label: 'ボランティア', count: activityData.volunteerActivities.length },
    { label: '留学', count: activityData.studyAbroadActivities.length },
    { label: '探究', count: activityData.researchActivities.length },
    { label: 'アルバイト', count: activityData.partTimeJobActivities.length },
    { label: '資格', count: activityData.certificationActivities.length },
    { label: 'コンテスト', count: activityData.contestActivities.length },
    { label: '読書', count: activityData.readingActivities.length },
    { label: '趣味', count: activityData.hobbyActivities.length },
  ].filter((c) => c.count > 0);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
      <h2 className="text-sm font-bold text-gray-600 mb-3">読み込んだ活動データ</h2>
      {counts.length === 0 ? (
        <p className="text-gray-400 text-sm">活動データが空です</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {counts.map((c) => (
            <span
              key={c.label}
              className="bg-white border border-gray-200 rounded-full px-3 py-1 text-sm text-gray-700"
            >
              {c.label} {c.count}件
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisResultCard({ analysis }: { analysis: WallHittingResult }) {
  return (
    <div className="space-y-4">
      {/* 要約 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-blue-800 mb-2">あなたの活動ストーリー</h3>
        <p className="text-sm text-blue-900 leading-relaxed">{analysis.summary}</p>
      </div>

      {/* 強み / 補強ポイントの 2 カラム
          外側の bg-green-50 / bg-orange-50 のカラーカード wrapper と h3 見出しは raw 維持。
          リスト本体だけを ImprovementList に置換する（色は variant 標準の green-700 /
          orange-700 になり、現行の green-900 / orange-900 から軽微にライト化する）。
          density="relaxed" で space-y-1.5 にし、現行 space-y-2 にできるだけ近づける。
          StrengthWeaknessGrid 自体は使えない：当該 grid は「per-column の card 無し・
          青/オレンジ・xs サイズ」で設計されており、ここで使うと per-column card と
          色（緑→青）が両方変わって視覚インパクトが大きいため。 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 強み */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-green-800 mb-3">強み</h3>
          <ImprovementList
            items={analysis.strengths}
            variant="success"
            density="relaxed"
          />
        </div>

        {/* 弱み・補強ポイント */}
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-orange-800 mb-3">補強ポイント</h3>
          <ImprovementList
            items={analysis.weaknesses}
            variant="warning"
            density="relaxed"
          />
        </div>
      </div>

      {/* 将来とのつながり */}
      <div className="bg-purple-50 border border-purple-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-purple-800 mb-3">将来とのつながり（仮説）</h3>
        <ul className="space-y-2">
          {analysis.futureConnections.map((f, i) => (
            <li key={i} className="flex gap-2 text-sm text-purple-900">
              <span className="text-purple-400 mt-0.5 shrink-0">→</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
