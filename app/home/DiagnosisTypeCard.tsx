'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { LinkButton } from '@/components/ui/LinkButton';
import {
  loadDiagnosisResult,
  type DiagnosisResult,
} from '@/lib/diagnosisStorage';
import { loadAnalyzeState } from '@/lib/analyzeStorage';
import { inferAnalysisType } from '@/lib/analysis/inferAnalysisType';
import type { DiagnosisType } from '@/types/diagnosis';
import { isExamType, type ExamType } from '@/types/examDiagnosis';
import {
  TYPE_FEEDBACK,
  DIAGNOSIS_FEEDBACK,
  EXAM_DIAGNOSIS_FEEDBACK,
  SELF_REFERENCE_NEXT_STEP,
} from '@/app/home/diagnosisFeedback';

// マウント前 false / マウント後 true を返す flag。
// loadDiagnosisResult() は localStorage 依存のため SSR では null を返したい。
// useSyncExternalStore の getServerSnapshot/getSnapshot で setState なしにこの semantics を表現する。
// （STEP9 hooks/useActivityForm.ts / STEP10 app/interview/page.tsx と同形パターン）
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// ── 受験タイプ「AI 分析コメント」カード ──────────────────────────
// 自己分析 summary（あれば）から軽量ルールベースで受験タイプを推定し、
// 「強み・注意点・次の一歩」を 1 つの自然な文章として返す。診断カード感を
// 抑え、塾講師/受験コンサルが書いたコメントとして読めるトーンに揃える。
//
// タイプ解決の優先順位:
//   1) /self-analysis の summary から inferAnalysisType() で推定（最優先）
//   2) /diagnosis の旧結果（passai_diagnosis_result）を fallback
//   3) どちらも無い／無効なら PromoCard で診断へ誘導
// → 自己分析をやり直すと、その内容に合わせてタイプ表示が自動更新される。
//
// 利用箇所: /home、/self-analysis（活動まとめ直後）。
// 呼び出し側は <DiagnosisTypeCard /> を 1 行差し込むだけで動く設計。
//
// 自分自身のページに戻す CTA を抑制したい場合は currentHref を渡す。
// 一致した場合：CTA リンク非表示 + 締めの一文を「このページで進めましょう」系に
// 差し替え。本文（強み・注意点）はそのまま残す。
//
// タクソノミー分離（R12 対策・重要）:
//   DiagnosisType（1|2|3|4）という同じ番号が、来歴によって別の意味を持つ。
//     - self-analysis 由来（inferAnalysisType）: 1 活動アピール / 2 探究・研究 /
//       3 将来ビジョン / 4 成長ポテンシャル  → TYPE_FEEDBACK を参照。
//     - /diagnosis 由来（passai_diagnosis_result の resultType）: 1 整理 /
//       2 言語化 / 3 書類完成度 / 4 一般受験並行  → DIAGNOSIS_FEEDBACK を参照。
//   番号が同じでも意味が違うため、番号変換ではなく「表示定義そのものを来歴で
//   出し分ける」（Option B）。resolved.source で feedback テーブルを切り替える。
//   どちらの経路でも保存形式（resultType の数値）には触れない。
//
// NOTE: 本文は各 4 タイプの説明文を直接埋め込む。diagnosis_result の
// resultTitle（「何から始めるか整理タイプ」等）は表示に使わず、DIAGNOSIS_FEEDBACK
// 側の文言を正とする（resultTitle は保存値の互換のため残すが描画はしない）。

type DiagnosisTypeCardProps = {
  // 現在表示中のページ pathname。TYPE_FEEDBACK の ctaHref がこれと一致する
  // CTA は、自分自身への誘導になるため抑制する。
  // 省略時（/home など）は CTA を常に表示する。
  currentHref?: string;
  // 'card'（既定）: 独立カードとして表示（/home 用）。
  // 'inline':       outer wrapper の枠/背景/影/余白を外し、
  //                 SummarySection の続きとして読める軽量表示（/self-analysis 用）。
  //                 診断日も非表示にする。ロジック（CTA 抑制・本文）は共通。
  variant?: 'card' | 'inline';
};

// 表示文言（TYPE_FEEDBACK / DIAGNOSIS_FEEDBACK / SELF_REFERENCE_NEXT_STEP）は
// @/app/home/diagnosisFeedback に集約。番号→意味の対応はそちらが正本。

