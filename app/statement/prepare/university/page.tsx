'use client';

// 大学軸の整理機能（① 書く前に整理する機能・新フロー）。
//
// フロー: 大学選択 → 6 問に回答 → 整理メモ生成（既存 API） → 保存 → 整理メモ表示。
//
// 既存との関係:
//   - 既存 /statement/prepare（自由 3 項目入力）は壊さず温存。本ページは別ルート。
//   - 既存 /api/statement-prepare をそのまま再利用。プロンプト・PROMPT_VERSION 不変。
//   - 6 問の回答を 3 項目に集約する adapter は本ファイル内に保持（小さいので切り出さない）。
//   - 整理結果は新 history (statement_prepare_summary_history) に append し、
//     既存 statement_prepare_summary にも summary だけ書き戻して ② edit 左サイド欄を壊さない。
//
// 触らない:
//   - data/ 直 import（universities.ts 経由のみ）
//   - AI prompt / PROMPT_VERSION
//   - 添削 API / スコア計算 / Supabase

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import type { SchoolPreference } from '@/types/basicInfo';
import {
  buildUniversityFocusedQuestions,
  loadUniversityEvaluationContext,
  type UniversityFocusedQuestion,
} from '@/lib/statement/prepare/buildUniversityFocusedQuestions';
import {
  appendUniversityPrepareEntry,
  loadUniversityPrepareHistory,
  type UniversityFocusedQuestionId,
  type UniversityPrepareEntry,
} from '@/lib/statement/prepare/universityPrepareHistory';
import type { StatementPrepareApiResult } from '@/app/api/statement-prepare/route';
// STEP-PAGE-01 で inline 定義から切り出した step component 群。
//   pure props rendering。各 component の責務境界は ./components/ 配下のヘッダコメント参照。
//   SUMMARY_FIELDS は SummaryStep / HistoryEntryCard 各 component 内に self-contained で同居。
//   formatDate は唯一の consumer である HistoryEntryCard と一緒に移送した。
import { SelectUniversityStep } from './components/SelectUniversityStep';
import { AnswerStep } from './components/AnswerStep';
import { SummaryStep } from './components/SummaryStep';

// マウント前 false / マウント後 true。基本 SSR/hydration セーフパターン。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

type Step = 'select_uni' | 'answer' | 'summary';

type AnswerMap = Record<UniversityFocusedQuestionId, string>;

const EMPTY_ANSWERS: AnswerMap = {
  why_this_uni: '',
  philosophy_fit: '',
  learning_focus: '',
  future_link: '',
  why_only_here: '',
  activity_link: '',
};

// ── adapter: 6 問の回答 → 既存 API の 3 項目 ───────────────────────
// 変換ルール（仕様で指定された通り）:
//   interestReason      ← why_this_uni + philosophy_fit + why_only_here
//   memorableExperience ← activity_link
//   futureGoal          ← future_link + learning_focus
function adaptAnswersToApiInput(answers: AnswerMap): {
  interestReason: string;
  memorableExperience: string;
  futureGoal: string;
} {
  const join = (parts: string[]) =>
    parts.map((p) => p.trim()).filter((p) => p.length > 0).join('\n\n');
  return {
    interestReason: join([
      answers.why_this_uni,
      answers.philosophy_fit,
      answers.why_only_here,
    ]),
    memorableExperience: answers.activity_link.trim(),
    futureGoal: join([answers.future_link, answers.learning_focus]),
  };
}

function isApiResult(value: unknown): value is StatementPrepareApiResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.impressiveExperience === 'string' &&
    typeof v.feltIssue === 'string' &&
    typeof v.interestInField === 'string' &&
    typeof v.universityLearning === 'string' &&
    typeof v.futureApplication === 'string'
  );
}

