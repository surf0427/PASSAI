'use client';

import { useState, useEffect, useRef } from 'react';
import {
  saveDraft, loadDraft, clearDraft,
  saveReviewHistory, loadReviewHistory, clearReviewHistory, deleteReviewHistoryItem,
  type ReviewHistoryItem,
} from '@/lib/statementStorage';
import {
  canUseStatementReview,
  incrementStatementReviewCount,
  getRemainingStatementReviewCount,
} from '@/lib/statementLimit';
import type { StatementResult } from '@/types/statement';
import { normalizeStatementScore } from '@/lib/statementScore';
import { loadActivityData } from '@/lib/activityStorage';
import {
  clearStatementPrepareFollowUpAnswers,
  getStatementPrepareSummary,
  getStatementPrepareFollowUpAnswers,
  type StatementPrepareFollowUpAnswers,
  type StatementPrepareSummary,
} from '@/lib/statementPrepareStorage';
import {
  STATEMENT_PREPARE_FOLLOW_UP_LABELS,
  type StatementPrepareWeakPointKey,
} from '@/lib/detectStatementPrepareWeakPoints';
import type { ActivityData } from '@/types/activity';
import type { BasicInfo } from '@/types/basicInfo';
import type { WallHittingResult } from '@/types/analysis';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { loadWallHittingResult } from '@/lib/wallHittingStorage';
import BasicInfoSummary from '@/components/shared/BasicInfoSummary';
import { detectNgWords } from '@/lib/detectNgWords';
import { NgWordCheck } from '@/components/NgWordCheck';
import { RewriteGuide } from '@/components/RewriteGuide';
import { StructureCheck } from '@/components/StructureCheck';
import { EvaluationAxisCheck } from '@/components/EvaluationAxisCheck';
import { StepHeader } from '@/components/StatementFlow/StepHeader';
import { Accordion } from '@/components/ui/Accordion';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import { Textarea } from '@/components/ui/Textarea';
import { Input } from '@/components/ui/Input';
import { AlertBox } from '@/components/ui/AlertBox';
import { Label } from '@/components/ui/Label';

// ── APIレスポンス型 ───────────────────────────────────────────────

type ApiReviewResponse = {
  totalScore: number;
  scores: {
    logic: number;
    specificity: number;
    universityFit: number;
    futureGoal: number;
    originality: number;
  };
  strengths: string[];
  weaknesses: string[];
  actions: string[];
  partialExamples: string[];
  checklist: string[];
};

// APIレスポンスを画面の型に変換する。
// STEP 32: AI の totalScore は信用せず、breakdown 合計から total を再計算して保存する
// （ページごとに sum がブレないよう、保存前に必ず normalize を通す）。
function mapApiResponse(data: ApiReviewResponse): StatementResult {
  const score = normalizeStatementScore({
    breakdown: {
      logic:         data.scores.logic,
      specificity:   data.scores.specificity,
      universityFit: data.scores.universityFit,
      futureGoal:    data.scores.futureGoal,
      originality:   data.scores.originality,
    },
  });
  return {
    overallScore: score.total,
    evaluations: [
      { label: '論理構造',     score: score.breakdown.logic },
      { label: '具体性',       score: score.breakdown.specificity },
      { label: '大学との一致', score: score.breakdown.universityFit },
      { label: '将来目標',     score: score.breakdown.futureGoal },
      { label: '独自性',       score: score.breakdown.originality },
    ],
    strengths: data.strengths,
    weaknesses: data.weaknesses,
    actions: data.actions,
    partialRevision: data.partialExamples.join('\n\n'),
    checklist: data.checklist,
  };
}

// ── 日時フォーマット ──────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${h}:${min}`;
}

// ── スコアバー ────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const percentage = (score / 20) * 100;
  const color =
    percentage >= 80 ? 'bg-green-500' : percentage >= 60 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-sm font-semibold text-gray-700 w-14 text-right">{score} / 20</span>
    </div>
  );
}

// ── 整理フローで作ったメモの表示項目（STEP 20: ラベルを追加メモと揃えてコンパクト化） ──

const PREPARE_SUMMARY_FIELDS: Array<{
  key: keyof Omit<StatementPrepareSummary, 'updatedAt' | 'inputSignature'>;
  label: string;
}> = [
  { key: 'impressiveExperience', label: '印象に残った経験' },
  { key: 'feltIssue',            label: '気づいた課題' },
  { key: 'interestInField',      label: '分野・学部への興味' },
  { key: 'universityLearning',   label: '大学で学びたいこと' },
  { key: 'futureApplication',    label: '将来やりたいこと' },
];

