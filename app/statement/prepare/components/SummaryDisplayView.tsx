// STEP8.6/8.7: 志望理由書 prepare 画面の整理メモ表示 view。
//   STEP8.6 で page.tsx 内 top-level function として logical split、STEP8.7 で
//   feature-local component file として physical split。
//   state ownership / hook ownership は page.tsx 側に維持。本 view は props を受け取って
//   render するだけの pure-ish 関数。
//   summary が null のときは page-level gate により呼ばれないため、props は non-null 前提。
//   page 内 helper / 表示用 const / 型のうち本 view 専用のものは同居:
//     - DisplaySummary 型 (page state でも使用するため export)
//     - FollowUpAnswers 型 (page state でも使用するため export)
//     - SUMMARY_FIELDS / WEAK_POINT_SEVERITY / QUALITY_LEVEL_DISPLAY / FOLLOW_UP_PLACEHOLDERS
//     - formatSavedAt
//   shared 化はまだしない（statement-prepare 専用 view の domain 内に閉じる）。

import { Card } from '@/components/ui/Card';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import {
  getStatementPrepareFollowUpQuestions,
  STATEMENT_PREPARE_FOLLOW_UP_LABELS,
  type StatementPrepareWeakPoint,
  type StatementPrepareWeakPointKey,
  type StatementPrepareWeakPointSeverity,
} from '@/lib/statement/prepare/detectStatementPrepareWeakPoints';
import type { StatementPrepareLogicGap } from '@/lib/statement/prepare/detectStatementPrepareLogicGaps';
import type {
  StatementPrepareQualityEvaluation,
  StatementPrepareQualityLevel,
} from '@/lib/statement/prepare/evaluateStatementPrepareQuality';
import {
  getFacultyCategoryCheckpoints,
  getFacultyCategoryLabel,
  type FacultyCategory,
} from '@/lib/facultyCategory';
import {
  getStatementDraftStructureGuide,
  getStatementDraftStructureSummaryKeyLabel,
} from '@/lib/statement/prepare/getStatementDraftStructureGuide';
// STEP9.3: DisplaySummary 型は lib 側に ownership 移動。本 view からは re-export して
//   page.tsx の既存 import path (`./components/SummaryDisplayView`) を維持する。
export type { DisplaySummary } from '@/lib/statement/prepare/cachedSummaryToDisplay';
import type { DisplaySummary } from '@/lib/statement/prepare/cachedSummaryToDisplay';

// STEP 16: 深掘りメモ。永続化しないので localStorage は使わない（ページ更新で消える前提）。
export type FollowUpAnswers = Partial<Record<StatementPrepareWeakPointKey, string>>;

const SUMMARY_FIELDS: Array<{
  key: keyof DisplaySummary;
  label: string;
}> = [
  { key: 'impressiveExperience', label: '印象に残った経験' },
  { key: 'feltIssue',            label: 'その経験から感じたこと・問題意識' },
  { key: 'interestInField',      label: 'なぜその分野・学部に興味を持ったか' },
  { key: 'universityLearning',   label: '大学で深めたいこと' },
  { key: 'futureApplication',    label: '将来どう活かしたいか' },
];

// STEP 14: 弱点バッジ用ラベル＆スタイル。
const WEAK_POINT_SEVERITY: Record<
  StatementPrepareWeakPointSeverity,
  { label: string; className: string }
> = {
  high:   { label: '優先度高', className: 'bg-red-100 text-red-700 border border-red-200' },
  medium: { label: '優先度中', className: 'bg-yellow-100 text-yellow-700 border border-yellow-200' },
  low:    { label: '優先度低', className: 'bg-slate-100 text-slate-700 border border-slate-200' },
};

// STEP 28: 仕上がり評価のラベル。数字スコア化はしない（◎ / ○ / △）。
const QUALITY_LEVEL_DISPLAY: Record<
  StatementPrepareQualityLevel,
  { mark: string; label: string; className: string }
