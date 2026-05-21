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
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import { Label } from '@/components/ui/Label';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { AlertBox } from '@/components/ui/AlertBox';
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
          onStartOver={handleStartOver}
        />
      )}
    </div>
  );
}

// ── STEP 1: 大学選択 ─────────────────────────────────────────────

function SelectUniversityStep({
  isMounted,
  preferences,
  manualUniversity,
  setManualUniversity,
  manualFaculty,
  setManualFaculty,
  manualDepartment,
  setManualDepartment,
  error,
  onPickPreference,
  onUseManual,
  history,
}: {
  isMounted: boolean;
  preferences: SchoolPreference[];
  manualUniversity: string;
  setManualUniversity: (v: string) => void;
  manualFaculty: string;
  setManualFaculty: (v: string) => void;
  manualDepartment: string;
  setManualDepartment: (v: string) => void;
  error: string;
  onPickPreference: (p: SchoolPreference) => void;
  onUseManual: () => void;
  history: UniversityPrepareEntry[];
}) {
  return (
    <>
      <Card className="mb-6">
        <h2 className="text-base font-bold text-slate-900 mb-1">
          整理したい大学を選んでください
        </h2>
        <p className="text-xs text-slate-500 leading-relaxed mb-4">
          大学ごとの理念・評価軸に合わせて深掘り質問を出します。
        </p>

        {isMounted && preferences.length > 0 && (
          <ul className="space-y-2 mb-5">
            {preferences.map((p, i) => (
              <li key={`${p.university}-${p.faculty}-${i}`}>
                <button
                  type="button"
                  onClick={() => onPickPreference(p)}
                  className="w-full text-left rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <p className="text-sm font-semibold text-slate-800">
                    {p.university || '（大学未入力）'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.faculty || '（学部未入力）'}
                    {p.department ? `　${p.department}` : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {isMounted && preferences.length === 0 && (
          <p className="text-xs text-slate-500 mb-3">
            基本情報に志望校が未登録です。下の入力欄から大学を指定して進めてください。
          </p>
        )}

        <div className="rounded-lg border border-dashed border-slate-300 p-4 bg-slate-50">
          <p className="text-xs font-semibold text-slate-700 mb-3">
            別の大学で整理する場合（手入力）
          </p>
          <div className="space-y-3">
            <div>
              <Label htmlFor="manual-uni">志望大学</Label>
              <Input
                id="manual-uni"
                value={manualUniversity}
                onChange={(e) => setManualUniversity(e.target.value)}
                placeholder="例：○○大学"
              />
            </div>
            <div>
              <Label htmlFor="manual-faculty">学部名</Label>
              <Input
                id="manual-faculty"
                value={manualFaculty}
                onChange={(e) => setManualFaculty(e.target.value)}
                placeholder="例：国際文化学部"
              />
            </div>
            <div>
              <Label htmlFor="manual-department">学科名（任意）</Label>
              <Input
                id="manual-department"
                value={manualDepartment}
                onChange={(e) => setManualDepartment(e.target.value)}
                placeholder="例：国際文化学科"
              />
            </div>
          </div>
          {error && (
            <AlertBox variant="warning" className="mt-3">
              {error}
            </AlertBox>
          )}
          <div className="mt-4">
            <Button variant="primary" onClick={onUseManual}>
              この大学で深掘り質問を出す →
            </Button>
          </div>
        </div>
      </Card>

      {isMounted && history.length > 0 && (
        <Card className="mb-6 bg-slate-50 border-slate-200">
          <h2 className="text-sm font-bold text-slate-900 mb-1">
            これまでに整理した記録（最新{history.length}件）
          </h2>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            クリックで整理メモと回答を確認できます。
          </p>
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id}>
                <HistoryEntryCard entry={h} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

// ── STEP 2: 6 問に回答 ──────────────────────────────────────────

function AnswerStep({
  pref,
  questions,
  answers,
  loading,
  error,
  onAnswerChange,
  onBack,
  onSubmit,
}: {
  pref: SchoolPreference;
  questions: UniversityFocusedQuestion[];
  answers: AnswerMap;
  loading: boolean;
  error: string;
  onAnswerChange: (id: UniversityFocusedQuestionId, value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <Card className="mb-6">
        <p className="text-[11px] font-bold text-blue-700 tracking-widest mb-2">
          深掘り対象
        </p>
        <p className="text-sm font-semibold text-slate-900">
          {pref.university}
          {pref.faculty ? `　${pref.faculty}` : ''}
          {pref.department ? `　${pref.department}` : ''}
        </p>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          書ける範囲で OK。完璧な文章でなくて構いません。1 問でも書ければ整理メモを生成できます。
        </p>
      </Card>

      <Card className="mb-6">
        <ol className="space-y-6">
          {questions.map((q, i) => (
            <li key={q.id}>
              <Label htmlFor={`q-${q.id}`}>
                Q{i + 1}. {q.label}
              </Label>
              {q.hint && (
                <p className="text-xs text-slate-500 mb-2 -mt-1 leading-relaxed">
                  {q.hint}
                </p>
              )}
              <Textarea
                id={`q-${q.id}`}
                value={answers[q.id] ?? ''}
                onChange={(e) => onAnswerChange(q.id, e.target.value)}
                rows={3}
                disabled={loading}
                className="resize-y"
              />
            </li>
          ))}
        </ol>

        {error && (
          <AlertBox variant="warning" className="mt-6">
            {error}
          </AlertBox>
        )}

        <div className="flex flex-wrap items-center gap-3 mt-6">
          <Button variant="primary" onClick={onSubmit} disabled={loading}>
            {loading ? '整理中...' : '整理メモを作る'}
          </Button>
          <Button variant="secondary" onClick={onBack} disabled={loading}>
            大学を選び直す
          </Button>
        </div>
      </Card>
    </>
  );
}

// ── STEP 3: 整理メモ表示 ─────────────────────────────────────────

const SUMMARY_FIELDS: Array<{
  key: keyof StatementPrepareApiResult;
  label: string;
}> = [
  { key: 'impressiveExperience', label: '印象に残った経験' },
  { key: 'feltIssue',            label: '気づいた課題' },
  { key: 'interestInField',      label: '分野・学部への興味' },
  { key: 'universityLearning',   label: '大学で学びたいこと' },
  { key: 'futureApplication',    label: '将来やりたいこと' },
];

function SummaryStep({
  pref,
  summary,
  onStartOver,
}: {
  pref: SchoolPreference;
  summary: StatementPrepareApiResult;
  onStartOver: () => void;
}) {
  return (
    <>
      <Card className="mb-6 bg-blue-50 border-blue-100">
        <p className="text-[11px] font-bold text-blue-700 tracking-widest mb-2">
          整理メモを保存しました
        </p>
        <p className="text-sm font-semibold text-slate-900">
          {pref.university}
          {pref.faculty ? `　${pref.faculty}` : ''}
          {pref.department ? `　${pref.department}` : ''}
        </p>
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          次は志望理由書の本文を書く画面で、この整理メモを参考にできます。
        </p>
      </Card>

      <Card className="mb-6">
        <h2 className="text-sm font-bold text-slate-900 mb-4">整理メモ</h2>
        <ol className="space-y-4 list-none">
          {SUMMARY_FIELDS.map(({ key, label }, i) => (
            <li key={key} className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-800 mb-1">
                  {label}
                </p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {summary[key]}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <LinkButton href="/statement/edit" variant="primary" size="md">
          志望理由書を書きに行く →
        </LinkButton>
        <Button variant="secondary" onClick={onStartOver}>
          別の大学で整理する
        </Button>
      </div>
    </>
  );
}

// ── 過去ログ一覧の 1 行 ─────────────────────────────────────────
// クリックで「整理メモ 5 項目」と「質問と回答」を展開する <details> ベース。
// 既存 UI を邪魔しない最小実装。SummaryStep と表示構造を寄せている。

function HistoryEntryCard({ entry }: { entry: UniversityPrepareEntry }) {
  const filledQuestions = entry.questions.filter(
    (q) => q.answer.trim().length > 0,
  );
  return (
    <details className="group bg-white rounded-lg border border-slate-200">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">
            {entry.university || '（大学未入力）'}
            {entry.faculty ? `　${entry.faculty}` : ''}
            {entry.department ? `　${entry.department}` : ''}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-xs text-slate-400 tabular-nums">
            {formatDate(entry.createdAt)}
          </span>
          <span className="text-slate-400 transition-transform group-open:rotate-180 inline-block">
            ▾
          </span>
        </div>
      </summary>
      <div className="px-4 pb-4 pt-1 border-t border-slate-100">
        <section className="mb-4">
          <h4 className="text-xs font-bold text-slate-700 mb-2">整理メモ</h4>
          <ol className="space-y-2 list-none">
            {SUMMARY_FIELDS.map(({ key, label }) => (
              <li key={key}>
                <p className="text-[11px] font-semibold text-slate-600 mb-0.5">
                  {label}
                </p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {entry.summary[key]}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {filledQuestions.length > 0 && (
          <section>
            <h4 className="text-xs font-bold text-slate-700 mb-2">
              質問と回答
            </h4>
            <ol className="space-y-3 list-none">
              {filledQuestions.map((q) => (
                <li key={q.id}>
                  <p className="text-[11px] font-semibold text-slate-600 mb-0.5">
                    Q. {q.label}
                  </p>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {q.answer}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </details>
  );
}

// ── helpers ──────────────────────────────────────────────────────

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}/${m}/${day}`;
}