export default function StatementPrepareUniversityPage() {
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // basicInfo.preferences[] を mount 後に取り出す。SSR では空配列を返して
  // hydration mismatch を回避する。
  const preferences = useMemo<SchoolPreference[]>(
    () => (isMounted ? loadBasicInfo()?.preferences ?? [] : []),
    [isMounted],
  );

  // 過去ログ一覧（参考表示用、最大 10 件）。
  const [history, setHistory] = useState<UniversityPrepareEntry[]>([]);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setHistory(loadUniversityPrepareHistory());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // フロー state
  const [step, setStep] = useState<Step>('select_uni');
  const [pref, setPref] = useState<SchoolPreference | null>(null);
  const [questions, setQuestions] = useState<UniversityFocusedQuestion[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>(EMPTY_ANSWERS);
  const [summary, setSummary] = useState<StatementPrepareApiResult | null>(null);

  // 手入力 fallback（preferences が空 or 「別の大学を入力」選択時）
  const [manualUniversity, setManualUniversity] = useState('');
  const [manualFaculty, setManualFaculty] = useState('');
  const [manualDepartment, setManualDepartment] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function handlePickPreference(p: SchoolPreference) {
    const qs = buildUniversityFocusedQuestions({
      university: p.university,
      faculty: p.faculty,
      department: p.department ?? '',
    });
    setPref(p);
    setQuestions(qs);
    setAnswers(EMPTY_ANSWERS);
    setSummary(null);
    setError('');
    setStep('answer');
  }

  function handleUseManual() {
    const uni = manualUniversity.trim();
    if (!uni) {
      setError('大学名を入力してください');
      return;
    }
    const p: SchoolPreference = {
      university: uni,
      faculty: manualFaculty.trim(),
      department: manualDepartment.trim(),
    };
    handlePickPreference(p);
  }

  function handleAnswerChange(id: UniversityFocusedQuestionId, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  async function handleSummarize() {
    if (loading || !pref) return;

    // 全 6 問が空欄ならブロック（1 問でも書いてあれば進める）。
    const allEmpty = Object.values(answers).every((v) => v.trim().length === 0);
    if (allEmpty) {
      setError('まずは1問だけでも回答してください');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const apiInput = adaptAnswersToApiInput(answers);
      const res = await fetch('/api/statement-prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiInput),
      });

      if (res.status === 429) {
        setError(
          '短時間に整理を繰り返しすぎています。しばらく時間をおいてからお試しください。',
        );
        return;
      }
      if (!res.ok) {
        setError('整理に失敗しました。もう一度お試しください。');
        return;
      }

      const data: unknown = await res.json();
      if (!isApiResult(data)) {
        setError('整理に失敗しました。もう一度お試しください。');
        return;
      }

      // 将来 AI 生成への拡張余地:
      //   - evaluationContext は今は deterministic でも DB スナップショットを populate する。
      //     AI 化 STEP では同関数を AI prompt の入力としても流用する想定。
      //   - sourceContext は builder が embed したスニペットを引き継ぐ
      //     (undefined のものは storage 側で省略される)。
      //   - generationMode = 'deterministic' は audit 用。AI 化 STEP で 'ai' に切り替える。
      const evaluationContext = loadUniversityEvaluationContext({
        university: pref.university,
        faculty: pref.faculty,
        department: pref.department ?? '',
      });
      const entry: UniversityPrepareEntry = {
        id:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        createdAt: new Date().toISOString(),
        university: pref.university,
        faculty: pref.faculty,
        department: pref.department ?? '',
        questions: questions.map((q) => {
          const item: UniversityPrepareEntry['questions'][number] = {
            id: q.id,
            label: q.label,
            answer: answers[q.id] ?? '',
          };
          if (q.sourceContext) item.sourceContext = q.sourceContext;
          return item;
        }),
        summary: data,
        evaluationContext,
        generationMode: 'deterministic',
      };
      appendUniversityPrepareEntry(entry);
      setHistory(loadUniversityPrepareHistory());
      setSummary(data);
      setStep('summary');
    } catch {
      setError('通信エラーが発生しました。インターネット接続を確認してください。');
    } finally {
      setLoading(false);
    }
  }

  function handleStartOver() {
    setStep('select_uni');
    setPref(null);
    setQuestions([]);
    setAnswers(EMPTY_ANSWERS);
    setSummary(null);
    setError('');
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <PageHeader
        title="大学に合わせて整理する"
        description="大学ごとの評価軸・理念に合わせて、書く前に頭を整理します。"
      />

      <div className="mb-6">
        <Link
          href="/statement"
          className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2"
        >
          ← 志望理由書トップへ
        </Link>
      </div>

      {step === 'select_uni' && (
        <SelectUniversityStep
          isMounted={isMounted}
          preferences={preferences}
          manualUniversity={manualUniversity}
          setManualUniversity={setManualUniversity}
          manualFaculty={manualFaculty}
          setManualFaculty={setManualFaculty}
          manualDepartment={manualDepartment}
          setManualDepartment={setManualDepartment}
          error={error}
          onPickPreference={handlePickPreference}
          onUseManual={handleUseManual}
          history={history}
        />
      )}

      {step === 'answer' && pref && (
        <AnswerStep
          pref={pref}
          questions={questions}
          answers={answers}
          loading={loading}
          error={error}
          onAnswerChange={handleAnswerChange}
          onBack={() => setStep('select_uni')}
          onSubmit={handleSummarize}
        />
      )}

      {step === 'summary' && summary && pref && (
        <SummaryStep
          pref={pref}
          summary={summary}
          onEditAnswers={() => setStep('answer')}
          onStartOver={handleStartOver}
        />
      )}
    </div>
  );
}
