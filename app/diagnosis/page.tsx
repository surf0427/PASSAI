'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  saveDiagnosisResult,
  loadDiagnosisResult,
  type DiagnosisResult,
} from '@/lib/diagnosisStorage';
import type { DiagnosisType } from '@/types/diagnosis';
import {
  DIAGNOSIS_QUESTIONS,
  calcDiagnosisResultType,
  type DiagnosisQuestion,
} from '@/lib/diagnosisScoring';
import { useCurrentUserId } from '@/app/components/AuthProvider';
import { isExamDiagnosisEnabled } from '@/lib/examDiagnosis/flag';
import { ExamDiagnosisFlow } from './ExamDiagnosisFlow';

// マウント前 false / マウント後 true を返す flag。
// loadDiagnosisResult() は localStorage 依存のため SSR では null を返したい。
// useSyncExternalStore の getServerSnapshot/getSnapshot で setState なしにこの semantics を表現する。
// （STEP9/10/14/15/16 と同形パターン）
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// ── 受験タイプ診断（MVP） ──────────────────────────────────────
// 単一ファイル + クライアントコンポーネントで完結。
// step 状態（'start' | 'answering' | 'result'）で 3 画面を切り替える。
// 質問データ（DIAGNOSIS_QUESTIONS）と判定ロジック（calcDiagnosisResultType）は
// テスト可能な純モジュール @/lib/diagnosisScoring に切り出した（Phase 1）。
// このファイルは結果説明文（RESULT_TYPES）と画面遷移のみを持つ。

type Step = 'start' | 'answering' | 'result';

// ── 結果タイプの説明文 ────────────────────────────────────────
const RESULT_TYPES: Record<
  DiagnosisType,
  { title: string; description: string }
> = {
  1: {
    title: '何から始めるか整理タイプ',
    description:
      'まずは活動整理と自己分析から始めるのがおすすめです。\n今は実績がないのではなく、経験をどう言葉にするかが見えていない状態です。',
  },
  2: {
    title: '経験言語化タイプ',
    description:
      '活動や経験はあるので、それを志望理由書や面接で伝わる形に整理するのがおすすめです。',
  },
  3: {
    title: '書類完成度アップタイプ',
    description:
      'すでに書き始めている人は、具体性・大学との一致・面接で話せる深さを高めることが重要です。',
  },
  4: {
    title: '一般受験並行タイプ',
    description:
      '限られた時間で進めるために、活動整理・自己分析・志望理由書を効率よくつなげて進めるのがおすすめです。',
  },
};

// ── ページ本体（flag で legacy 4タイプ / 新 9タイプ を切替）──────────
// NEXT_PUBLIC_EXAM_DIAGNOSIS_ENABLED が ON → 9タイプ版（ExamDiagnosisFlow）。
// 既定（未設定 / OFF）→ legacy 4タイプ版（LegacyDiagnosisFlow）。legacy は削除しない。
// flag は build-time inline 定数なので SSR/CSR で同値 → hydration mismatch は起きない。

export default function DiagnosisPage() {
  if (isExamDiagnosisEnabled()) return <ExamDiagnosisFlow />;
  return <LegacyDiagnosisFlow />;
}