// 保存データが壊れていてもクラッシュしないよう、必要 field を最低限ガード。
// resultType は legacy（number 1-4）/ 9タイプ（ExamType 文字列）の 2 系統を取り得る。
function hasUsableShape(r: DiagnosisResult): boolean {
  if (typeof r.resultTitle !== 'string' || !r.resultTitle.trim()) return false;
  if (typeof r.resultDescription !== 'string') return false;
  return true;
}
function isLegacyResult(r: DiagnosisResult): boolean {
  const t = r.resultType;
  return (t === 1 || t === 2 || t === 3 || t === 4) && hasUsableShape(r);
}
function isExamResult(r: DiagnosisResult): boolean {
  return isExamType(r.resultType) && hasUsableShape(r);
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function DiagnosisTypeCard({
  currentHref,
  variant = 'card',
}: DiagnosisTypeCardProps = {}) {
  const isInline = variant === 'inline';
  // hydration mismatch 回避：マウント前は何も描画しない。
  // マウント後に loadDiagnosisResult() を 1度だけ呼んで以降は memo 値を返す。
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // タイプ解決：summary 推定優先 → diagnosis_result fallback。
  // どちらも無いときは null を返し、後段で PromoCard へ落とす。
  // 「診断日」は diagnosis_result 経由のときのみ意味があるので、
  // source を分けて createdAt を持たせる。
  const resolved = useMemo<
    | { type: DiagnosisType; source: 'self-analysis' }
    | { type: DiagnosisType; source: 'diagnosis-legacy'; createdAt: string }
    | { type: ExamType; source: 'diagnosis-exam'; createdAt: string }
    | null
  >(() => {
    if (!isMounted) return null;

    // 1) self-analysis summary から推定（最優先・常に番号系 1-4）
    const analyzeState = loadAnalyzeState();
    const summary = analyzeState?.summary;
    if (summary) {
      const inferred = inferAnalysisType(summary);
      if (inferred) return { type: inferred.type, source: 'self-analysis' };
    }

    // 2) diagnosis_result を fallback（系統を resultType の型で判別）
    const diag: DiagnosisResult | null = loadDiagnosisResult();
    if (diag && isExamResult(diag)) {
      return {
        type: diag.resultType as ExamType,
        source: 'diagnosis-exam',
        createdAt: diag.createdAt,
      };
    }
    if (diag && isLegacyResult(diag)) {
      return {
        type: diag.resultType as DiagnosisType,
        source: 'diagnosis-legacy',
        createdAt: diag.createdAt,
      };
    }

    // 3) どれも無い → PromoCard
    return null;
  }, [isMounted]);

  if (!isMounted) return null;
  if (!resolved) return <PromoCard />;

  // R12 対策: 来歴ごとに別タクソノミーなので feedback テーブルを source で出し分ける。
  //   - self-analysis 由来（番号 1-4）        → TYPE_FEEDBACK
  //   - /diagnosis legacy 由来（番号 1-4）     → DIAGNOSIS_FEEDBACK
  //   - /diagnosis 9タイプ由来（ExamType 文字列）→ EXAM_DIAGNOSIS_FEEDBACK
  // 番号⇔文字列の変換はしない（保存形式に触れない）。
  let feedback;
  if (resolved.source === 'diagnosis-exam') {
    feedback = EXAM_DIAGNOSIS_FEEDBACK[resolved.type];
  } else if (resolved.source === 'diagnosis-legacy') {
    feedback = DIAGNOSIS_FEEDBACK[resolved.type];
  } else {
    feedback = TYPE_FEEDBACK[resolved.type];
  }
  // 「診断日」は /diagnosis 経由（legacy / exam）のときだけ表示する。summary 推定経由では
  // 「診断」という言葉が文脈にそぐわないため非表示。
  const dateStr =
    resolved.source === 'diagnosis-exam' || resolved.source === 'diagnosis-legacy'
      ? formatDate(resolved.createdAt)
      : '';
  const isSelfReference = feedback.ctaHref === currentHref;
  const closingText = isSelfReference
    ? SELF_REFERENCE_NEXT_STEP
    : feedback.nextStep;

  // 装飾は variant でのみ分岐し、本文・CTA・抑制ロジックは共通。
  // inline は枠/背景/影/外余白を持たず、親側の流れに溶け込む。
  const outerClass = isInline
    ? ''
    : 'mb-8 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6';

  return (
    <div className={outerClass}>
      <p className="text-xs font-semibold text-slate-500 mb-3">
        AIからの分析コメント
      </p>
      <div className="text-sm sm:text-base text-slate-800 leading-relaxed space-y-3">
        <p>{feedback.summary}</p>
        <p>{feedback.strengths}</p>
        <p>{feedback.caution}</p>
        <p>{closingText}</p>
      </div>
      {!isSelfReference && (
        <div className="mt-5">
          <Link
            href={feedback.ctaHref}
            className="inline-flex items-center text-sm font-semibold text-brand-700 hover:text-brand-800 hover:underline"
          >
            {feedback.ctaLabel}
            <span aria-hidden="true" className="ml-1">
              →
            </span>
          </Link>
        </div>
      )}
      {!isInline && dateStr && (
        <p className="mt-4 text-[11px] text-slate-400">診断日：{dateStr}</p>
      )}
    </div>
  );
}

// 診断未実施 or 結果が壊れている場合のフォールバック。
// 結果カードと違い「診断への誘導」が役割なので、accent ボタンの強さは維持する。
function PromoCard() {
  return (
    <div className="mb-8 bg-white rounded-2xl border border-brand-200 shadow-sm p-5 sm:p-6">
      <p className="text-xs font-semibold text-accent-600 mb-2">
        受験タイプ診断
      </p>
      <p className="text-base font-bold text-slate-900 mb-2 leading-relaxed">
        まずは無料診断から始めてみませんか？
      </p>
      <p className="text-sm text-slate-600 leading-relaxed mb-4">
        30秒の診断で、あなたに合った総合型・学校推薦型選抜の始め方が分かります。
      </p>
      <LinkButton
        href="/diagnosis"
        variant="accent"
        size="lg"
        className="font-bold shadow-sm"
      >
        受験タイプ診断をする
        <span aria-hidden="true" className="ml-2">
          →
        </span>
      </LinkButton>
    </div>
  );
}
