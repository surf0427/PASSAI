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
// NOTE: TYPE_FEEDBACK の本文は新 4 タイプ名（活動アピール/探究・研究/将来
// ビジョン/成長ポテンシャル）を直接埋め込む。旧 diagnosis_result の
// resultTitle（「何から始めるか整理タイプ」等の旧名称）は表示に使わない。

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

type Feedback = {
  summary: string;
  strengths: string;
  caution: string;
  nextStep: string;
  ctaHref: string;
  ctaLabel: string;
};

const TYPE_FEEDBACK: Record<DiagnosisType, Feedback> = {
  1: {
    summary: '今回の内容からは、「活動アピール型」に近い特徴が見えます。',
    strengths:
      '経験や行動を材料にしやすく、面接や志望理由書でも具体例を出しやすい点が強みとして見えます。',
    caution:
      '一方で、活動の説明だけで終わらず、そこから何を学んだか・大学での学びにどうつなげるかまで整理できると、さらに説得力が増していきます。',
    nextStep: '次は「活動整理」で材料を深めていくのがおすすめです。',
    ctaHref: '/input/activity',
    ctaLabel: '活動整理を進める',
  },
  2: {
    summary: '今回の内容からは、「探究・研究型」に近い特徴が見えます。',
    strengths:
      '問題意識や興味関心を軸にしやすく、学部・学科との相性を示しやすい点が強みとして見えます。',
    caution:
      '一方で、興味が抽象的なままだと弱く見えやすいので、調べたこと・考えたことを具体化していくと、より深さが伝わります。',
    nextStep:
      '次は「自己分析」で「なぜ学びたいか」を言語化していくのがおすすめです。',
    ctaHref: '/self-analysis',
    ctaLabel: '自己分析を進める',
  },
  3: {
    summary: '今回の内容からは、「将来ビジョン型」に近い特徴が見えます。',
    strengths:
      '志望理由に一貫性を出しやすく、将来像から逆算して話を組み立てられる点が強みとして見えます。',
    caution:
      '一方で、将来の夢だけで終わらせず、きっかけや根拠を具体化し、大学での学びとの接続を明確にしていくと、さらに説得力が増します。',
    nextStep:
      '次は「志望理由書」で将来像と大学での学びをつなげていくのがおすすめです。',
    ctaHref: '/statement',
    ctaLabel: '志望理由書に進む',
  },
  4: {
    summary: '今回の内容からは、「成長ポテンシャル型」に近い特徴が見えます。',
    strengths:
      '変化や努力の過程を材料にしやすく、これから伸びる理由を伝えやすい点が強みとして見えます。',
    caution:
      '一方で、「頑張ります」だけで終わらせず、過去の変化や行動を具体化し、今後の挑戦を大学での学びにつなげていくと、より説得力が増します。',
    nextStep:
      '次は「自己分析」で変化や伸びしろを言葉にしていくのがおすすめです。',
    ctaHref: '/self-analysis',
    ctaLabel: '自己分析を進める',
  },
};

// currentHref が ctaHref と一致するときに nextStep を差し替える汎用文。
// /self-analysis 以外で再利用される可能性もあるため、ページ名を含めない言い回し。
const SELF_REFERENCE_NEXT_STEP =
  '今このページで進めている内容を、引き続き丁寧に深めていくのがおすすめです。';

// 保存データが壊れていてもクラッシュしないよう、必要 field を最低限ガード
function isResultUsable(r: DiagnosisResult): boolean {
  const t = r.resultType;
  if (t !== 1 && t !== 2 && t !== 3 && t !== 4) return false;
  if (typeof r.resultTitle !== 'string' || !r.resultTitle.trim()) return false;
  if (typeof r.resultDescription !== 'string') return false;
  return true;
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
    | { type: DiagnosisType; source: 'diagnosis'; createdAt: string }
    | null
  >(() => {
    if (!isMounted) return null;

    // 1) self-analysis summary から推定（最優先）
    const analyzeState = loadAnalyzeState();
    const summary = analyzeState?.summary;
    if (summary) {
      const inferred = inferAnalysisType(summary);
      if (inferred) return { type: inferred.type, source: 'self-analysis' };
    }

    // 2) 旧 diagnosis_result を fallback
    const diag: DiagnosisResult | null = loadDiagnosisResult();
    if (diag && isResultUsable(diag)) {
      return {
        type: diag.resultType,
        source: 'diagnosis',
        createdAt: diag.createdAt,
      };
    }

    // 3) どちらも無い → PromoCard
    return null;
  }, [isMounted]);

  if (!isMounted) return null;
  if (!resolved) return <PromoCard />;

  const feedback = TYPE_FEEDBACK[resolved.type];
  // 「診断日」は /diagnosis 経由のときだけ表示する。summary 推定経由では
  // 「診断」という言葉が文脈にそぐわないため非表示。
  const dateStr =
    resolved.source === 'diagnosis' ? formatDate(resolved.createdAt) : '';
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