// ── legacy 4タイプ診断フロー（凍結併存。一切変更しない）──────────────
function LegacyDiagnosisFlow() {
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);

  // STEP-TUTOR-CONTEXT-PHASE2-REPOSITORY-01: 診断結果 dualWrite に使う owner key。
  // null（auth 未確定 / LP 段階で匿名 auth 未完了）なら dualWrite は呼ばず、
  // AuthProvider の backfill が後で拾う。
  const currentUserId = useCurrentUserId();

  // step / result は (1) 再訪時にマウント snapshot として loadDiagnosisResult() から復元され、
  // (2) フロー中（startDiagnosis / 5 問完了 / restart）に setState で更新される。
  // useEffect 内で setState すると react-hooks/set-state-in-effect になるため、
  // post-mount の override 値だけを useState で持ち、マウント時の snapshot は useMemo で結合する。
  // 既存の setStep / setResult 呼び出し側はそのまま動くよう setter 名は維持する。
  const [postMountStep, setStep] = useState<Step | null>(null);
  const [postMountResult, setResult] = useState<DiagnosisResult | null>(null);

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  // 復元ガード（STEP-DIAGNOSIS-MIGRATION 回帰対策）: legacy（数値 resultType）の結果だけ復元する。
  // flag を 9タイプ→legacy に戻した後、共有 LS キーに残った 9タイプ（文字列 resultType・15問）の
  // 値を legacy UI が誤って結果画面へ流し込み、数値バッジに文字列が出る崩れを防ぐ。
  // legacy の不変条件（legacy UI は legacy 結果のみ表示）を復元するだけで、判定ロジックは不変。
  const mountedSaved = useMemo<DiagnosisResult | null>(() => {
    if (!isMounted) return null;
    const saved = loadDiagnosisResult();
    return saved && typeof saved.resultType === 'number' ? saved : null;
  }, [isMounted]);

  // 公開する step / result: post-mount 値があればそれを、なければ snapshot ベースの初期値。
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
    if (currentQ + 1 < DIAGNOSIS_QUESTIONS.length) {
      setCurrentQ(currentQ + 1);
      return;
    }
    // 5 問目を回答 → 集計 + 保存 + 結果画面へ
    const t = calcDiagnosisResultType(next);
    const r: DiagnosisResult = {
      resultType: t,
      resultTitle: RESULT_TYPES[t].title,
      resultDescription: RESULT_TYPES[t].description,
      answers: next,
      createdAt: new Date().toISOString(),
    };
    saveDiagnosisResult(r);

    // auth-scoped durable（diagnosis_logs）へ best-effort dualWrite（fire-and-forget）。
    //   - userId 未確定なら no-op（AuthProvider の backfill が後で拾う）。
    //   - await しない / 例外握り潰し / dynamic import で boundary 安全。
    //   - 既存 anonymous mirror（saveDiagnosisResult 内）には触らない（別経路）。
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
      <div className="mx-auto max-w-xl px-4 sm:px-6 py-12 sm:py-16">
        {step === 'start' && <StartScreen onStart={startDiagnosis} />}
        {step === 'answering' && (
          <AnsweringScreen
            questionIdx={currentQ}
            total={DIAGNOSIS_QUESTIONS.length}
            question={DIAGNOSIS_QUESTIONS[currentQ]}
            onSelect={selectOption}
            onBack={goBackOneQuestion}
          />
        )}
        {step === 'result' && result && (
          <ResultScreen result={result} onRestart={restart} />
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
        所要時間 30秒・登録不要
      </p>
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-snug mb-4 text-slate-900">
        30秒でわかる、
        <br className="sm:hidden" />
        あなたの受験タイプ診断
      </h1>
      <p className="text-sm sm:text-base text-slate-700 leading-relaxed mb-10">
        いくつかの質問に答えるだけで、
        <br className="sm:hidden" />
        総合型選抜・学校推薦型選抜での
        <br className="sm:hidden" />
        あなたの進め方が見えてきます。
      </p>
      <button
        type="button"
        onClick={onStart}
        className="inline-flex justify-center items-center w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base sm:text-lg px-10 py-4 sm:py-5 rounded-3xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200"
      >
        診断を始める
        <span aria-hidden="true" className="ml-2">→</span>
      </button>
      <p className="mt-6 text-xs text-slate-500">
        全{DIAGNOSIS_QUESTIONS.length}問・選択式
      </p>
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
  question: DiagnosisQuestion;
  onSelect: (optionIdx: number) => void;
  onBack: () => void;
}) {
  const progressPct = ((questionIdx + 1) / total) * 100;
  return (
    <div>
      {/* 進捗バー */}
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
          <span className="text-blue-700">
            {questionIdx + 1} / {total}
          </span>
          <span>残り {total - questionIdx - 1} 問</span>
        </div>
        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* 質問カード */}
      <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-6 sm:p-8 mb-6">
        <p className="text-xs font-bold text-blue-600 mb-2">
          Q{questionIdx + 1}
        </p>
        <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-relaxed mb-6">
          {question.q}
        </h2>
        <div className="space-y-3">
          {question.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              className="w-full text-left bg-white hover:bg-blue-50 hover:border-blue-400 border border-slate-300 rounded-xl px-5 py-4 text-sm sm:text-base text-slate-800 leading-relaxed transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 前へ戻る（Q1 以外） */}
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

function ResultScreen({
  result,
  onRestart,
}: {
  result: DiagnosisResult;
  onRestart: () => void;
}) {
  return (
    <div className="text-center">
      <p className="inline-block text-xs font-bold text-indigo-700 bg-white ring-1 ring-indigo-200 rounded-full px-4 py-1 mb-6 shadow-sm">
        診断結果
      </p>

      {/* タイプ番号バッジ */}
      <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-indigo-100 text-indigo-700 text-2xl sm:text-3xl font-extrabold mb-5 shadow-sm">
        {result.resultType}
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-snug mb-2 text-slate-900">
        あなたは
      </h1>
      <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight leading-snug mb-8 text-blue-700">
        「{result.resultTitle}」
      </h2>

      {/* 説明カード */}
      <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-6 sm:p-8 text-left mb-8 sm:mb-10">
        <p className="text-sm sm:text-base text-slate-700 leading-relaxed whitespace-pre-line">
          {result.resultDescription}
        </p>
      </div>

      {/* CTA */}
      <div className="flex flex-col gap-3 max-w-md mx-auto">
        <Link
          href="/home"
          className="inline-flex justify-center items-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base sm:text-lg px-8 py-4 rounded-3xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200"
        >
          このタイプに合わせて対策を始める
          <span aria-hidden="true" className="ml-2">→</span>
        </Link>
        <Link
          href="/"
          className="inline-flex justify-center items-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold text-sm sm:text-base px-6 py-3 rounded-xl transition-colors"
        >
          トップページに戻る
        </Link>
      </div>

      {/* もう一度診断する */}
      <button
        type="button"
        onClick={onRestart}
        className="mt-8 text-sm text-slate-500 hover:text-slate-800 transition-colors"
      >
        もう一度診断する
      </button>
    </div>
  );
}
