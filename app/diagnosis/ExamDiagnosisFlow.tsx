'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  saveDiagnosisResult,
  loadDiagnosisResult,
  type DiagnosisResult,
} from '@/lib/diagnosisStorage';
import { isExamType, type ExamType, type ExamQuestion } from '@/types/examDiagnosis';
import { EXAM_QUESTIONS } from '@/lib/examDiagnosis/questions';
import { getExamResult } from '@/lib/examDiagnosis/results';
import { calculateExamDiagnosisResult } from '@/lib/examDiagnosis/scoring';
import { useCurrentUserId } from '@/app/components/AuthProvider';
import { ExamResultView } from './ExamResultView';

// ── 受験タイプ診断（9タイプ・15問）フロー ────────────────────────────
// legacy 4タイプフロー（page.tsx:LegacyDiagnosisFlow）と同じ画面遷移パターン
// （'start' | 'answering' | 'result' + useSyncExternalStore マウント flag）を踏襲。
//
// Option B 維持: 保存するのは answers（15問の option index）+ resultType（ExamType 文字列）+
//   表示用 title/description のみ。scoreVector / secondaryType は保存せず、結果表示時に
//   calculateExamDiagnosisResult(answers) で都度再計算する。
//
// 保存先 key は legacy と共有（passai_diagnosis_result）。読み戻し時に
//   `typeof resultType === 'string'` のときだけ 9タイプ結果として復元する
//   （legacy の数値 resultType は別 UI のものなので復元しない）。

type Step = 'start' | 'answering' | 'result';

const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// 保存済み DiagnosisResult が 9タイプ（ExamType 文字列）の有効な結果か。
function isExamResult(r: DiagnosisResult | null): r is DiagnosisResult {
  return (
    !!r &&
    isExamType(r.resultType) &&
    Array.isArray(r.answers) &&
    r.answers.length === EXAM_QUESTIONS.length
  );
}

export function ExamDiagnosisFlow() {
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const currentUserId = useCurrentUserId();

  const [postMountStep, setStep] = useState<Step | null>(null);
  const [postMountResult, setResult] = useState<DiagnosisResult | null>(null);

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  const mountedSaved = useMemo<DiagnosisResult | null>(() => {
    if (!isMounted) return null;
    const saved = loadDiagnosisResult();
    return isExamResult(saved) ? saved : null;
  }, [isMounted]);

  const step: Step = postMountStep ?? (mountedSaved ? 'result' : 'start');
  const result: DiagnosisResult | null = postMountResult ?? mountedSaved;

  function startDiagnosis() {
    setAnswers([]);
    setCurrentQ(0);
    setStep('answering');
  }

  function selectOption(optionIdx: number) {
    const next = [...answers, optionIdx];
    setAnswers(next);
    if (currentQ + 1 < EXAM_QUESTIONS.length) {
      setCurrentQ(currentQ + 1);
      return;
    }
    // 15問目を回答 → 判定（再計算）+ 保存（answers + resultType のみ）+ 結果画面へ。
    const { primaryType } = calculateExamDiagnosisResult(next);
    const content = getExamResult(primaryType);
    const r: DiagnosisResult = {
      resultType: primaryType,
      resultTitle: content.name,
      resultDescription: content.description,
      answers: next,
      createdAt: new Date().toISOString(),
    };
    saveDiagnosisResult(r);

    // auth-scoped durable（diagnosis_logs）へ best-effort dualWrite（fire-and-forget）。
    // legacy と同経路。payload は number/string 両対応済み。
    if (currentUserId) {
      const userId = currentUserId;
      void import('@/lib/repository/diagnosisRepository')
        .then((mod) => mod.dualWriteDiagnosisLog({ userId, diagnosis: r }))
        .catch(() => {});
    }

    setResult(r);
    setStep('result');
  }

  function goBackOneQuestion() {
    if (currentQ === 0) return;
    setCurrentQ((q) => q - 1);
    setAnswers((a) => a.slice(0, -1));
  }

  function restart() {
    setAnswers([]);
    setCurrentQ(0);
    setStep('start');
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-12 sm:py-16">
        {step === 'start' && <StartScreen onStart={startDiagnosis} />}
        {step === 'answering' && (
          <AnsweringScreen
            questionIdx={currentQ}
            total={EXAM_QUESTIONS.length}
            question={EXAM_QUESTIONS[currentQ]}
            onSelect={selectOption}
            onBack={goBackOneQuestion}
          />
        )}
        {step === 'result' && result && isExamType(result.resultType) && (
          <ResultStep answers={result.answers} primaryType={result.resultType} onRestart={restart} />
        )}
      </div>
    </div>
  );
}

// ── 1. 開始画面 ───────────────────────────────────────────────
function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="text-center">
      <p className="inline-block text-xs font-bold text-indigo-700 bg-white ring-1 ring-indigo-200 rounded-full px-4 py-1 mb-6 shadow-sm">
        所要時間 1分・登録不要
      </p>
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-snug mb-4 text-slate-900">
        15問でわかる、
        <br className="sm:hidden" />
        あなたの受験タイプ診断
      </h1>
      <p className="text-sm sm:text-base text-slate-700 leading-relaxed mb-10">
        いくつかの質問に答えるだけで、
        <br className="sm:hidden" />
        あなたの強み・戦略・向いている大学の傾向が見えてきます。
      </p>
      <button
        type="button"
        onClick={onStart}
        className="inline-flex justify-center items-center w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base sm:text-lg px-10 py-4 sm:py-5 rounded-3xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200"
      >
        診断を始める
        <span aria-hidden="true" className="ml-2">→</span>
      </button>
      <p className="mt-6 text-xs text-slate-500">全{EXAM_QUESTIONS.length}問・選択式</p>
    </div>
  );
}

// ── 2. 回答画面 ───────────────────────────────────────────────
function AnsweringScreen({
  questionIdx,
  total,
  question,
  onSelect,
  onBack,
}: {
  questionIdx: number;
  total: number;
  question: ExamQuestion;
  onSelect: (optionIdx: number) => void;
  onBack: () => void;
}) {
  const progressPct = ((questionIdx + 1) / total) * 100;
  return (
    <div>
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
          <span className="text-blue-700">{questionIdx + 1} / {total}</span>
          <span>残り {total - questionIdx - 1} 問</span>
        </div>
        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-6 sm:p-8 mb-6">
        <p className="text-xs font-bold text-blue-600 mb-2">Q{questionIdx + 1}</p>
        <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-relaxed mb-6">
          {question.text}
        </h2>
        <div className="space-y-3">
          {question.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              className="w-full text-left bg-white hover:bg-blue-50 hover:border-blue-400 border border-slate-300 rounded-xl px-5 py-4 text-sm sm:text-base text-slate-800 leading-relaxed transition-colors"
            >
              {opt.text}
            </button>
          ))}
        </div>
      </div>

      {questionIdx > 0 && (
        <div className="text-center">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            ← 前の質問に戻る
          </button>
        </div>
      )}
    </div>
  );
}

// ── 3. 結果画面 ───────────────────────────────────────────────
// secondaryType は answers から再計算する（Option B: 保存しない）。
function ResultStep({
  answers,
  primaryType,
  onRestart,
}: {
  answers: number[];
  primaryType: ExamType;
  onRestart: () => void;
}) {
  const { secondaryType } = useMemo(
    () => calculateExamDiagnosisResult(answers),
    [answers],
  );
  const result = getExamResult(primaryType);
  const secondary = secondaryType ? getExamResult(secondaryType) : null;

  return <ExamResultView result={result} secondary={secondary} onRestart={onRestart} />;
}
