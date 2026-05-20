'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { LinkButton } from '@/components/ui/LinkButton';
import {
  loadDiagnosisResult,
  type DiagnosisResult,
} from '@/lib/diagnosisStorage';
import type { DiagnosisType } from '@/types/diagnosis';

// マウント前 false / マウント後 true を返す flag。
// loadDiagnosisResult() は localStorage 依存のため SSR では null を返したい。
// useSyncExternalStore の getServerSnapshot/getSnapshot で setState なしにこの semantics を表現する。
// （STEP9 hooks/useActivityForm.ts / STEP10 app/interview/page.tsx と同形パターン）
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// ── 「あなたの診断タイプ」カード ───────────────────────────────
// /diagnosis で localStorage に保存した結果を読み取り、タイプ別の
// 「次にやるべきこと」を提示する。診断結果が無い／壊れている場合は
// 受験タイプ診断への誘導カード（PromoCard）にフォールバックする。
//
// 利用箇所: /home 上部、および /self-analysis の活動まとめ直後。
// 呼び出し側は <DiagnosisTypeCard /> を 1 行差し込むだけで動く設計。
//
// 自分自身のページに戻す CTA を抑制したい場合は currentHref を渡す。
// FIRST_STEP / NEXT_ACTIONS の href がこれと一致する CTA はボタンを
// 出さない（first step は補足文に差し替え、next action はボタンのみ非表示）。

type ActionInfo = {
  recommend: string;
  reason: string;
  ctaLabel: string;
  ctaHref: string;
};

// タイプ別の「強み / 注意したいポイント」表示用テキスト。
// 判定ロジック・保存構造は触らず、表示時の付加情報としてのみ使う。
// 文言方針：強みは断定で背中を押し、注意点は否定にならない言い回しに揃える。
const TYPE_DETAILS: Record<
  DiagnosisType,
  { strengths: string[]; cautions: string[] }
> = {
  1: {
    strengths: [
      '経験や行動を材料にしやすい',
      '面接で具体例を出しやすい',
      '志望理由に自分らしさを入れやすい',
    ],
    cautions: [
      '活動の説明だけで終わらないようにする',
      '学びや変化まで言語化する',
      '大学での学びにつなげる',
    ],
  },
  2: {
    strengths: [
      '問題意識や興味関心を軸にしやすい',
      '学部・学科との相性を示しやすい',
      '小論文や面接で深掘りしやすい',
    ],
    cautions: [
      '興味が抽象的なままだと弱く見える',
      '調べたこと・考えたことを具体化する',
      '大学で何を深めたいかまで整理する',
    ],
  },
  3: {
    strengths: [
      '志望理由に一貫性を出しやすい',
      '将来像から逆算して話を組み立てやすい',
      '面接で意欲を伝えやすい',
    ],
    cautions: [
      '将来の夢だけで終わらせない',
      '大学での学びとの接続を明確にする',
      'きっかけや根拠を具体化する',
    ],
  },
  4: {
    strengths: [
      '変化や努力の過程を材料にしやすい',
      'これから伸びる理由を伝えやすい',
      '自己分析と相性が良い',
    ],
    cautions: [
      '「頑張ります」だけで終わらせない',
      '過去の変化や行動を具体化する',
      '今後の挑戦を大学での学びにつなげる',
    ],
  },
};

// タイプ別の「最初の一歩」専用導線。NEXT_ACTIONS とは別建てで持つ理由：
// - NEXT_ACTIONS は中長期の継続提案（既存）。FIRST_STEP は診断直後の
//   "今すぐ押せる 1 つ" を明確に名指しする役割で、見せ方も別カードにする。
// - 動線が NEXT_ACTIONS と一致する場合もあるが、type 4 のように違うこともある
//   （NEXT_ACTIONS[4] = /input/activity、FIRST_STEP[4] = /self-analysis）。
const FIRST_STEP_DETAILS: Record<
  DiagnosisType,
  {
    title: string;
    description: string;
    href: string;
    buttonLabel: string;
  }
