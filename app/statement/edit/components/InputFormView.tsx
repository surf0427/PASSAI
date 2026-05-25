// STEP8.4/8.5: 志望理由書 edit 画面の入力フォーム view。
//   STEP8.4 で page.tsx 内 top-level function として logical split、STEP8.5 で
//   feature-local component file として physical split。
//   state ownership / hook ownership は page.tsx 側に維持。本 view は props を受け取って
//   render するだけの pure-ish 関数。
//   PREPARE_SUMMARY_FIELDS は本 view 専用 const として同居（他 view からの参照なし）。

import { useMemo, type Dispatch, type SetStateAction, type RefObject } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import type { ReviewHistoryItem } from '@/lib/statement/review/statementStorage';
import { loadRewriteMemo } from '@/lib/statement/rewrite/rewriteMemoStorage';
import {
  deriveRewriteWorkSections,
  hasAnyWorkAnswer,
} from '@/lib/statement/rewrite/deriveRewriteWorkSections';
import {
  clearStatementPrepareFollowUpAnswers,
  type StatementPrepareFollowUpAnswers,
  type StatementPrepareSummary,
} from '@/lib/statement/prepare/statementPrepareStorage';
import {
  STATEMENT_PREPARE_FOLLOW_UP_LABELS,
  type StatementPrepareWeakPointKey,
} from '@/lib/statement/prepare/detectStatementPrepareWeakPoints';
import type { UniversityPrepareEntry } from '@/lib/statement/prepare/universityPrepareHistory';

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
  mounted: boolean;
  prepareSummary: StatementPrepareSummary | null;
  // ① 大学軸 prepare の履歴。1 件以上あれば左サイド欄で「整理メモ履歴」として優先表示し、
  // prepareSummary 単体表示は履歴 0 件時の fallback に下げる。
  prepareHistory: UniversityPrepareEntry[];
  // 履歴 1 件削除 callback。各 entry の expanded footer から呼ばれる。confirm は親側で実行。
  onDeletePrepareEntry: (id: string) => void;
  // STEP4-2 / 命名整理: ④ → ② への書き直し対象。non-null なら左サイド上部に
  // 「前回の分析（書き直し対象）」breadcrumb Card を表示し、深掘りは analysis page へ link 誘導する。
  // 本文 textarea 自体は page.tsx 側で mount-init に 1 回 prefill 済み。
  rewriteContext: ReviewHistoryItem | null;
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
};

