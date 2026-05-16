'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { ActivityData } from '@/types/activity';
import type { SummaryResult, WallHittingResult, AnalyzeStep } from '@/types/analysis';
import type { BasicInfo } from '@/types/basicInfo';
import { useWallHitting } from '@/hooks/useWallHitting';
import { StepIndicator } from '@/app/analyze/components/StepIndicator';
import { QuestionsSection } from '@/app/analyze/components/QuestionsSection';
import { SummarySection } from '@/app/analyze/components/SummarySection';
import { additionalQuestionsLimit, type DailyUsage } from '@/lib/dailyLimit';
import { saveWallHittingResult } from '@/lib/wallHittingStorage';
import { loadStudentProfile, saveStudentProfile } from '@/lib/studentProfileStorage';
import { toStudentProfile } from '@/lib/studentProfile';
import { saveAnalyzeState, loadAnalyzeState, clearAnalyzeState } from '@/lib/analyzeStorage';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { buildUniversityContextFromBasicInfo } from '@/lib/buildUniversityContext';
import {
  ADDITIONAL_QUESTIONS_MODEL,
  ADDITIONAL_QUESTIONS_PROMPT_VERSION,
  hashAdditionalQuestionsInput,
  SUMMARIZE_MODEL,
  SUMMARIZE_PROMPT_VERSION,
  hashSummarizeInput,
} from '@/lib/aiInputHash';
import {
  loadAdditionalQuestionsCache,
  saveAdditionalQuestionsCache,
} from '@/lib/additionalQuestionsCache';
import { loadSummarizeCache, saveSummarizeCache } from '@/lib/summarizeCache';
import { FREE_MEMO_MAX_CHARS, normalizeDeepAnswers, normalizeFreeMemo } from '@/lib/summarizeNormalize';
import { decideSummarizeMode } from '@/lib/summarizeMode';
import { logAiCache } from '@/lib/aiCacheLog';
import BasicInfoSummary from '@/components/shared/BasicInfoSummary';
import { UsageNote } from '@/components/shared/UsageNote';
import { AiInlineThinking, ImprovementList } from '@/components/shared/result';

// マウント前 false / マウント後 true を返す flag。
// loadBasicInfo() は localStorage 依存のため SSR では null を返したい。
// useSyncExternalStore の getServerSnapshot/getSnapshot で setState なしにこの semantics を表現する。
// （STEP9/10/14 と同形パターン）
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// 深掘り修正後の SummaryResult を、既存 StudentProfile に partial-patch で反映する。
// 設計意図:
//   /api/summarize は activitySummary / strengths / appealPoints のみ返す（types/analysis.ts SummaryResult）。
//   そのうち StudentProfile と意味が重なる summary / strengths だけを差し替え、
//   weaknesses / futureConnections / signatureEpisodes / valueKeywords は既存値を保持する。
//   この partial 戦略により、深掘り修正で再生成された summary が下流（self-pr 等）に伝播するが、
//   WallHittingResult 由来の固有素材は壊れない。
//   既存 profile が無いケース（旧データ / 初回フロー）は何もしない（新規分析時の
//   saveStudentProfile(toStudentProfile(...)) に任せる）。
function patchStudentProfileFromSummary(summary: SummaryResult, inputHash: string): void {
  const existing = loadStudentProfile();
  if (!existing) return;

  const nextSummary = summary.activitySummary.trim();
  const nextStrengths = splitSummaryStrengths(summary.strengths);

  saveStudentProfile({
    ...existing,
    summary: nextSummary || existing.summary,
    strengths: nextStrengths.length > 0 ? nextStrengths : existing.strengths,
    generatedAt: new Date().toISOString(),
    // sourceHash を summarize 入力 hash に揃えることで saveStudentProfile 内の
    // dedup guard (shouldUpdateStudentProfile) が「同じ summary 入力なら再保存しない」として働く。
    sourceHash: `summarize:${inputHash}`,
  });
}

// SummaryResult.strengths は単一 string（複数行・箇条書きの可能性あり）。
// StudentProfile.strengths は string[] のため、行＋箇条書き接頭辞で deterministic に分割する。
// 単一行のときは 1 要素配列として返す（空文字なら空配列）。
function splitSummaryStrengths(raw: string): string[] {
  if (typeof raw !== 'string') return [];
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/^[\s　]*([-*・]|\d+[.)）])[\s　]*/, '').trim())
    .filter((line) => line.length > 0);
  if (lines.length > 0) return lines;
  const single = raw.trim();
  return single ? [single] : [];
}

