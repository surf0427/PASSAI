// STEP8.4/8.5: 志望理由書 edit 画面の入力フォーム view。
//   STEP8.4 で page.tsx 内 top-level function として logical split、STEP8.5 で
//   feature-local component file として physical split。
//   state ownership / hook ownership は page.tsx 側に維持。本 view は props を受け取って
//   render するだけの pure-ish 関数。
//   PREPARE_SUMMARY_FIELDS は本 view 専用 const として同居（他 view からの参照なし）。

import type { Dispatch, SetStateAction, RefObject } from 'react';
import { Card } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { RewriteGuide } from '@/components/statement/RewriteGuide';
import {
  clearStatementPrepareFollowUpAnswers,
  type StatementPrepareFollowUpAnswers,
  type StatementPrepareSummary,
} from '@/lib/statement/prepare/statementPrepareStorage';
import {
  STATEMENT_PREPARE_FOLLOW_UP_LABELS,
  type StatementPrepareWeakPointKey,
} from '@/lib/statement/prepare/detectStatementPrepareWeakPoints';

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

export type InputFormViewProps = {
  university: string;
  setUniversity: Dispatch<SetStateAction<string>>;
  faculty: string;
  setFaculty: Dispatch<SetStateAction<string>>;
  department: string;
  setDepartment: Dispatch<SetStateAction<string>>;
  statementText: string;
  setStatementText: Dispatch<SetStateAction<string>>;
  rewriteGuide: { phrase: string; answers: string[] } | null;
  setRewriteGuide: Dispatch<SetStateAction<{ phrase: string; answers: string[] } | null>>;
  showInsertedHint: boolean;
  setShowInsertedHint: Dispatch<SetStateAction<boolean>>;
  mounted: boolean;
  prepareSummary: StatementPrepareSummary | null;
  prepareFollowUps: StatementPrepareFollowUpAnswers;
  setPrepareFollowUps: Dispatch<SetStateAction<StatementPrepareFollowUpAnswers>>;
  showReferenceNotes: boolean;
  setShowReferenceNotes: Dispatch<SetStateAction<boolean>>;
  loading: boolean;
  remainingCount: number;
  // C1 mitigation: 「AI 添削する」ボタンの disable 条件は page.tsx 側で single source of truth 化。
  // loading / mounted / remainingCount を合成した最終 boolean を受け取り、本 view は判定しない。
  submitDisabled: boolean;
  onSubmit: () => void;
  onSaveDraft: () => void;
  onResetForm: () => void;
  inputSectionRef: RefObject<HTMLElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

export function InputFormView({
  university, setUniversity,
  faculty, setFaculty,
  department, setDepartment,
  statementText, setStatementText,
  rewriteGuide, setRewriteGuide,
  showInsertedHint, setShowInsertedHint,
  mounted,
  prepareSummary,
  prepareFollowUps, setPrepareFollowUps,
  showReferenceNotes, setShowReferenceNotes,
  loading,
  remainingCount,
  submitDisabled,
  onSubmit, onSaveDraft, onResetForm,
  inputSectionRef, textareaRef,
}: InputFormViewProps) {
  return (
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
          onClick={onSubmit}
          disabled={submitDisabled}
        >
          {loading ? '添削中...' : 'AI添削する'}
        </Button>
        <Button variant="secondary" onClick={onSaveDraft}>
          下書きを保存
        </Button>
        <Button variant="secondary" onClick={onResetForm}>
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
  );
}
