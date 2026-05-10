'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  saveDiagnosisResult,
  loadDiagnosisResult,
  type DiagnosisResult,
} from '@/lib/diagnosisStorage';
import type { DiagnosisType } from '@/types/diagnosis';

// ── 受験タイプ診断（MVP） ──────────────────────────────────────
// 単一ファイル + クライアントコンポーネントで完結。
// step 状態（'start' | 'answering' | 'result'）で 3 画面を切り替える。
// 質問データ・結果データ・判定ロジックは MVP のため同ファイル内で持つ。
// 将来 AI スコアリングや Supabase 連携を入れる場合は QUESTIONS / calcResultType /
// saveDiagnosisResult を別ファイルに切り出す前提（今は不要な抽象化を避ける）。

type Step = 'start' | 'answering' | 'result';

type Option = { label: string; type: DiagnosisType };
type Question = { q: string; options: Option[] };

// ── 質問データ（5 問固定） ─────────────────────────────────────
const QUESTIONS: Question[] = [
  {
    q: '総合型選抜・学校推薦型選抜に対して、今どんな状態ですか？',
    options: [
      { label: '何から始めればいいか分からない', type: 1 },
      { label: '活動や経験はあるが、まとめ方が分からない', type: 2 },
      { label: '志望理由書を書いたが浅いと言われた', type: 3 },
      { label: '面接や小論文まで不安がある', type: 3 },
    ],
  },
  {
    q: '自分の活動や経験についてどう感じていますか?',
    options: [
      { label: '特に目立つ活動はないと思う', type: 1 },
      { label: 'あるけど、どう強みにすればいいか分からない', type: 2 },
      { label: 'ある程度まとまっている', type: 3 },
      { label: 'かなり自信がある', type: 3 },
    ],
  },
  {
    q: '志望理由書についてどの状態ですか？',
    options: [
      { label: '何を書けばいいか分からない', type: 1 },
      { label: '書き始めたけどまとまらない', type: 2 },
      { label: '一応書いたが自信がない', type: 3 },
      { label: '添削しながら完成度を上げたい', type: 3 },
    ],
  },
  {
    q: '一般受験との並行についてどう考えていますか？',
    options: [
      { label: '一般受験がメインで、推薦は片手間で進めたい', type: 4 },
      { label: 'どちらも同じくらい頑張りたい', type: 4 },
      { label: '推薦をメインにしたい', type: 3 },
      { label: 'まだ決めきれていない', type: 1 },
    ],
  },
  {
    q: '今一番サポートしてほしいことは？',
    options: [
      { label: '活動整理', type: 1 },
      { label: '自己分析', type: 2 },
      { label: '志望理由書', type: 3 },
      { label: '小論文', type: 3 },
      { label: '面接対策', type: 3 },
    ],
  },
];

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

// ── 判定ロジック ──────────────────────────────────────────────
// MVP のためシンプル：
//   1) Q4（一般受験との並行）の選択肢が type 4 なら最優先で「一般受験並行タイプ」
//   2) それ以外は Q1/Q2/Q3/Q5 の type を集計し、最頻 type を返す
// タイブレークは番号の小さい type を優先（より「初学者寄り」を上に出す）

function calcResultType(answers: number[]): DiagnosisType {
  const q4 = QUESTIONS[3].options[answers[3]];
  if (q4.type === 4) return 4;

  const scores: Record<DiagnosisType, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  answers.forEach((ansIdx, qIdx) => {
    if (qIdx === 3) return; // Q4 は判定済み
    const t = QUESTIONS[qIdx].options[ansIdx].type;
    scores[t]++;
  });

  let best: DiagnosisType = 1;
  if (scores[2] > scores[best]) best = 2;
  if (scores[3] > scores[best]) best = 3;
  return best;
}

// ── ページ本体 ────────────────────────────────────────────────

export default function DiagnosisPage() {
  const [step, setStep] = useState<Step>('start');
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<DiagnosisResult | null>(null);

  // 再訪時：保存された結果があれば結果画面に直接戻す
  useEffect(() => {
    const saved = loadDiagnosisResult();
    if (saved) {
      setResult(saved);
      setStep('result');
    }
  }, []);

  function startDiagnosis() {
    setAnswers([]);
    setCurrentQ(0);
    setStep('answering');
  }

  function selectOption(optionIdx: number) {
    const next = [...answers, optionIdx];
    setAnswers(next);
    if (currentQ + 1 < QUESTIONS.length) {
      setCurrentQ(currentQ + 1);
      return;
    }
    // 5 問目を回答 → 集計 + 保存 + 結果画面へ
    const t = calcResultType(next);
    const r: DiagnosisResult = {
      resultType: t,
      resultTitle: RESULT_TYPES[t].title,
      resultDescription: RESULT_TYPES[t].description,
      answers: next,
      createdAt: new Date().toISOString(),
    };
    saveDiagnosisResult(r);
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
            total={QUESTIONS.length}
            question={QUESTIONS[currentQ]}
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
        全{QUESTIONS.length}問・選択式
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
  question: Question;
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