> = {
  good:      { mark: '◎', label: '良好',     className: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  normal:    { mark: '○', label: 'まずまず', className: 'bg-blue-100 text-blue-700 border border-blue-200' },
  needsWork: { mark: '△', label: '要改善',   className: 'bg-yellow-100 text-yellow-700 border border-yellow-200' },
};

// STEP 16: 弱点 key ごとの回答 textarea placeholder。
const FOLLOW_UP_PLACEHOLDERS: Record<StatementPrepareWeakPointKey, string> = {
  experience:         'その経験で自分が実際に行動したことを書いてみましょう',
  issue:              '気づいた課題や違和感を書いてみましょう',
  interest:           'その分野に興味を持ったきっかけを書いてみましょう',
  universityLearning: '大学で特に学びたいことを書いてみましょう',
  future:             '将来やりたいことや、届けたい価値を書いてみましょう',
};

// STEP 31: 保存日時 ISO → 「YYYY/M/D HH:MM」表示に整形。失敗時は空文字。
function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${h}:${min}`;
}

export type SummaryDisplayViewProps = {
  summary: DisplaySummary;
  reusedFromCache: boolean;
  viewingSavedSummary: boolean;
  summarySignature: string;
  currentInputSignature: string;
  savedSummaryMeta: { updatedAt: string } | null;
  qualityEvaluation: StatementPrepareQualityEvaluation | null;
  facultyCategory: FacultyCategory;
  weakPoints: StatementPrepareWeakPoint[] | null;
  logicGaps: StatementPrepareLogicGap[] | null;
  filledFollowUpAnswers: Array<{ key: StatementPrepareWeakPointKey; value: string }>;
  followUpAnswers: FollowUpAnswers;
  onFollowUpAnswerChange: (key: StatementPrepareWeakPointKey, value: string) => void;
  inputChanged: boolean;
  draftDisabled: boolean;
  onStartDraft: () => void;
};

export function SummaryDisplayView({
  summary,
  reusedFromCache,
  viewingSavedSummary,
  summarySignature,
  currentInputSignature,
  savedSummaryMeta,
  qualityEvaluation,
  facultyCategory,
  weakPoints,
  logicGaps,
  filledFollowUpAnswers,
  followUpAnswers,
  onFollowUpAnswerChange,
  inputChanged,
  draftDisabled,
  onStartDraft,
}: SummaryDisplayViewProps) {
  return (
    <section id="summary-result" className="mb-10">
      {reusedFromCache && (
        <p className="text-xs text-slate-500 mb-3 flex items-center gap-1">
          <span aria-hidden>↺</span>
          前回と同じ入力のため、保存済みの整理結果を表示しています。
        </p>
      )}

      {/* STEP 31: 「以前作った整理メモを見る」ボタンで復元したときの注記。 */}
      {viewingSavedSummary && (
        <AlertBox variant="info" className="mb-3">
          {summarySignature !== '' && summarySignature === currentInputSignature
            ? '現在の入力内容から作成された整理メモです。'
            : '以前の入力内容から作成された整理メモです。必要なら現在の入力で再生成できます。'}
          {savedSummaryMeta && (
            <span className="block text-xs mt-1 text-blue-900/70">
              保存日時：{formatSavedAt(savedSummaryMeta.updatedAt)}
            </span>
          )}
        </AlertBox>
      )}

      <AlertBox variant="info" className="mb-4">
        これは“走り書きメモ”の形です。完成文ではありません。次のステップで AI が書き換えるのではなく、
        <strong className="font-semibold">この整理を見ながら、自分の言葉で下書きを作ってみましょう</strong>。
      </AlertBox>

      <Card className="mb-6">
        <h2 className="text-lg font-bold text-slate-900 mb-1">整理メモ</h2>
        <p className="text-xs text-slate-500 mb-4">
          志望理由書の流れ（経験 → 問題意識 → 学部興味 → 大学で深める → 将来）に沿って整理しています。
        </p>
        <ol className="space-y-4 list-none">
          {SUMMARY_FIELDS.map(({ key, label }, i) => (
            <li key={key} className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-700 mb-1">
                  {label}
                </p>
                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                  {summary[key]}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {/* STEP 28: 整理の仕上がり評価（◎ / ○ / △）。weakPoints / logicGaps を再利用。 */}
      {qualityEvaluation !== null && (
        <Card className="mb-6">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h3 className="text-base font-bold text-slate-900">
              整理の仕上がり
            </h3>
            <span
              className={`shrink-0 self-start rounded-full px-2 py-0.5 text-xs font-semibold ${
                QUALITY_LEVEL_DISPLAY[qualityEvaluation.overallLevel].className
              }`}
              aria-label={`総合評価：${QUALITY_LEVEL_DISPLAY[qualityEvaluation.overallLevel].label}`}
            >
              総合 {QUALITY_LEVEL_DISPLAY[qualityEvaluation.overallLevel].mark}{' '}
              {QUALITY_LEVEL_DISPLAY[qualityEvaluation.overallLevel].label}
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            下書きに進む前に、材料の整い具合を確認できます。
          </p>
          <ul className="space-y-2">
            {qualityEvaluation.items.map((item) => {
              const display = QUALITY_LEVEL_DISPLAY[item.level];
              return (
                <li
                  key={item.key}
                  className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3"
                >
                  <span
                    className={`shrink-0 self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${display.className}`}
                    aria-label={`${item.label}：${display.label}`}
                  >
                    {display.mark} {item.label}
                  </span>
                  <p className="flex-1 text-sm text-slate-600 leading-relaxed">
                    {item.message}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* STEP 29: 学部系統別の確認ポイント（API には送らず、UI 上のヒントのみ）。 */}
      <Card className="mb-6">
        <h3 className="text-base font-bold text-slate-900 mb-1">
          学部系統別の確認ポイント
        </h3>
        <p className="text-xs text-slate-500 mb-3 leading-relaxed">
          選んだ学部系統に合わせて、志望理由書で意識したい観点です。
        </p>
        <p className="text-xs text-slate-700 mb-2">
          <span className="font-semibold">学部系統：</span>
          {getFacultyCategoryLabel(facultyCategory)}
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 leading-relaxed">
          {getFacultyCategoryCheckpoints(facultyCategory).map((cp) => (
            <li key={cp}>{cp}</li>
          ))}
        </ul>
      </Card>

      {/* STEP 30: 下書きの構成ガイド。AI を呼ばず固定テンプレを学部系統で出し分け。
          本文 textarea への自動挿入は行わない。 */}
      {(() => {
        const guide = getStatementDraftStructureGuide(facultyCategory);
        return (
          <Card className="mb-6">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              下書きの構成ガイド
            </h3>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
              AIが本文を書くのではなく、あなたが書く順番を整理するためのガイドです。
            </p>
            <p className="text-xs text-slate-700 mb-4">
              <span className="font-semibold">{guide.title}：</span>
              {guide.description}
            </p>
            <ol className="space-y-3 list-none">
              {guide.steps.map((step, i) => (
                <li key={step.title} className="flex gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-700 mb-0.5">
                      {step.title}
                    </p>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {step.description}
                    </p>
                    {step.useSummaryKeys.length > 0 && (
                      <p className="text-xs text-slate-500 mt-1">
                        <span className="font-semibold">参考にする整理メモ：</span>
                        {step.useSummaryKeys
                          .map((k) => getStatementDraftStructureSummaryKeyLabel(k))
                          .join(' / ')}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        );
      })()}

      {/* STEP 14: 深掘りできるポイント／OK 表示 */}
      {weakPoints !== null && weakPoints.length > 0 && (
        <Card className="mb-6">
          <h3 className="text-base font-bold text-slate-900 mb-1">
            もう少し深掘りできるポイント
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            下書きに進む前に、以下の項目を見直すと志望理由書の材料が厚くなります。
          </p>
          <ul className="space-y-3">
            {weakPoints.map((wp) => {
              const sev = WEAK_POINT_SEVERITY[wp.severity];
              const questions = getStatementPrepareFollowUpQuestions(wp.key);
              return (
                <li
                  key={wp.key}
                  className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3"
                >
                  <span
                    className={`shrink-0 self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${sev.className}`}
                  >
                    {sev.label}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-700">
                      {wp.label}
                    </p>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {wp.reason}
                    </p>
                    {/* STEP 15: 固定の深掘り質問。回答欄は STEP 16 で追加。 */}
                    <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-xs font-semibold text-slate-500 mb-1">
                        考えてみる質問
                      </p>
                      <ul className="list-disc pl-5 space-y-1 text-xs text-slate-600 leading-relaxed">
                        {questions.map((q) => (
                          <li key={q}>{q}</li>
                        ))}
                      </ul>
                    </div>
                    {/* STEP 16: 自由記述の回答欄（永続化なし）。 */}
                    <div className="mt-3">
                      <Label htmlFor={`followup-${wp.key}`}>
                        考えたことをメモする
                      </Label>
                      <Textarea
                        id={`followup-${wp.key}`}
                        value={followUpAnswers[wp.key] ?? ''}
                        onChange={(e) =>
                          onFollowUpAnswerChange(wp.key, e.target.value)
                        }
                        rows={3}
                        placeholder={FOLLOW_UP_PLACEHOLDERS[wp.key]}
                        className="resize-y"
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {weakPoints !== null && weakPoints.length === 0 && (
        <AlertBox variant="success" className="mb-4">
          整理内容は下書きに進める状態です。
        </AlertBox>
      )}

      {/* STEP 27: つながり（経験→課題→興味→大学→将来）の簡易判定結果。 */}
      {logicGaps !== null && logicGaps.length > 0 && (
        <Card className="mb-6">
          <h3 className="text-base font-bold text-slate-900 mb-1">
            つながりを強くできる部分
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            志望理由書では、経験・課題意識・学びたいこと・将来像がつながっていることが大切です。
          </p>
          <ul className="space-y-3">
            {logicGaps.map((gap) => {
              const sev = WEAK_POINT_SEVERITY[gap.severity];
              return (
                <li
                  key={gap.key}
                  className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3"
                >
                  <span
                    className={`shrink-0 self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${sev.className}`}
                  >
                    {sev.label}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-700">
                      {gap.label}
                    </p>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {gap.reason}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      <span className="font-semibold">改善のヒント：</span>
                      {gap.suggestion}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {logicGaps !== null && logicGaps.length === 0 && (
        <AlertBox variant="success" className="mb-4">
          整理内容の流れは大きく崩れていません。
        </AlertBox>
      )}

      {/* STEP 17: 深掘り回答がある場合だけ「追加メモ」を表示。summary には merge しない。 */}
      {filledFollowUpAnswers.length > 0 && (
        <Card className="mb-6">
          <h3 className="text-base font-bold text-slate-900 mb-1">
            下書きに活かせる追加メモ
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            深掘りで書いた内容です。下書きを書くときに、この内容も参考にしてください。
          </p>
          <ol className="space-y-3 list-none">
            {filledFollowUpAnswers.map(({ key, value }) => (
              <li key={key}>
                <p className="text-sm font-semibold text-slate-700 mb-1">
                  {STATEMENT_PREPARE_FOLLOW_UP_LABELS[key]}
                </p>
                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                  {value}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {inputChanged && (
        <AlertBox variant="warning" className="mb-4">
          入力内容が変更されています。最新の内容で整理し直してから下書きに進んでください。
        </AlertBox>
      )}

      <div className="text-center">
        <Button
          variant="primary"
          size="md"
          className="w-full sm:w-auto"
          onClick={onStartDraft}
          disabled={draftDisabled}
        >
          {inputChanged
            ? '再整理してから下書きへ進む'
            : 'この整理をもとに下書きを書く →'}
        </Button>
      </div>
    </section>
  );
}
