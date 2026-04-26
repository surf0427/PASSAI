'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ActivityData } from '@/types/activity';
import type { SummaryResult, WallHittingResult, AnalyzeStep } from '@/types/analysis';
import { useWallHitting } from '@/hooks/useWallHitting';
import { StepIndicator } from './components/StepIndicator';
import { QuestionsSection } from './components/QuestionsSection';
import { SummarySection } from './components/SummarySection';
import { deepDiveLimit, type DailyUsage } from '@/lib/dailyLimit';
import { saveSelfPRDraft } from '@/lib/selfPRDraftStorage';
import { saveWallHittingResult } from '@/lib/wallHittingStorage';
import { collectAndSaveMatchingInput } from '@/lib/admissionMatchingStorage';
import { saveAnalyzeState, loadAnalyzeState, clearAnalyzeState } from '@/lib/analyzeStorage';

export default function AnalyzePage() {
  const router = useRouter();
  const [step, setStep] = useState<AnalyzeStep>(
    () => loadAnalyzeState()?.step ?? 'confirm',
  );
  const [activityData, setActivityData] = useState<ActivityData | null>(null);
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
  const [summarizeLoading, setSummarizeLoading] = useState(false);
  const [summarizeError, setSummarizeError] = useState('');
  const [usage, setUsage] = useState<DailyUsage>({ date: '', count: 0 });

  // freshAnalysis: APIから取得した新規結果。analysis: 新規 or 復元のいずれか
  const { result: freshAnalysis, loading: analysisLoading, error: analysisError, run: runAnalysis, reset: resetAnalysis } = useWallHitting(activityData);
  const analysis = freshAnalysis ?? restoredAnalysis;

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('activityData');
      if (stored) setActivityData(JSON.parse(stored) as ActivityData);
    } catch (e) {
      console.error('analyze: failed to load activityData from sessionStorage', e);
    }
    setUsage(deepDiveLimit.loadUsage());
  }, []);

  // 新規分析完了時のみステップ2へ遷移（復元時は answers をリセットしない）
  useEffect(() => {
    if (!freshAnalysis) return;
    saveWallHittingResult(freshAnalysis);
    setRestoredAnalysis(freshAnalysis);
    setAnswers(new Array(freshAnalysis.questions.length).fill(''));
    setStep('answering');
  }, [freshAnalysis]);

  // step / answers / analysis / summary が変わるたびに保存
  useEffect(() => {
    if (step === 'confirm') return; // confirm 中は保存しない
    saveAnalyzeState({ step, answers, analysis, summary });
  }, [step, answers, analysis, summary]);

  async function handleAnalyze() {
    if (loading) return;
    await runAnalysis();
  }

  async function handleReanalyze() {
    if (loading) return;
    setUsage((prev) => deepDiveLimit.incrementUsage(prev));
    setRestoredAnalysis(null);
    clearAnalyzeState();
    resetAnalysis();
    setStep('confirm');
    // 50ms delay を除去: setStep('confirm') の直後に runAnalysis を呼んでも
    // loading guard があるため二重実行されない
    await runAnalysis();
  }

  async function handleSummarize() {
    if (!activityData || !analysis) return;
    setSummarizeLoading(true);
    setSummarizeError('');
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityData, analysis, answers }),
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
    router.push('/');
  }

  function updateAnswer(index: number, value: string) {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function handleBack() {
    setSummarizeError('');
    if (step === 'summary') { setStep('answering'); return; }
    if (step === 'answering') {
      setRestoredAnalysis(null);
      clearAnalyzeState();
      resetAnalysis();
      setStep('confirm');
    }
  }

  const error = analysisError || summarizeError;
  const loading = analysisLoading || summarizeLoading;

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="flex items-center gap-4 mb-8">
        {step !== 'confirm' && (
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
          >
            ← 戻る
          </button>
        )}
        <h1 className="text-2xl font-bold text-gray-800">AI壁打ち・活動まとめ</h1>
        <a
          href="/input/activity"
          className="ml-auto shrink-0 text-sm text-gray-400 hover:text-blue-600 underline underline-offset-2 transition-colors"
        >
          活動を追加・修正する
        </a>
      </div>
      {step === 'confirm' && (
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          入力した活動をAIが分析します。その後、あなたに合った深掘り質問を出します。
          回答すると自己PRのたたき台が完成します。<span className="text-gray-400">（所要15〜20分）</span>
        </p>
      )}
      <StepIndicator current={step} />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-red-700 text-sm font-semibold">エラーが発生しました</p>
          <p className="text-red-600 text-sm mt-1">{error}</p>
        </div>
      )}

      {/* ステップ1: 活動確認 */}
      {step === 'confirm' && (
        <section>
          {!activityData ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
              <p className="text-yellow-800 font-semibold mb-2">活動整理フォームの入力が必要です</p>
              <p className="text-yellow-700 text-sm mb-4">
                先に活動整理フォームで活動内容を入力・保存してください。
              </p>
              <a
                href="/input/activity"
                className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded-lg text-sm transition-colors"
              >
                活動整理フォームへ
              </a>
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
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={loading}
                className="mt-6 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <LoadingSpinner />
                    AIが分析中...（30秒ほどかかります）
                  </>
                ) : (
                  'AIに分析させる'
                )}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ステップ2: AI分析結果 + 深掘り質問 */}
      {step === 'answering' && analysis && (
        <section>
          <AnalysisResultCard analysis={analysis} />
          <div className="mt-8">
            <h2 className="text-base font-bold text-gray-800 mb-2">深掘り質問への回答</h2>
            <p className="text-sm text-gray-500 mb-5">
              分かる範囲で答えてください。短文・箇条書きでもOKです。
              回答が充実するほど、次のまとめの質が上がります。
            </p>
            <QuestionsSection
              questions={analysis.questions}
              answers={answers}
              onChange={updateAnswer}
              onSubmit={handleSummarize}
              onReanalyze={handleReanalyze}
              loading={summarizeLoading}
              remainingCount={deepDiveLimit.getRemainingCount(usage)}
            />
          </div>
        </section>
      )}

      {/* ステップ3: 活動まとめ */}
      {step === 'summary' && summary && (
        <section>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-bold text-gray-800">活動まとめ</h2>
            <button
              type="button"
              onClick={handleReanalyze}
              disabled={loading || !deepDiveLimit.canUse(usage)}
              className="flex items-center gap-1 text-sm bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed text-blue-700 font-semibold border border-blue-200 px-4 py-2 rounded-lg transition-colors"
            >
              {loading ? '分析中...' : `再び深掘る（残り${deepDiveLimit.getRemainingCount(usage)}回）`}
            </button>
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
              <button
                type="button"
                onClick={() => { collectAndSaveMatchingInput(); router.push('/matching'); }}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold px-6 py-3 rounded-lg text-sm transition-colors"
              >
                AI志望校マッチングへ進む →
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── 小コンポーネント ─────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 強み */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-green-800 mb-3">強み</h3>
          <ul className="space-y-2">
            {analysis.strengths.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-green-900">
                <span className="text-green-500 mt-0.5 shrink-0">✓</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 弱み・補強ポイント */}
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-orange-800 mb-3">補強ポイント</h3>
          <ul className="space-y-2">
            {analysis.weaknesses.map((w, i) => (
              <li key={i} className="flex gap-2 text-sm text-orange-900">
                <span className="text-orange-400 mt-0.5 shrink-0">△</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
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