// ── 書き出しヒント挿入ロジック ────────────────────────────────────

function appendHintToText(currentText: string, hint: string): string {
  const trimmedHint = hint.trim();
  if (!currentText.trim()) return trimmedHint;
  if (currentText.endsWith('\n\n')) return `${currentText}${trimmedHint}`;
  if (currentText.endsWith('\n')) return `${currentText}\n${trimmedHint}`;
  return `${currentText}\n\n${trimmedHint}`;
}

// ── ページ本体 ────────────────────────────────────────────────────

export default function StatementPage() {
  // localStorage 依存の値はすべて useEffect でロードする（SSR と不一致にならないよう空値で初期化）
  const [university, setUniversity] = useState('');
  const [faculty, setFaculty] = useState('');
  const [department, setDepartment] = useState('');
  const [statementText, setStatementText] = useState('');
  const [activities, setActivities] = useState<ActivityData | null>(null);
  // basicInfo と wallHitting は添削API/プロンプトに渡す補助情報。localStorage を直接読まず共通関数経由で取得する。
  const [basicInfo, setBasicInfo] = useState<BasicInfo | null>(null);
  const [wallHitting, setWallHitting] = useState<WallHittingResult | null>(null);
  const [history, setHistory] = useState<ReviewHistoryItem[]>([]);
  const [remainingCount, setRemainingCount] = useState(5); // サーバーと一致するデフォルト値
  const [prepareSummary, setPrepareSummary] = useState<StatementPrepareSummary | null>(null);
  // STEP 18: /statement/prepare で書いた追加メモ。表示専用、textarea には自動挿入しない。
  const [prepareFollowUps, setPrepareFollowUps] = useState<StatementPrepareFollowUpAnswers>({});
  // STEP 22: 参考メモ（左カラム）の表示/非表示。session 中のみ、localStorage 保存しない。
  const [showReferenceNotes, setShowReferenceNotes] = useState(true);
  const [mounted, setMounted] = useState(false);

  const inputSectionRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [rewriteGuide, setRewriteGuide] = useState<{ phrase: string; answers: string[] } | null>(null);
  const [showInsertedHint, setShowInsertedHint] = useState(false);

  function handleStartRewrite(phrase: string, answers: string[]) {
    setRewriteGuide({ phrase, answers });
    setTimeout(() => {
      inputSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  function handleInsertStarterHint(hint: string) {
    setStatementText((prev) => appendHintToText(prev, hint));
    setShowInsertedHint(true);
    // DOM更新後にフォーカスとカーソル移動を実行
    setTimeout(() => {
      inputSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.value.length;
      el.selectionEnd = el.value.length;
    }, 0);
  }

  const [result, setResult] = useState<StatementResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showImproveForm, setShowImproveForm] = useState(false);
  const [improveText, setImproveText] = useState('');
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // マウント後に localStorage から全データを一括ロードする
  useEffect(() => {
    const basic = loadBasicInfo();
    setBasicInfo(basic);
    setWallHitting(loadWallHittingResult());

    const draft = loadDraft();
    if (draft) {
      setUniversity(draft.university);
      setFaculty(draft.faculty);
      setDepartment(draft.department);
      setStatementText(draft.statementText);
    } else if (basic) {
      // 初回アクセスで下書きがない場合は basicInfo の第一志望を初期値に入れる。
      // ユーザーは画面上で上書きできる。department が空なら空欄のまま。
      const pref = basic.preferences?.[0];
      if (pref) {
        setUniversity(pref.university ?? '');
        setFaculty(pref.faculty ?? '');
        setDepartment(pref.department ?? '');
      }
    }

    setActivities(loadActivityData());
    setHistory(loadReviewHistory());
    setRemainingCount(getRemainingStatementReviewCount());
    setPrepareSummary(getStatementPrepareSummary());
    setPrepareFollowUps(getStatementPrepareFollowUpAnswers());
    setMounted(true);
  }, []);

  // unmount 時に残タイマーをクリアする
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // API呼び出し・バリデーション・エラー処理・state更新をまとめた共通処理
  // validate      : 呼び出し前に行う入力チェック。エラーメッセージを返すか、問題なければ null を返す
  // clearResultOnStart : バリデーション通過後に前の結果をリセットするか（初回送信時のみ true）
  // afterSuccess   : API成功後にハンドラ固有の処理があれば渡す
  async function submitReview(
    essay: string,
    options: {
      validate?: () => string | null;
      clearResultOnStart?: boolean;
      afterSuccess?: () => void;
    } = {}
  ) {
    if (!canUseStatementReview()) {
      setError('本日の添削回数上限に達しました。明日またお試しください。');
      return;
    }

    const validationError = options.validate?.();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (options.clearResultOnStart) setResult(null);
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/statement-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          university,
          faculty,
          department,
          essay,
          basicInfo,
          activityData: activities,
          wallHittingResult: wallHitting,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'AIの処理に失敗しました。時間をおいてお試しください。');
        return;
      }

      const mapped = mapApiResponse(data as ApiReviewResponse);
      setResult(mapped);
      setShowImproveForm(false);

      incrementStatementReviewCount();
      setRemainingCount(getRemainingStatementReviewCount());

      saveReviewHistory({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        university,
        faculty,
        department,
        essay: statementText,
        result: mapped,
      });
      setHistory(loadReviewHistory());

      options.afterSuccess?.();
    } catch {
      setError('通信エラーが発生しました。インターネット接続を確認してください。');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (loading) return;
    await submitReview(statementText, {
      validate: () => {
        if (!statementText.trim()) return '志望理由書本文を入力してください';
        if (statementText.trim().length < 100) return '志望理由書本文をもう少し詳しく入力してください（100文字以上）';
        return null;
      },
      clearResultOnStart: true,
    });
  }

  function handleSaveDraft() {
    saveDraft({ university, faculty, department, statementText });
    alert('保存しました');
  }

  function handleReset() {
    setUniversity('');
    setFaculty('');
    setDepartment('');
    setStatementText('');
    setResult(null);
    setError('');
    setShowImproveForm(false);
    setImproveText('');
    clearDraft();
  }

  async function handleImproveSubmit() {
    if (loading) return;
    const trimmedImproveText = improveText.trim();
    // 元の志望理由書に追加情報を組み合わせて再添削する
    const combinedEssay = `【元の志望理由書】\n${statementText}\n\n【追加情報・改善メモ】\n${trimmedImproveText}`;
    await submitReview(combinedEssay, {
      validate: () => !trimmedImproveText ? '追加情報を入力してください' : null,
      afterSuccess: () => {
        setImproveText('');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    });
  }

  function handleRestoreHistory(item: ReviewHistoryItem) {
    setUniversity(item.university);
    setFaculty(item.faculty);
    setDepartment(item.department);
    setStatementText(item.essay);
    setResult(item.result);
    setError('');
    setShowImproveForm(false);
    setImproveText('');
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    setToast('履歴を復元しました');
    toastTimerRef.current = setTimeout(() => setToast(''), 3000);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleDeleteHistoryItem(id: string) {
    if (!window.confirm('この履歴を削除しますか？')) return;
    deleteReviewHistoryItem(id);
    setHistory(loadReviewHistory());
  }

  function handleClearHistory() {
    if (!window.confirm('履歴をすべて削除しますか？この操作は元に戻せません。')) return;
    clearReviewHistory();
    setHistory([]);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">

      {/* ── ステップヘッダー ─────────────────────────────── */}
      <StepHeader
        currentStep={1}
        totalSteps={5}
        title="志望理由書を入力する"
        description="入力した志望理由書をAIが添削します。AIは完成文を代筆するのではなく、自分で改善できるようにアドバイスします。"
        backHref="/statement"
        nextHref="/statement/score"
        nextLabel="完成度を見る"
      />
      <p className="text-xs text-gray-400 mb-6 -mt-4">
        論理構造・具体性・大学との一致・将来目標・独自性の観点から添削します。
      </p>

      <BasicInfoSummary basicInfo={basicInfo} />

      {/* ── 入力フォーム ── */}
      <section ref={inputSectionRef} className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
        <h2 className="text-base font-semibold text-gray-700 mb-5">志望情報・本文を入力</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div>
            <Label>志望大学</Label>
            <Input
              value={university}
              onChange={(e) => setUniversity(e.target.value)}
              placeholder="例：○○大学"
            />
          </div>
          <div>
            <Label>学部名</Label>
            <Input
              value={faculty}
              onChange={(e) => setFaculty(e.target.value)}
              placeholder="例：国際文化学部"
            />
          </div>
          <div className="sm:col-span-2">
            <Label>学科名（任意）</Label>
            <Input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="例：国際文化学科"
            />
          </div>
        </div>

        {/* STEP 21: PC は 2 カラム（左：参考メモ、右：本文入力）／モバイルは従来通り縦並び。
            STEP 22: 参考メモは showReferenceNotes で表示切替。隠すと右カラムが幅を全取りする。 */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {mounted && showReferenceNotes && (prepareSummary !== null || Object.values(prepareFollowUps).some((v) => (v ?? '').trim().length > 0)) && (
          <aside className="space-y-6 lg:basis-2/5 lg:shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
        {/* STEP 20: 整理フローで作ったメモ。本文 textarea に自動挿入しない。
            順序：整理メモ → 追加メモ → 本文入力欄。 */}
        {mounted && prepareSummary && (
          <Card className="bg-blue-50 border-blue-100">
            <h3 className="text-sm font-bold text-blue-900 mb-1">整理メモ</h3>
            <p className="text-xs text-blue-700/80 mb-4 leading-relaxed">
              下書きを書くときの材料として参考にしてください。
            </p>
            <ol className="space-y-3 list-none">
              {PREPARE_SUMMARY_FIELDS.map(({ key, label }, i) => (
                <li key={key} className="flex gap-2">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-blue-200 text-blue-800 text-[10px] font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-blue-900 mb-0.5">{label}</p>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                      {prepareSummary[key]}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {/* STEP 18/19: 整理フローで書いた追加メモ。本文 textarea に自動挿入しない。
            STEP 20 の指定により、整理メモ Card の直下に並べて本文入力欄の上に置く。 */}
        {mounted && (() => {
          const items = (
            Object.entries(prepareFollowUps) as Array<
              [StatementPrepareWeakPointKey, string | undefined]
            >
          ).flatMap(([key, value]) => {
            const trimmed = value?.trim() ?? '';
            return trimmed ? [{ key, value: trimmed }] : [];
          });
          if (items.length === 0) return null;
          return (
            <Card className="bg-amber-50 border-amber-100">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h3 className="text-sm font-bold text-amber-900">
                  追加メモ
                </h3>
                {/* STEP 19: 追加メモのみを消す。下書き本文 textarea には触れない。 */}
                <button
                  type="button"
                  onClick={() => {
                    clearStatementPrepareFollowUpAnswers();
                    setPrepareFollowUps({});
                  }}
                  className="shrink-0 text-xs text-amber-700/70 hover:text-amber-900 underline underline-offset-2"
                >
                  追加メモを消す
                </button>
              </div>
              <p className="text-xs text-amber-800/80 mb-4 leading-relaxed">
                下書きを書くときの材料として参考にしてください。
              </p>
              <ol className="space-y-3 list-none">
                {items.map(({ key, value }) => (
                  <li key={key}>
                    <p className="text-xs font-semibold text-amber-900 mb-0.5">
                      {STATEMENT_PREPARE_FOLLOW_UP_LABELS[key]}
                    </p>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                      {value}
                    </p>
                  </li>
                ))}
              </ol>
            </Card>
          );
        })()}
          </aside>
          )}

          {/* STEP 21: 右カラム（本文入力欄＋送信／状態系）。lg:min-w-0 で flex 子要素のはみ出しを防ぐ。 */}
          <div className="lg:flex-1 lg:min-w-0">
            {/* STEP 22: 参考メモが存在するときだけトグルを出す（無いときは閉じる対象も無い）。 */}
            {mounted && (prepareSummary !== null || Object.values(prepareFollowUps).some((v) => (v ?? '').trim().length > 0)) && (
              <div className="flex justify-end mb-2">
                <button
                  type="button"
                  onClick={() => setShowReferenceNotes((v) => !v)}
                  className="text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2"
                >
                  {showReferenceNotes ? '参考メモを隠す' : '参考メモを見る'}
                </button>
              </div>
            )}
        <div className="mb-6">
          {rewriteGuide && (
            <RewriteGuide
              key={rewriteGuide.phrase}
              phrase={rewriteGuide.phrase}
              answers={rewriteGuide.answers}
              onClose={() => setRewriteGuide(null)}
            />
          )}
          <Label>志望理由書本文</Label>
          <Textarea
            ref={textareaRef}
            value={statementText}
            onChange={(e) => { setStatementText(e.target.value); setShowInsertedHint(false); }}
            rows={12}
            placeholder={`志望理由書の本文を貼り付けてください。\n\n例：\n私が○○大学△△学部を志望する理由は…`}
            className="leading-relaxed resize-y"
          />
          {showInsertedHint && (
            <div className="mt-2 space-y-0.5">
              <p className="text-sm text-blue-600">
                👇 追加された一文の「〇〇」「△△」を、あなた自身の経験・関心に置き換えてください。
              </p>
              <p className="text-xs text-gray-400">
                例：〇〇＝留学先で印象に残った出来事、△△＝そこから興味を持ったテーマ
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={loading || remainingCount === 0}
          >
            {loading ? '添削中...' : 'AI添削する'}
          </Button>
          <Button variant="secondary" onClick={handleSaveDraft}>
            下書きを保存
          </Button>
          <Button variant="secondary" onClick={handleReset}>
            入力をリセット
          </Button>
          <span className="ml-auto text-sm text-gray-500">
            本日の残り添削回数：
            {mounted ? (
              <span className={remainingCount === 0 ? 'text-red-500 font-bold' : remainingCount === 1 ? 'text-yellow-600 font-bold' : 'font-semibold'}>
                {remainingCount}回
              </span>
            ) : (
              <span className="text-gray-400">-回</span>
            )}
            <span className="text-gray-400"> / 5回</span>
          </span>
        </div>
        {mounted && remainingCount === 1 && (
          <p className="text-yellow-600 text-xs mt-3">残り1回です。大切にお使いください。</p>
        )}
        {mounted && remainingCount === 0 && (
          <p className="text-red-500 text-xs mt-3">本日の添削回数上限に達しました。明日またお試しください。</p>
        )}
          </div>
        </div>
      </section>

      {error && (
        <p className="text-red-600 text-sm mb-6">{error}</p>
      )}

      {/* ── 添削結果エリア ── */}
      {result ? (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-gray-800 mb-6">添削結果</h2>

          {/* 総合評価 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-4 mb-3">
              <span className="text-4xl font-bold text-blue-700">{result.overallScore}</span>
              <div>
                <p className="text-sm font-semibold text-blue-800">総合評価</p>
                <p className="text-xs text-blue-600">/ 100点</p>
              </div>
            </div>
          </div>

          {/* 各評価 */}
          <Card className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">各評価</h3>
            <div className="space-y-4">
              {result.evaluations.map((ev) => (
                <div key={ev.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">{ev.label}</span>
                  </div>
                  <ScoreBar score={ev.score} />
                </div>
              ))}
            </div>
          </Card>

          {/* 良い点 */}
          <AlertBox variant="success" className="mb-4">
            <h3 className="text-sm font-semibold text-green-800 mb-3">良い点</h3>
            <ul className="space-y-1">
              {result.strengths.map((s, i) => (
                <li key={i} className="text-sm text-green-700 flex gap-2">
                  <span>✓</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </AlertBox>

          {/* 弱い点 */}
          <AlertBox variant="error" className="mb-4">
            <h3 className="text-sm font-semibold text-red-800 mb-3">弱い点</h3>
            <ul className="space-y-1">
              {result.weaknesses.map((w, i) => (
                <li key={i} className="text-sm text-red-700 flex gap-2">
                  <span>△</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </AlertBox>

          {/* 改善アクション */}
          <AlertBox variant="warning" className="mb-4">
            <h3 className="text-sm font-semibold text-yellow-800 mb-3">改善アクション</h3>
            <ol className="space-y-2">
              {result.actions.map((a, i) => (
                <li key={i} className="text-sm text-yellow-900 flex gap-2">
                  <span className="font-bold shrink-0">{i + 1}.</span>
                  <span>{a}</span>
                </li>
              ))}
            </ol>
          </AlertBox>

          {/* 部分修正例 */}
          <Card className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">部分修正例</h3>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">
              {result.partialRevision}
            </pre>
          </Card>

          {/* 再提出チェックリスト */}
          <Card className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">再提出チェックリスト</h3>
            <ul className="space-y-2">
              {result.checklist.map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    id={`check-${i}`}
                  />
                  <label htmlFor={`check-${i}`} className="text-sm text-gray-700 cursor-pointer">
                    {item}
                  </label>
                </li>
              ))}
            </ul>
          </Card>

          {/* ── 再提出フロー ── */}
          {!showImproveForm ? (
            <div className="pt-4 border-t border-gray-200 text-center">
              <p className="text-sm text-gray-500 mb-3">
                改善アクションをもとに文章を見直したら、もう一度添削を受けましょう。
              </p>
              <Button
                variant="outline"
                onClick={() => setShowImproveForm(true)}
                disabled={remainingCount === 0}
              >
                もう一度改善する
              </Button>
              {remainingCount === 0 && (
                <p className="text-xs text-red-500 mt-2">本日の添削回数上限に達しました</p>
              )}
            </div>
          ) : (
            <div className="border border-blue-200 rounded-xl overflow-hidden">
              <div className="bg-blue-50 px-6 py-4">
                <h3 className="text-sm font-bold text-blue-800 mb-2">
                  指摘された点を改善するために、追加情報を入力してください
                </h3>
                <ul className="space-y-1">
                  {result.weaknesses.map((w, i) => (
                    <li key={i} className="text-xs text-blue-700 flex gap-1">
                      <span className="shrink-0">→</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white px-6 py-5">
                <p className="text-xs text-gray-400 mb-2">
                  例：「なぜこの大学を選んだか」「具体的な経験のエピソード」「将来の目標の詳細」など
                </p>
                <Textarea
                  value={improveText}
                  onChange={(e) => setImproveText(e.target.value)}
                  rows={6}
                  placeholder="改善した内容や追加したい情報を自由に書いてください"
                  className="leading-relaxed resize-y"
                />
                <div className="flex items-center gap-3 mt-4">
                  <Button
                    variant="primary"
                    onClick={handleImproveSubmit}
                    disabled={loading}
                  >
                    {loading ? '添削中...' : 'この情報を加えて再添削する'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setShowImproveForm(false); setImproveText(''); setError(''); }}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : (
        /* 添削前のプレースホルダー */
        <section className="mb-10">
          <h2 className="text-xl font-bold text-gray-800 mb-4">添削結果</h2>
          <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-10 text-center">
            <p className="text-gray-400 text-sm">まだ添削結果はありません</p>
          </div>
        </section>
      )}

      {/* ── 次のステップへ：完成度スコア ─────────────────── */}
      {result && (
        <section className="mb-10 bg-blue-50 border border-blue-100 rounded-2xl p-5 sm:p-6">
          <p className="text-[11px] font-bold text-blue-700 mb-1 tracking-widest">
            次のステップ
          </p>
          <p className="text-sm text-slate-700 leading-relaxed mb-4">
            添削結果をもとに、完成度スコアで現在地を確認しましょう。
          </p>
          <LinkButton
            href="/statement/score"
            variant="primary"
            size="md"
            className="w-full sm:w-auto"
          >
            完成度スコアを見る →
          </LinkButton>
        </section>
      )}

      {/* ── 詳細分析（折りたたみ） ─────────────────────────── */}
      <Accordion title="詳細分析を見る">
        <div className="space-y-6">
          {result && (
            <div className="space-y-4">
              {/* 抽象表現・NGワードチェック */}
              <NgWordCheck
                issues={detectNgWords(statementText, activities, university, faculty)}
                onStartRewrite={handleStartRewrite}
                onInsertStarterHint={handleInsertStarterHint}
              />

              {/* 志望理由書の構造チェック */}
              <StructureCheck text={statementText} />

              {/* 大学・学部との一致チェック */}
              <EvaluationAxisCheck
                university={university}
                faculty={faculty}
                text={statementText}
              />
            </div>
          )}

          {/* 過去の添削履歴 */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-800">過去の添削履歴</h3>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-300 rounded px-3 py-1 transition-colors"
                >
                  履歴を全削除
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
                <p className="text-gray-400 text-sm">まだ履歴はありません</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="relative bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm rounded-xl transition-all"
                  >
                    {/* カード本体：クリックで復元 */}
                    <button
                      type="button"
                      onClick={() => handleRestoreHistory(item)}
                      className="w-full text-left p-4 pr-16"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-400">{formatDateTime(item.createdAt)}</span>
                        <span className="text-sm font-bold text-blue-700">{item.result.overallScore}点</span>
                      </div>
                      <p className="text-sm font-semibold text-gray-700 mb-1">
                        {item.university || '（大学未入力）'}　{item.faculty || '（学部未入力）'}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {item.essay.trim().slice(0, 30)}{item.essay.trim().length > 30 ? '…' : ''}
                      </p>
                    </button>

                    {/* 削除ボタン：stopPropagation でカードのクリックと分離 */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleDeleteHistoryItem(item.id); }}
                      className="absolute top-3 right-3 text-xs text-gray-300 hover:text-red-500 hover:bg-red-50 rounded px-2 py-1 transition-colors"
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </Accordion>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-5 py-2.5 rounded-lg shadow-lg pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}
