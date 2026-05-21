'use client';

// STEP-IMP-1 / UX polish: ④「書き直す」do フローのページ3「書き直し準備ページ」。
//
// 役割:
//   - 過去に書いた志望理由書（ReviewHistoryItem）を元に「何を直すか / どう直すか」を整理する
//   - 添削 API は呼ばない（本格的な添削・保存は ② /statement/edit 側）
//   - 完成度スコア俯瞰 UI（TotalScoreCard / RankBadge / AxisGapCard / DashboardSummary）は持たない
//
// UX 改善ポイント:
//   - 改善ポイントを actionable に：軸別 Before / After 例示でイメージを具体化
//   - 書き直しメモを「作業エリア」に：placeholder で書き出しの観点を提示
//   - CTA hierarchy を明確化：primary CTA を size=lg、secondary は inline link に格下げ
//   - 元本文を「推敲対象の文章」として読める typography（base size + 行間広め）
//   - 視線フロー：元本文 → 問題点 → どう直すか（Before/After）→ メモを書く → 実際に書き直す
//
// 触らない:
//   - statementReviewHistory 保存・削除ロジック（read のみ）
//   - /api/statement-review / /api/statement-prepare / AI prompt / PROMPT_VERSION
//   - rewriteDraftStorage / statement_rewrite_drafts
//   - ② edit の URL 受け取り（?rewriteFrom=<id> 既存）と本文 prefill 経路
//   - /statement/analysis/[id] / /statement/score
//   - 既存 lib の API surface（IMPROVEMENT_COMMENTS / REASONINGS を read のみ）
//
// UI 思想:
//   - white 主体、Card / AlertBox 不使用、divide-y で区切り
//   - 色は slate / blue（accent）/ red（warning がもしあれば）のみ
//   - 「ダッシュボード感」を出さない、レポート風

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LinkButton } from '@/components/ui/LinkButton';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/Label';
import {
  loadReviewHistory,
  type ReviewHistoryItem,
} from '@/lib/statement/review/statementStorage';
import { statementResultToScore } from '@/lib/statement/score/statementScore';
import { breakdownToPassLineItems } from '@/lib/statement/score/statementScoreSource';
import {
  getImprovementSuggestions,
  type ImprovementSuggestion,
} from '@/lib/improvementSuggestions';

// SSR-stable mount flag。既存ページと同形パターン。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// ── 軸別 Before / After 例示 ──────────────────────────────────────
// 「どう直すか」をテキスト説明だけでなく具体例で示すための static データ。
// page-local 定数として保持（既存 lib の API surface は変えない）。
// 編集時は軽量に文言を更新できる。AI 出力ではなく人手のサンプル。
type AxisExample = {
  before: string;
  after: string;
  hint: string;
};

const IMPROVEMENT_EXAMPLES: Record<string, AxisExample> = {
  logic: {
    before:
      '私は中学生の頃からプログラミングに興味があり、独学で学んできました。御学のITコースを志望します。',
    after:
      'プログラミングで身近な不便を解決した経験から、社会課題に技術で取り組みたいと考えるようになった。御学の◯◯コースで、現場の声を聞きながら設計を学びたい。',
    hint: '主張（志望理由）→ 根拠（経験）→ 大学との接続、の流れに整える',
  },
  specificity: {
    before: '海外経験を通じて成長した。',
    after:
      'ベトナムの中学生と授業の進め方を話したとき、教科書では学べない価値観の違いに戸惑った。その経験から「正しさは 1 つではない」と考えるようになった。',
    hint: '場所 / 時期 / 自分の行動 / 感情の変化を 1 文に入れる',
  },
  universityFit: {
    before: '貴学の国際的な学びに魅力を感じています。',
    after:
      '◯◯先生の「地域 × グローバル教育」研究と、△△ゼミの現地調査プログラムは、高校で取り組んだ地域フィールドワークを大学で深めるのに最適だと感じています。',
    hint: '固有のカリキュラム名・教員名・プログラム名を 1 つ以上入れる',
  },
  futureGoal: {
    before: '将来は国際的に活躍したい。',
    after:
      '東南アジアの教育格差を、デジタル教材を通じて埋める仕事に関わりたい。卒業後は教育系 NPO で 2〜3 年現場経験を積み、自分の事業を立ち上げる構想がある。',
    hint: '分野 / 関わり方 / 時間軸を具体化する',
  },
  originality: {
    before: 'みんなと協力することの大切さを学びました。',
    after:
      '文化祭の意見対立で 3 日間誰も話さない時期があった。私は議論を再開する前に 1 人ずつ立場を聞き直す時間を作った。そこで「納得しない協力」は脆いと気づいた。',
    hint: '自分固有の体験・違和感・気づきを起点にする',
  },
};