export function InputFormView({
  university, setUniversity,
  faculty, setFaculty,
  department, setDepartment,
  statementText, setStatementText,
  mounted,
  prepareSummary,
  prepareHistory,
  onDeletePrepareEntry,
  rewriteContext,
  prepareFollowUps, setPrepareFollowUps,
  showReferenceNotes, setShowReferenceNotes,
  loading,
  remainingCount,
  submitDisabled,
  onSubmit, onSaveDraft, onResetForm,
  inputSectionRef,
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
            placeholder="〇〇大学"
          />
        </div>
        <div>
          <Label>学部名</Label>
          <Input
            value={faculty}
            onChange={(e) => setFaculty(e.target.value)}
            placeholder="〇〇学部"
          />
        </div>
        <div className="sm:col-span-2">
          <Label>学科名（任意）</Label>
          <Input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="〇〇学科"
          />
        </div>
      </div>

      {/* STEP 21: PC は 2 カラム（左：参考メモ、右：本文入力）／モバイルは従来通り縦並び。
          STEP 22: 参考メモは showReferenceNotes で表示切替。隠すと右カラムが幅を全取りする。 */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {mounted && showReferenceNotes && (rewriteContext !== null || prepareHistory.length > 0 || prepareSummary !== null || Object.values(prepareFollowUps).some((v) => (v ?? '').trim().length > 0)) && (
        <aside className="space-y-6 lg:basis-2/5 lg:shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
      {/* STEP4-2: ④ → ② への書き直し対象の参考メモ。左サイド最上部に置き、
          書き直し中であることを明示する。本文 textarea には mount-init で 1 回 prefill 済み。 */}
      {mounted && rewriteContext !== null && (
        <RewriteContextCard entry={rewriteContext} />
      )}

      {/* STEP-WORK-3: rewriteMemo.workAnswers を read-only bullet として表示する。
          source は rewrite/[id] で書いた axisKey × questionKey の string map。
          ここでは AI summary を作らず、render-time に「軸 → 質問 → 回答」へ derive するだけ。
          回答 0 件なら card 自体を出さない（rewrite/[id] への動線は上の RewriteContextCard 参照）。 */}
      {mounted && rewriteContext !== null && (
        <RewriteWorkSummaryCard entry={rewriteContext} />
      )}

      {/* ① 大学軸 prepare の履歴一覧（最新が先頭）。1 件以上あればここを優先表示し、
          下の旧 prepareSummary 単体 Card は履歴 0 件時の fallback として残す。
          本文 textarea には自動挿入しない（PASSAI 思想: AI が代筆しない）。 */}
      {mounted && prepareHistory.length > 0 && (
        <Card className="bg-blue-50 border-blue-100">
          <h3 className="text-sm font-bold text-blue-900 mb-1">整理メモ履歴</h3>
          <p className="text-xs text-blue-700/80 mb-4 leading-relaxed">
            大学ごとに作った整理メモを参照できます。クリックで展開します。
          </p>
          <ul className="space-y-2">
            {prepareHistory.map((entry) => (
              <li key={entry.id}>
                <PrepareHistoryEntryDetails
                  entry={entry}
                  onDelete={() => onDeletePrepareEntry(entry.id)}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* STEP 20 / 互換 fallback: 履歴が 0 件の時だけ、旧 prepareSummary（最新 1 枚）を従来通り表示する。
          履歴 1 件以上なら history[0].summary がここと同等なので二重表示を避ける。 */}
      {mounted && prepareHistory.length === 0 && prepareSummary && (
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
                整理メモへの追記
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
                追記を消す
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
          {/* STEP 22: 参考メモが存在するときだけトグルを出す（無いときは閉じる対象も無い）。
              履歴 1 件以上でも左サイドに表示物があるのでトグル対象に含める。
              STEP4-2: rewriteContext がある場合もトグル対象。 */}
          {mounted && (rewriteContext !== null || prepareHistory.length > 0 || prepareSummary !== null || Object.values(prepareFollowUps).some((v) => (v ?? '').trim().length > 0)) && (
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => setShowReferenceNotes((v) => !v)}
                className="text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2"
              >
                {showReferenceNotes ? '整理素材を隠す' : '整理素材を見る'}
              </button>
            </div>
          )}
      <div className="mb-6">
        <Label>志望理由書本文</Label>
        <Textarea
          value={statementText}
          onChange={(e) => setStatementText(e.target.value)}
          rows={12}
          placeholder={`志望理由書の本文を貼り付けてください。\n\n例：\n私が○○大学△△学部を志望する理由は…`}
          className="leading-relaxed resize-y"
        />
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

// ── 左サイド欄の履歴 1 件分 ───────────────────────────────────────
// 閉じた状態: 大学名 / 学部 / 学科 / 作成日。
// 開いた状態: summary 5 項目 + 回答ありの question[] + 削除ボタン（footer）。
// 本文 textarea には自動挿入しない（参考情報として表示するだけ）。
// 削除ボタンは details の expanded body 内（最下部）に置く。
//   - summary（header）に置くと <details> の toggle と click が干渉するため避ける
//   - 展開してから削除する流れになり、ユーザーが内容を確認してから消す safety にもなる
function PrepareHistoryEntryDetails({
  entry,
  onDelete,
}: {
  entry: UniversityPrepareEntry;
  onDelete: () => void;
}) {
  const filledQuestions = entry.questions.filter(
    (q) => q.answer.trim().length > 0,
  );
  return (
    <details className="group bg-white rounded-lg border border-blue-100">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">
            {entry.university || '（大学未入力）'}
            {entry.faculty ? `　${entry.faculty}` : ''}
            {entry.department ? `　${entry.department}` : ''}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-[11px] text-slate-400 tabular-nums">
            {formatHistoryDate(entry.createdAt)}
          </span>
          <span className="text-slate-400 transition-transform group-open:rotate-180 inline-block">
            ▾
          </span>
        </div>
      </summary>
      <div className="px-3 pb-3 pt-1 border-t border-blue-50">
        <section className="mb-3">
          <h4 className="text-[11px] font-bold text-blue-900 mb-2">整理メモ</h4>
          <ol className="space-y-2 list-none">
            {PREPARE_SUMMARY_FIELDS.map(({ key, label }) => (
              <li key={key}>
                <p className="text-[11px] font-semibold text-blue-900 mb-0.5">
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
            <h4 className="text-[11px] font-bold text-blue-900 mb-2">
              質問と回答
            </h4>
            <ol className="space-y-2 list-none">
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
        <div className="mt-3 pt-3 border-t border-blue-50 flex justify-end">
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
          >
            この整理メモを削除
          </button>
        </div>
      </div>
    </details>
  );
}

function formatHistoryDate(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}/${m}/${day}`;
}

// ── 書き直し対象の breadcrumb Card ─────────────────────────────
// ④ /statement/improve の「この内容をもとに書き直す」CTA から
// ?rewriteFrom=<id> 経由で来た場合に、左サイド最上部で「いま何を書き直しているか」
// を示すだけの軽量カード。本文 textarea は page.tsx 側で mount-init に prefill 済み。
// 改善ポイント / 詳細分析の中身は /statement/improve/analysis/[id] に責務集約済みのため、
// ここからは link で誘導するだけにして edit を「執筆する場」に寄せる。
// improve flow 内なので戻り先は improve 専用 analysis（view-only の
// /statement/analysis/[id] には飛ばさない、STEP-IA-1）。
// 同様に「書き直し方針メモ」も /statement/improve/rewrite/[id] に責務集約済みで、
// 当 Card では inline 表示せず memo が存在する時だけ link を露出する。
function RewriteContextCard({
  entry,
}: {
  entry: ReviewHistoryItem;
}) {
  // memo の有無だけ確認する。本文はここに出さない（edit を「考える画面」に戻さないため）。
  // 親（InputFormView）が `mounted && rewriteContext !== null` でゲートしているため
  // SSR / hydration 期にこの Card は描画されない。useMemo の同期 read は安全。
  //
  // STEP-WORK-4: rewriteMemo は v2 で text と workAnswers の 2 つの artifact を持つため、
  // 「record が存在するか」ではなく「text/workAnswers のどちらかに中身があるか」で
  // 「書き直し準備を編集する →」link を出すよう責務を分離。
  // 表示文言も「方針メモ」→「書き直し準備」に一般化（workAnswers も対象に含む）。
  const { hasTextMemo, hasWorkAnswers } = useMemo(() => {
    const record = loadRewriteMemo(entry.id);
    return {
      hasTextMemo: (record?.text ?? '').trim().length > 0,
      hasWorkAnswers: hasAnyWorkAnswer(record?.workAnswers),
    };
  }, [entry.id]);
  const hasRewriteArtifact = hasTextMemo || hasWorkAnswers;
  return (
    <Card className="bg-violet-50 border-violet-100">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="text-sm font-bold text-violet-900">
          前回の分析（書き直し対象）
        </h3>
        <span className="shrink-0 text-base font-bold text-violet-700 tabular-nums leading-none mt-0.5">
          {entry.result.overallScore}
          <span className="text-[10px] font-normal ml-0.5">/100</span>
        </span>
      </div>
      <p className="text-xs text-violet-700/80 mb-3 leading-relaxed">
        {entry.university || '（大学未入力）'}
        {entry.faculty ? `　${entry.faculty}` : ''}
        {entry.department ? `　${entry.department}` : ''}
      </p>
      <LinkButton
        href={`/statement/improve/analysis/${encodeURIComponent(entry.id)}`}
        variant="primary"
        size="sm"
        className="w-full"
      >
        改善レポートを見る →
      </LinkButton>
      {hasRewriteArtifact && (
        <LinkButton
          href={`/statement/improve/rewrite/${encodeURIComponent(entry.id)}`}
          variant="secondary"
          size="sm"
          className="w-full mt-2"
        >
          📝 書き直し準備を編集する →
        </LinkButton>
      )}
    </Card>
  );
}

// ── 今回直すこと（workAnswers の read-only 表示）─────────────────
// rewrite/[id] で書いた axisKey × questionKey の自由回答を、本文を書きながら
// 参照する read-only パネルとして表示する。edit を「執筆する場」に寄せる方針上、
// このパネルは表示専用 — 編集導線は rewrite/[id] へのインライン link のみ持つ。
//
// source: rewriteMemo.workAnswers
// derive: render-time（deriveRewriteWorkSections に切り出し済み）。
//   AI summary や snapshot は保存しない（analysis = master 方針）。
//
// STEP-WORK-4:
//   - 表示崩れ対策で 1 回答に max-h + 自動スクロール + break-words を入れる
//     （ペーストされた極端な長文 / URL も左カラムを壊さない）
//   - 空 state（回答 0 件）の時は card を完全に隠さず、薄い案内に切り替えて
//     rewrite/[id] への導線を保つ。edit 側で入力させない方針は維持。
//
// 親（InputFormView）が `mounted && rewriteContext !== null` でゲートしているため
// SSR / hydration 期にこの Card は描画されない。useMemo の同期 read は安全。
function RewriteWorkSummaryCard({ entry }: { entry: ReviewHistoryItem }) {
  const sections = useMemo(() => {
    const workAnswers = loadRewriteMemo(entry.id)?.workAnswers;
    return deriveRewriteWorkSections(entry, workAnswers);
  }, [entry]);

  const rewriteHref = `/statement/improve/rewrite/${encodeURIComponent(entry.id)}`;

  if (sections.length === 0) {
    return (
      <Card className="bg-violet-50/60 border-violet-100">
        <h3 className="text-sm font-bold text-violet-900 mb-1">今回直すこと</h3>
        <p className="text-xs text-violet-700/80 mb-3 leading-relaxed">
          まだ改善ポイント別ワークの回答がありません。書き直し準備で、本文に入れる素材を整理できます。
        </p>
        <Link
          href={rewriteHref}
          className="text-xs text-violet-700 hover:text-violet-900 underline underline-offset-2"
        >
          書き直し準備を開く →
        </Link>
      </Card>
    );
  }

  return (
    <Card className="bg-violet-50 border-violet-100">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="text-sm font-bold text-violet-900">今回直すこと</h3>
        <Link
          href={rewriteHref}
          className="shrink-0 text-[11px] text-violet-700/80 hover:text-violet-900 underline underline-offset-2"
        >
          編集 →
        </Link>
      </div>
      <p className="text-xs text-violet-700/80 mb-4 leading-relaxed">
        書き直し準備で書いた素材です。執筆中の参考として読んでください。
      </p>
      <ul className="space-y-4 list-none">
        {sections.map((sec) => (
          <li key={sec.axisKey}>
            <p className="text-[12px] font-bold text-violet-900 mb-1.5">
              ● {sec.label}
            </p>
            <ul className="space-y-1.5 list-none pl-3">
              {sec.filled.map((q) => (
                <li
                  key={q.key}
                  className="text-sm text-slate-700 leading-relaxed break-words"
                >
                  <span className="font-semibold text-violet-900/80">
                    {q.label}：
                  </span>
                  <span className="whitespace-pre-wrap break-words block max-h-40 overflow-y-auto">
                    {q.answer}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Card>
  );
}