> = {
  1: {
    title: '活動整理',
    description:
      '経験を整理すると、志望理由書や面接で使える材料が見えやすくなります。',
    href: '/input/activity',
    buttonLabel: '活動整理を始める',
  },
  2: {
    title: '自己分析',
    description:
      '興味関心や問題意識を言葉にしていくと、「なぜ学びたいか」が深まります。',
    href: '/self-analysis',
    buttonLabel: '自己分析を始める',
  },
  3: {
    title: '志望理由書',
    description:
      '将来像と大学での学びを接続すると、志望理由に一貫性が出てきます。',
    href: '/statement',
    buttonLabel: '志望理由書に進む',
  },
  4: {
    title: '自己分析',
    description:
      '過去の変化や努力の過程を言葉にすると、伸びしろが強みとして伝わります。',
    href: '/self-analysis',
    buttonLabel: '自己分析を始める',
  },
};

// タイプ別の次アクション。リンク先は実在する既存ルートに合わせる。
//   1: 活動整理 → /input/activity
//   2: 自己分析 → /self-analysis
//   3: 志望理由書 → /statement
//   4: 一般受験並行 → 短時間ルートとしてまず /input/activity から
const NEXT_ACTIONS: Record<DiagnosisType, ActionInfo> = {
  1: {
    recommend: 'まずは活動整理から始めましょう。',
    reason:
      '今は「実績がない」のではなく、経験をどう整理するかが見えていない状態です。活動整理で、過去の経験を一つずつ言葉にしていきましょう。',
    ctaLabel: '活動整理を始める',
    ctaHref: '/input/activity',
  },
  2: {
    recommend: '自己分析で強みを言葉にしましょう。',
    reason:
      '活動や経験はあるので、それを志望理由書や面接で使える言葉に変えることが大事です。自己分析から進めましょう。',
    ctaLabel: '自己分析を始める',
    ctaHref: '/self-analysis',
  },
  3: {
    recommend: '志望理由書の完成度を上げましょう。',
    reason:
      'すでに書き始めている場合は、具体性・大学との一致・面接で話せる深さを高めることが重要です。',
    ctaLabel: '志望理由書を見直す',
    ctaHref: '/statement',
  },
  4: {
    recommend: '短時間で進める優先ルートから始めましょう。',
    reason:
      '一般受験と並行する場合は、まず活動整理・自己分析・志望理由書の順に、短時間でつながる部分から進めるのがおすすめです。',
    ctaLabel: '最短ルートで始める',
    ctaHref: '/input/activity',
  },
};

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

type DiagnosisTypeCardProps = {
  // 現在表示中のページ pathname。FIRST_STEP / NEXT_ACTIONS の href が
  // これと一致する CTA は、自分自身への誘導になるため抑制する。
  // 省略時（/home など）は従来通り全 CTA を表示する。
  currentHref?: string;
};