export default function SelfAnalysisPage() {
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
  // hook の新規分析結果が無いマウント直後だけ参照する、localStorage 由来の復元値。
  // 一度マウントしたら更新しない（STEP5.5）。`analysis = freshAnalysis ?? restoredAnalysis`
  // で freshAnalysis 優先のため、fetch / cache-hit で hook が result を持った瞬間から
  // restoredAnalysis は表示・保存の経路から外れる。analyzeState への保存は
  // `analysis` 経由で freshAnalysis を直接拾うので、ここを書き換える必要は無い。
  // 結果：useEffect 内での mirror（setRestoredAnalysis(freshAnalysis)）が不要になり、
  //       react-hooks/set-state-in-effect 違反を解消する。
  const [restoredAnalysis] = useState<WallHittingResult | null>(
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
  // 各質問の「もう少し詳しく整理する」accordion の textarea 値。
  // displayedQuestions と index 一対一対応で長さを一致させる不変条件を全経路で守る:
  //   1. localStorage 復元: 足りなければ空文字で埋め、多ければ切る
  //   2. 新規分析完了: displayedQuestions の長さで '' 埋め
  //   3. 「再び深掘る」: append される質問数だけ '' を append
  // 旧保存データ（deepAnswers キーを持たない JSON）は undefined → 空配列に倒れて互換維持。
  const [deepAnswers, setDeepAnswers] = useState<string[]>(() => {
    const savedState = loadAnalyzeState();
    const targetLength = (() => {
      if (savedState?.displayedQuestions && savedState.displayedQuestions.length > 0) {
        return savedState.displayedQuestions.length;
      }
      if (savedState?.analysis?.questions) {
        return Math.min(savedState.analysis.questions.length, 5);
      }
      return 0;
    })();
    return normalizeDeepAnswers(savedState?.deepAnswers, targetLength);
  });
  // 任意の自由メモ（全体単位）。質問では拾いきれない気づき・違和感を書く欄。
  // 復元時は文字列なら採用、それ以外は ''。length 上限 (FREE_MEMO_MAX_CHARS) はUIの maxLength でも
  // 強制するが、handleSummarize 直前に normalizeFreeMemo を必ず通すため、
  // 万一上限超過があっても hash と AI 入力は一致する。
  const [freeMemo, setFreeMemo] = useState<string>(() => {
    const savedMemo = loadAnalyzeState()?.freeMemo;
    return typeof savedMemo === 'string' ? savedMemo : '';
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
    // StudentProfile を canonical storage として保存（PASSAI 全体の共通プロフィール）。
    // WallHittingResult の保存と並行で行い、後方互換のため wallHittingResult key も残す。
    // sourceHash 一致時は内部で再保存スキップされる。
    saveStudentProfile(toStudentProfile(freshAnalysis));
    // STEP5.5: 以下 4 件の setState は useWallHitting hook（外部 async システム）の
    // 完了通知 `freshAnalysis` に対する「新規分析セッションへの状態遷移」で、
    // freshAnalysis から派生計算では表現できない app 状態（user が以降 mutate する
    // questions/answers/step/summary）の初期化。
    //   - setSummary(null): 前セッションの summary を破棄
    //   - setDisplayedQuestions: hook 返却 questions の先頭5問で初期化（以降は user の
    //     「再び深掘る」で append される mutable state）
    //   - setAnswers: その5問に対応する空回答で初期化（以降は user 入力で mutate）
    //   - setStep('answering'): 回答フェーズへ進める（user は handleBack で戻せる）
    // handleAnalyze / handleAddMoreQuestions のロジックを変えない / hook を抽出しない
    // 制約下では、await 後の関数本体で記述する選択肢が取れないため、
    // genuine side-effect として本 effect でのみ rule を無効化する。
    /* eslint-disable react-hooks/set-state-in-effect */
    setSummary(null);
    const initialQuestions = freshAnalysis.questions.slice(0, 5);
    setDisplayedQuestions(initialQuestions);
    setAnswers(new Array(initialQuestions.length).fill(''));
    // deepAnswers も index 一対一対応のため同じ長さで空文字初期化する。
    setDeepAnswers(new Array(initialQuestions.length).fill(''));
    setStep('answering');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [freshAnalysis]);

  // step / answers / analysis / summary / displayedQuestions / deepAnswers / freeMemo が変わるたびに保存
  useEffect(() => {
    if (step === 'confirm') return; // confirm 中は保存しない
    saveAnalyzeState({ step, answers, analysis, summary, displayedQuestions, deepAnswers, freeMemo });
  }, [step, answers, analysis, summary, displayedQuestions, deepAnswers, freeMemo]);

  async function handleAnalyze() {
    if (loading) return;
    await runAnalysis();
  }

  // 「再び深掘る」ボタン: 2問追加生成して既存の質問に追記する
  async function handleAddMoreQuestions() {
    if (addQuestionsLoading || !activityData) return;

    // STEP5.4: input hash cache を先に判定する。
    // 同入力なら AI を呼ばずに保存済み questions を append する。
    // universityContext は server route と同じ buildUniversityContextFromBasicInfo() で派生させる。
    // answers / StudentProfile / wallHittingResult / daily limit state は AI 入力ではないので hash に含めない。
    const universityContext = buildUniversityContextFromBasicInfo(basicInfo);
    const inputHash = hashAdditionalQuestionsInput({
      activityData,
      basicInfo,
      universityContext,
      existingQuestions: displayedQuestions,
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
      // cache hit: AI を呼ばずに即復元。loading は立てない（spinner flash を避ける）。
      // daily limit は消費しない（AI call が起きていないため）。
      logAiCache({ route: 'api/analysis/additional', action: 'hit', inputHash });
      setAddQuestionsError('');
      setDisplayedQuestions((prev) => [...prev, ...cached.questions]);
      setAnswers((prev) => [...prev, ...new Array(cached.questions.length).fill('')]);
      // deepAnswers も index alignment 維持のため同じ数だけ append する。
      setDeepAnswers((prev) => [...prev, ...new Array(cached.questions.length).fill('')]);
      return;
    }
    logAiCache({ route: 'api/analysis/additional', action: 'miss', inputHash });

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
      // deepAnswers も index alignment 維持のため同じ数だけ append する。
      setDeepAnswers((prev) => [...prev, ...new Array(newQuestions.length).fill('')]);
      setAdditionalUsage((prev) => additionalQuestionsLimit.incrementUsage(prev));
      // STEP5.4: 成功時のみ cache 書き込み。miss + error / network 失敗パスでは保存しない
      // （daily limit と同じく "AI が成功して response が返った" を保存条件にする）。
      saveAdditionalQuestionsCache({
        inputHash,
        model: ADDITIONAL_QUESTIONS_MODEL,
        promptVersion: ADDITIONAL_QUESTIONS_PROMPT_VERSION,
        savedAt: new Date().toISOString(),
        questions: newQuestions,
      });
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

    // displayedQuestions（実際に表示・回答した質問）を使ってまとめを生成する
    const analysisWithDisplayedQuestions = { ...analysis, questions: displayedQuestions };

    // server (app/api/summarize/route.ts) と同じ helper で正規化する。
    // 同じ正規化結果を hash と request body の両方に渡すことで、cache key と AI 入力のズレを防ぐ。
    const normalizedDeepAnswers = normalizeDeepAnswers(deepAnswers, answers.length);
    // 自由メモも同じ helper で trim + truncate。server 側も同じ helper を経由するため
    // 「ユーザーが上限超過まで書いた」「末尾空白を入れた」ケースでも hash が一致する。
    const normalizedFreeMemo = normalizeFreeMemo(freeMemo);

    // light / deep mode は永続化せず、answers と deepAnswers から都度算出する。
    // 同じ値を hash と body の双方に渡すことで、server 側 fallback とも一致させる。
    const mode = decideSummarizeMode(answers, normalizedDeepAnswers);

    // STEP5.8: input hash cache を先に判定する。
    // 同入力なら AI を呼ばずに保存済み SummaryResult を復元する。
    // universityContext は server route と同じ buildUniversityContextFromBasicInfo() で派生させる。
    // analysis 引数は既に displayedQuestions に差し替え済み → questions は二重カウントしない。
    // 出力 hash (StudentProfile.sourceHash) とは別レーン。daily limit は /api/summarize に無し。
    // PROMPT_VERSION v2: deepAnswers セクション追加に伴い既存 cache とは別レーン化（aiInputHash.ts 参照）
    // PROMPT_VERSION v3: system prompt を light / deep の二系統に分岐
    // PROMPT_VERSION v4: freeMemo セクション + FREE_MEMO_INSTRUCTION 追加
    const summarizeUniversityContext = buildUniversityContextFromBasicInfo(basicInfo);
    const inputHash = hashSummarizeInput({
      activityData,
      basicInfo,
      universityContext: summarizeUniversityContext,
      analysis: analysisWithDisplayedQuestions,
      answers,
      deepAnswers: normalizedDeepAnswers,
      mode,
      freeMemo: normalizedFreeMemo,
      model: SUMMARIZE_MODEL,
      promptVersion: SUMMARIZE_PROMPT_VERSION,
    });

    const cached = loadSummarizeCache();
    if (
      cached &&
      cached.inputHash === inputHash &&
      cached.model === SUMMARIZE_MODEL &&
      cached.promptVersion === SUMMARIZE_PROMPT_VERSION
    ) {
      // cache hit: AI を呼ばずに即復元。loading は立てない（spinner flash を避ける）。
      logAiCache({ route: 'api/summarize', action: 'hit', inputHash });
      setSummarizeError('');
      setSummary(cached.summary);
      setStep('summary');
      // 深掘り修正の summary を canonical StudentProfile にも反映する（cache hit 経路でも忘れずに）。
      patchStudentProfileFromSummary(cached.summary, inputHash);
      return;
    }
    logAiCache({ route: 'api/summarize', action: 'miss', inputHash });

    setSummarizeLoading(true);
    setSummarizeError('');
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // deepAnswers / mode / freeMemo は client / server で同じ helper 経由で派生 → cache key と AI 入力が一致する
        body: JSON.stringify({
          activityData,
          analysis: analysisWithDisplayedQuestions,
          answers,
          deepAnswers: normalizedDeepAnswers,
          mode,
          freeMemo: normalizedFreeMemo,
          basicInfo,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSummarizeError(data.detail ?? 'まとめの生成に失敗しました');
        return;
      }
      const summaryResult = data.summary as SummaryResult;
      setSummary(summaryResult);
      setStep('summary');
      // STEP5.8: 成功時のみ cache 書き込み（miss + error / network 失敗時は保存しない）。
      saveSummarizeCache({
        inputHash,
        model: SUMMARIZE_MODEL,
        promptVersion: SUMMARIZE_PROMPT_VERSION,
        savedAt: new Date().toISOString(),
        summary: summaryResult,
      });
      // 深掘り修正で再生成された summary を canonical StudentProfile にも partial-patch で反映する。
      // これがないと self-pr 等の下流が旧 strengths / summary を読み続ける。
      patchStudentProfileFromSummary(summaryResult, inputHash);
    } catch {
      setSummarizeError('エラーが発生しました。しばらくしてから再試行してください。');
    } finally {
      setSummarizeLoading(false);
    }
  }

  function updateAnswer(index: number, value: string) {
    const next = [...answers];
    next[index] = value;
    setAnswers(next);
    saveAnalyzeState({ step, answers: next, analysis, summary, displayedQuestions, deepAnswers, freeMemo });
  }

  function updateDeepAnswer(index: number, value: string) {
    const next = [...deepAnswers];
    // displayedQuestions と長さズレがある場合に備え index 範囲を超える書き込みは丸める。
    if (index < 0 || index >= displayedQuestions.length) return;
    while (next.length < displayedQuestions.length) next.push('');
    next[index] = value;
    setDeepAnswers(next);
    saveAnalyzeState({ step, answers, analysis, summary, displayedQuestions, deepAnswers: next, freeMemo });
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
            <div className="mb-5">
              <UsageNote usages={['面接', '志望理由書']} />
            </div>
            <QuestionsSection
              questions={displayedQuestions}
              answers={answers}
              deepAnswers={deepAnswers}
              onChange={updateAnswer}
              onDeepChange={updateDeepAnswer}
              onSubmit={handleSummarize}
              onReanalyze={handleAddMoreQuestions}
              loading={summarizeLoading || addQuestionsLoading}
              remainingCount={additionalQuestionsLimit.getRemainingCount(additionalUsage)}
            />
            {/* 自由メモ：質問では拾いきれない気づき・違和感を任意で書く欄。
                配置は「QuestionsSection の下」。submit ボタン (「活動まとめを生成する」) は
                QuestionsSection 内部にあるため、視覚的にはボタンの後に来る。
                state は親で保持しているため、ボタン押下時には反映される。
                /api/summarize のみが読む。StudentProfile / Context Builder には流さない。*/}
            <div className="mt-6 bg-gray-50 border border-gray-200 rounded-xl p-5">
              <label htmlFor="freeMemo" className="block text-sm font-semibold text-gray-800 mb-1">
                自由メモ（任意）
              </label>
              <p className="text-xs text-gray-500 mb-3">
                質問では拾いきれなかった気づき・モヤモヤ・違和感があれば自由に書いてください。
              </p>
              <textarea
                id="freeMemo"
                value={freeMemo}
                onChange={(e) => setFreeMemo(e.target.value)}
                maxLength={FREE_MEMO_MAX_CHARS}
                rows={3}
                className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm leading-relaxed bg-white text-slate-900 placeholder:text-slate-400 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-400 dark:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                placeholder="例：◯◯のとき、自分でも意外なほどモヤッとした"
              />
              <p className="mt-1 text-xs text-gray-400 text-right">
                {freeMemo.length} / {FREE_MEMO_MAX_CHARS}
              </p>
            </div>
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
              <Link
                href="/self-pr"
                className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg text-sm transition-colors"
              >
                自己PR添削ページへ進む →
              </Link>
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