// 書き直しメモ textarea の placeholder。
// 「何を直すか」を書きたくなるよう、観点を箇条書きで提示する。
const MEMO_PLACEHOLDER = `たとえば：
・具体エピソードを増やす（ベトナム短期留学での出来事 など）
・志望理由を先に持ってくる
・大学との接続を強める（◯◯先生の研究 / △△ゼミ）
・将来像を最後にまとめる`;

export default function StatementImproveRewritePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  const entry = useMemo<ReviewHistoryItem | null>(
    () => {
      if (!isMounted) return null;
      return loadReviewHistory().find((h) => h.id === id) ?? null;
    },
    [isMounted, id],
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="mb-8">
        <Link
          href="/statement/improve"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← 書き直し一覧に戻る
        </Link>
      </div>

      {isMounted && entry === null && <NotFound />}
      {isMounted && entry !== null && <RewritePrep entry={entry} />}
    </div>
  );
}

// ── レポート本体 ──────────────────────────────────────────────────

function RewritePrep({ entry }: { entry: ReviewHistoryItem }) {
  // 改善ポイント top 3 軸を既存 lib から取得。
  // score 数値（current / target / diff）は表示用には使わず、ソートと「どの軸を出すか」の
  // 選別にだけ使う。表示は label / reasoning / comment + 軸別 Before/After 例 のみ。
  const suggestions = useMemo<ImprovementSuggestion[]>(() => {
    const score = statementResultToScore(entry.result);
    const items = breakdownToPassLineItems(score.breakdown);
    return getImprovementSuggestions(items, 3);
  }, [entry.result]);

  // 書き直しメモ（MVP: ephemeral、localStorage 保存なし）。
  // ページから離れると消える。永続化は別 STEP（rewritePrepMemoStorage 追加）で行う。
  const [memo, setMemo] = useState('');

  const analysisHref = `/statement/analysis/${encodeURIComponent(entry.id)}`;
  const editHref = `/statement/edit?rewriteFrom=${encodeURIComponent(entry.id)}`;

  return (
    <article>
      {/* ── ヘッダ（score / rank なし、タイポグラフィのみ） ─────────── */}
      <header className="mb-14">
        <p className="text-xs text-slate-400 tabular-nums mb-3">
          {formatDateTime(entry.createdAt)}
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight mb-2">
          書き直し準備
        </h1>
        <p className="text-sm text-slate-500">
          {[entry.university || '大学未入力', entry.faculty, entry.department]
            .filter((v) => v && v.length > 0)
            .join(' / ')}
        </p>
      </header>

      {/* ── 元の志望理由書 ──────────────────────────────────────
          「分析資料」ではなく「推敲対象の文章」として読める typography。
          base サイズ + 行間広め + max-width で読書密度を確保する。 */}
      <Section title="元の志望理由書">
        <pre className="whitespace-pre-wrap text-slate-700 font-sans text-base leading-[1.85]">
          {entry.essay}
        </pre>
      </Section>

      {/* ── 改善ポイント ──────────────────────────────────────
          各軸を「なぜ重要か → どう直すか → Before / After 例」の 3 段で展開し、
          「読んだ後に書き始めたくなる」流れに作る。
          数値（current / target / diff）は出さない。 */}
      <Section title="改善ポイント">
        {suggestions.length === 0 ? (
          <p className="text-sm text-slate-500 leading-relaxed">
            このスコアでは目立った改善ポイントは検出されませんでした。詳細分析で他の観点を確認できます。
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {suggestions.map((s, i) => {
              const example = IMPROVEMENT_EXAMPLES[s.id];
              return (
                <li key={s.id} className="py-7 first:pt-0 last:pb-0">
                  <div className="flex items-baseline gap-3 mb-4">
                    <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
                      {i + 1}
                    </span>
                    <h3 className="text-base font-medium text-slate-900">
                      {s.label}
                    </h3>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        なぜ重要か
                      </p>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        {s.reasoning}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        どう直すか
                      </p>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        {s.comment}
                      </p>
                    </div>
                    {example && <BeforeAfter example={example} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── 書き直しメモ ─────────────────────────────────────
          「読む」から「書き始める」への橋渡し。CTA の直前に置く。
          MVP: localStorage 保存なし。永続化は別 STEP。 */}
      <Section title="書き直しメモ">
        <Label htmlFor="rewrite-memo">直す方針を書き留める</Label>
        <p className="text-xs text-slate-400 mb-3 leading-relaxed">
          このメモはページを離れると消えます。書き出す前に「何を直すか」を整理する作業用です。
        </p>
        <Textarea
          id="rewrite-memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={8}
          placeholder={MEMO_PLACEHOLDER}
          className="leading-relaxed resize-y"
        />
        <p className="text-xs text-slate-400 tabular-nums mt-2">
          {memo.length} 文字
        </p>
      </Section>

      {/* ── CTA hierarchy ────────────────────────────────────
          primary（②へ書き直し）を主役に。size=lg + 単独セクション。
          詳細分析は inline link に格下げして、書き直し開始の意思決定を妨げない。 */}
      <section className="mb-12">
        <LinkButton
          href={editHref}
          variant="primary"
          size="lg"
          className="w-full sm:w-auto"
        >
          ②で本文を書き直す →
        </LinkButton>
        <p className="text-xs text-slate-500 mt-3 leading-relaxed">
          書き直す前にもっと詳しい分析が必要なときは、
          <Link
            href={analysisHref}
            className="text-blue-600 hover:text-blue-700 underline underline-offset-2 ml-0.5"
          >
            詳細分析を見る
          </Link>
          。
        </p>
      </section>

      {/* footer back link */}
      <div className="mt-8">
        <Link
          href="/statement/improve"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← 書き直し一覧に戻る
        </Link>
      </div>
    </article>
  );
}

// ── Before / After ペア ───────────────────────────────────────────
// 軸ごとの「具体的にどう書き換えればよいか」を 1 例だけ提示する。
// 縦並びの 2 ブロック + 区切り線 1 本。色付き Card にせず、subtle な背景で「変化」を見せる。

function BeforeAfter({ example }: { example: AxisExample }) {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-4 sm:px-5 sm:py-5">
      <div className="mb-3">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          Before
        </p>
        <p className="text-sm text-slate-600 leading-relaxed">
          「{example.before}」
        </p>
      </div>
      <div className="border-t border-slate-200 pt-3 mb-3">
        <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider mb-1.5">
          After
        </p>
        <p className="text-sm text-slate-800 leading-relaxed">
          「{example.after}」
        </p>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        ヒント：{example.hint}
      </p>
    </div>
  );
}

// ── レイアウト primitives ─────────────────────────────────────────
// /statement/analysis/[id]（49f8bca）と同思想：枠 + 背景ではなく余白 + 見出しで区切る。

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-16">
      <h2 className="text-xl font-semibold text-slate-900 tracking-tight mb-6">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ── entry が見つからない時 ────────────────────────────────────────
function NotFound() {
  return (
    <div className="py-16 text-center">
      <h2 className="text-base font-medium text-slate-900 mb-2">
        書き直す対象が見つかりません
      </h2>
      <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-md mx-auto">
        指定された志望理由書の記録が見つかりませんでした。
      </p>
      <LinkButton href="/statement/improve" variant="primary" size="md">
        書き直し一覧へ戻る
      </LinkButton>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${h}:${min}`;
}