export function DiagnosisTypeCard({ currentHref }: DiagnosisTypeCardProps = {}) {
  // hydration mismatch 回避：マウント前は何も描画しない。
  // マウント後に loadDiagnosisResult() を 1度だけ呼んで以降は memo 値を返す。
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  const result = useMemo<DiagnosisResult | null>(
    () => (isMounted ? loadDiagnosisResult() : null),
    [isMounted],
  );

  if (!isMounted) return null;

  if (!result || !isResultUsable(result)) {
    return <PromoCard />;
  }

  const action = NEXT_ACTIONS[result.resultType];
  const details = TYPE_DETAILS[result.resultType];
  const firstStep = FIRST_STEP_DETAILS[result.resultType];
  const dateStr = formatDate(result.createdAt);

  return (
    <div className="mb-8 bg-white rounded-2xl border border-accent-200 shadow-sm overflow-hidden">
      {/* ヘッダ：診断結果 + タイトル + 説明 + 診断日 */}
      <div className="bg-accent-50/70 px-5 py-5 sm:px-6 border-b border-accent-100">
        <p className="text-xs font-semibold text-accent-600 mb-3">診断結果</p>
        <div className="flex items-start gap-3 mb-3">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-accent-100 text-accent-700 text-base font-extrabold shrink-0">
            {result.resultType}
          </span>
          <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 leading-snug">
            あなたは「{result.resultTitle}」です
          </h2>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
          {result.resultDescription}
        </p>
        {dateStr && (
          <p className="mt-3 text-xs text-slate-400">診断日：{dateStr}</p>
        )}
      </div>

      {/* 強み / 注意したいポイント */}
      <div className="px-5 py-5 sm:px-6 border-b border-accent-100 grid gap-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-brand-600 mb-2">
            あなたの強み
          </p>
          <ul className="space-y-1.5">
            {details.strengths.map((s) => (
              <li
                key={s}
                className="flex gap-2 text-sm text-slate-700 leading-relaxed"
              >
                <span aria-hidden="true" className="text-brand-500 mt-0.5">
                  ・
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold text-amber-600 mb-2">
            注意したいポイント
          </p>
          <ul className="space-y-1.5">
            {details.cautions.map((c) => (
              <li
                key={c}
                className="flex gap-2 text-sm text-slate-700 leading-relaxed"
              >
                <span aria-hidden="true" className="text-amber-500 mt-0.5">
                  ・
                </span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* あなたにおすすめの最初の一歩（タイプ別の専用導線）
          診断直後に "今すぐ押せる 1 つ" を強く名指しする位置づけ。
          bg-brand-50/60 で軽く強調しつつ既存トーンを維持する。 */}
      <div className="px-5 py-5 sm:px-6 border-b border-accent-100 bg-brand-50/60">
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-block text-[10px] font-bold tracking-wide text-white bg-brand-600 rounded-full px-2 py-0.5">
            あなた専用
          </span>
          <p className="text-xs font-semibold text-brand-700">
            おすすめの最初の一歩
          </p>
        </div>
        <p className="text-base sm:text-lg font-extrabold text-slate-900 mb-2 leading-snug">
          {result.resultTitle}のあなたは、まず「{firstStep.title}」から始めるのがおすすめです。
        </p>
        <p className="text-sm text-slate-600 leading-relaxed mb-4">
          {firstStep.description}
        </p>
        {firstStep.href === currentHref ? (
          // 現在ページ自身を指す CTA は出さず、補足文に差し替えて
          // 「この方向で正しい」という意味だけ伝える。
          <p className="text-sm font-semibold text-brand-700 leading-relaxed">
            このタイプは「{firstStep.title}」を深めることが特に大事です。引き続きこのページで進めましょう。
          </p>
        ) : (
          <LinkButton
            href={firstStep.href}
            variant="accent"
            size="lg"
            className="font-bold shadow-sm"
          >
            {firstStep.buttonLabel}
            <span aria-hidden="true" className="ml-2">→</span>
          </LinkButton>
        )}
      </div>

      {/* おすすめの次アクション */}
      <div className="px-5 py-5 sm:px-6">
        <p className="text-xs font-semibold text-brand-600 mb-2">
          おすすめの次アクション
        </p>
        <p className="text-base font-bold text-slate-900 mb-2 leading-relaxed">
          {action.recommend}
        </p>
        <p className="text-sm text-slate-600 leading-relaxed mb-4">
          {action.reason}
        </p>
        {/* font-bold は BASE の font-medium を上書きするため className で指定。
            shadow-sm は Button BASE には無いので追加で乗せる。
            text-sm sm:text-base → text-base に揃う点は許容（モバイルで微増）。
            currentHref と一致するときはボタンだけ抑制（説明文は残す）。 */}
        {action.ctaHref !== currentHref && (
          <LinkButton
            href={action.ctaHref}
            variant="accent"
            size="lg"
            className="font-bold shadow-sm"
          >
            {action.ctaLabel}
            <span aria-hidden="true" className="ml-2">→</span>
          </LinkButton>
        )}
      </div>
    </div>
  );
}

// 診断未実施 or 結果が壊れている場合のフォールバック
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
        <span aria-hidden="true" className="ml-2">→</span>
      </LinkButton>
    </div>
  );
}
