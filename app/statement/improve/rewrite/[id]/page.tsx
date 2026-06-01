'use client';

// STEP-IMP-1 / UX polish: ④「書き直す」do フローのページ3「書き直し準備ページ」。
// STEP-IA-1 で ④ のフロー上流が分離された：改善点 + 詳細分析の理解は
// /statement/improve/analysis/[id]（improve 専用 analysis）が担い、本ページはそこから
// 「書き直し準備へ進む →」CTA 経由で到達するページに位置づけ直された。
// 戻る link / 横参照はすべて improve 専用 analysis を指す（view-only の
// /statement/analysis/[id] には飛ばさない）。
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
//   - ② edit の URL 受け取り（?rewriteFrom=<id> 既存）と本文 prefill 経路
//   - /statement/analysis/[id]（view-only score-analysis） / /statement/score
//   - 既存 lib の API surface（IMPROVEMENT_COMMENTS / REASONINGS を read のみ）
//
// UI 思想:
//   - white 主体、Card / AlertBox 不使用、divide-y で区切り
//   - 色は slate / blue（accent）/ red（warning がもしあれば）のみ
//   - 「ダッシュボード感」を出さない、レポート風

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LinkButton } from '@/components/ui/LinkButton';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/Label';
// STEP-PAGE-03 で inline 定義から切り出した leaf component 群（pure props rendering）。
// RewritePrep / autosave / refs / effects / storage I/O は page.tsx に残置。
import { ImprovementActionCard } from './components/ImprovementActionCard';
import { Section } from './components/Section';
import { NotFound } from './components/NotFound';
import {
  loadReviewHistory,
  type ReviewHistoryItem,
} from '@/lib/statement/review/statementStorage';
import {
  loadRewriteMemo,
  saveRewriteMemo,
  saveRewriteMemoWorkAnswer,
  type RewriteMemoWorkAnswers,
} from '@/lib/statement/rewrite/rewriteMemoStorage';
import { getRewriteWorkQuestions } from '@/lib/statement/rewrite/rewriteWorkQuestions';
import { statementResultToScore } from '@/lib/statement/score/statementScore';
import { breakdownToPassLineItems } from '@/lib/statement/score/statementScoreSource';
import {
  getImprovementSuggestions,
  getImprovementWorkKey,
  type ImprovementSuggestion,
} from '@/lib/improvementSuggestions';
import { pickAnalysisForAxes } from '@/lib/statement/rewrite/pickAnalysisForAxis';
import { pickRelevantExcerpt } from '@/lib/statement/rewrite/pickRelevantExcerpt';

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
          href={`/statement/improve/analysis/${encodeURIComponent(id)}`}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← 改善レポートに戻る
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

  // v3: 各 suggestion の card 見出しに analysis-specific な指摘文を出すための割当。
  // weaknesses / actions は flat string[] で axis tag 無しのため、keyword で greedy に
  // 振り分ける（pickAnalysisForAxes は pure deterministic）。マッチ無しの axis は
  // ImprovementSuggestion.reasoning / comment（generic 軸説明）に fallback する。
  //
  // v4: weaknessText に含まれる引用語 or axis keyword を anchor に、essay 本文から
  // 「この文を直す」候補文を 1 つ拾う（pickRelevantExcerpt も pure deterministic）。
  // 該当無しの axis は excerpt: null となり、card 側で「現在の本文」セクションを skip する。
  //
  // STEP-STATEMENT-FALLBACK-01:
  //   pickAnalysisForAxes が null を返す axis は IMPROVEMENT_REASONINGS / IMPROVEMENT_COMMENTS
  //   の generic テンプレに silent fallback する設計だった。これは AI 出力と見分けがつかず、
  //   ユーザーは「AI 分析由来の指摘」と誤認する可能性がある（監査 Top10 #2 の核と同型）。
  //   axis ごとに weakness / action の source を 'ai' | 'fallback' で記録し、card に渡す。
  //   両方 fallback の axis は card 上部に注意文を表示する。
  const analysisByAxis = useMemo(() => {
    const axisIds = suggestions.map((s) => s.id);
    const weakness = pickAnalysisForAxes(entry.result.weaknesses ?? [], axisIds);
    const action = pickAnalysisForAxes(entry.result.actions ?? [], axisIds);
    const excerpt: Record<string, string | null> = {};
    const sourceByAxis: Record<string, 'ai' | 'partial' | 'fallback'> = {};
    for (const s of suggestions) {
      const wt = weakness[s.id] ?? s.reasoning;
      excerpt[s.id] = pickRelevantExcerpt(entry.essay, s.id, wt);
      const wSource = weakness[s.id] !== null;
      const aSource = action[s.id] !== null;
      if (wSource && aSource) sourceByAxis[s.id] = 'ai';
      else if (!wSource && !aSource) sourceByAxis[s.id] = 'fallback';
      else sourceByAxis[s.id] = 'partial';
    }
    return { weakness, action, excerpt, sourceByAxis };
  }, [entry.result, entry.essay, suggestions]);

  // STEP-STATEMENT-FALLBACK-01: fallback 発火を 1 回だけ warn ログに出す（本文 / 個人情報は出力しない）。
  // useEffect で 1 回だけ発火する設計（render 毎の log 連打を避ける）。setState を含まないため
  // react-hooks/set-state-in-effect には抵触しない。
  useEffect(() => {
    const fallbackAxes = suggestions
      .filter((s) => analysisByAxis.sourceByAxis[s.id] !== 'ai')
      .map((s) => ({ axis: s.id, source: analysisByAxis.sourceByAxis[s.id] }));
    if (fallbackAxes.length > 0) {
      console.warn('[fallback]', {
        route: 'app/statement/improve/rewrite',
        reason: 'axis_analysis_fallback',
        axes: fallbackAxes,
        timestamp: new Date().toISOString(),
      });
    }
  }, [analysisByAxis.sourceByAxis, suggestions]);

  // rewriteMemo は reviewId 単位で localStorage に永続化（statement_rewrite_memo）。
  // 2 つの artifact を持つ：
  //   - text         : 自由メモ（補足メモ）
  //   - workAnswers  : 改善ポイント別ワークの回答（axisKey × questionKey の string map）
  // どちらも mount 後に 1 回だけ既存 record から seed → 編集は debounce 500ms で autosave。
  // initialMemoRef / initialWorkRef は「現在 storage に保存済みの値」をローカルに保持し、
  // 同値の場合は autosave を skip する（mount-init 直後の不要な write を避ける）。
  const [memo, setMemo] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const initialMemoRef = useRef<string | null>(null);

  const [workAnswers, setWorkAnswers] = useState<RewriteMemoWorkAnswers>({});
  const initialWorkRef = useRef<RewriteMemoWorkAnswers | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // mount-init: 既存の memo / workAnswers を read。なければ baseline は空。
    const existing = loadRewriteMemo(entry.id);
    const baselineText = existing?.text ?? '';
    initialMemoRef.current = baselineText;
    setMemo(baselineText);
    const baselineWork = existing?.workAnswers ?? {};
    initialWorkRef.current = baselineWork;
    setWorkAnswers(baselineWork);
    if (existing) setLastSavedAt(existing.updatedAt);
  }, [entry.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    // autosave (text): mount-init が終わるまで（initialMemoRef が null）は走らない。
    // baseline と同値なら skip（mount 直後の seed や、保存直後の冪等再描画を除外）。
    if (initialMemoRef.current === null) return;
    if (memo === initialMemoRef.current) return;
    const t = setTimeout(() => {
      const updatedAt = new Date().toISOString();
      saveRewriteMemo(entry.id, { text: memo, updatedAt });
      initialMemoRef.current = memo;
      setLastSavedAt(updatedAt);
    }, 500);
    return () => clearTimeout(t);
  }, [memo, entry.id]);

  useEffect(() => {
    // autosave (workAnswers): 初期 ref に対して changed cell を diff して
    // saveRewriteMemoWorkAnswer で 1 個ずつ upsert する。
    // saveRewriteMemoWorkAnswer は text を維持しつつ updatedAt を更新する（merge 動作）。
    if (initialWorkRef.current === null) return;
    const initial = initialWorkRef.current;
    const t = setTimeout(() => {
      let saved = false;
      for (const [axisKey, axis] of Object.entries(workAnswers)) {
        if (!axis) continue;
        const initAxis = initial[axisKey] ?? {};
        for (const [qKey, val] of Object.entries(axis)) {
          if (val === undefined) continue;
          if (initAxis[qKey] === val) continue;
          saveRewriteMemoWorkAnswer(entry.id, axisKey, qKey, val);
          saved = true;
        }
      }
      initialWorkRef.current = workAnswers;
      if (saved) setLastSavedAt(new Date().toISOString());
    }, 500);
    return () => clearTimeout(t);
  }, [workAnswers, entry.id]);

  const handleWorkChange = (
    axisKey: string,
    questionKey: string,
    value: string,
  ) => {
    setWorkAnswers((prev) => ({
      ...prev,
      [axisKey]: { ...(prev[axisKey] ?? {}), [questionKey]: value },
    }));
  };

  const analysisHref = `/statement/improve/analysis/${encodeURIComponent(entry.id)}`;
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
          base サイズ + 行間広め + max-width で読書密度を確保する。
          STEP-REW-3: <details open> でラップして「初回は自然に読める／必要なくなったら閉じれる」
            運用に切替。closed default ではなく open default（rewrite は本文を見ながら整理する
            価値が大きいため）。Section primitive は h2 を summary に内包する形に展開する。 */}
      <section className="mb-16">
        <details open className="group">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-baseline gap-3 mb-6">
            <h2 className="text-xl font-semibold text-slate-900 tracking-tight flex-1">
              元の志望理由書
            </h2>
            <span className="text-xs text-slate-500 tabular-nums">
              {entry.essay.length} 文字
            </span>
            <span className="shrink-0 text-slate-400 transition-transform group-open:rotate-180 inline-block text-sm leading-none">
              ▾
            </span>
          </summary>
          <pre className="whitespace-pre-wrap text-slate-700 font-sans text-base leading-[1.85]">
            {entry.essay}
          </pre>
        </details>
      </section>

      {/* ── 改善ポイント（v3: analysis-specific な指摘 × ワーク を統合した実行 card）─────
          STEP-WORK v3: 旧「書き直しの参考例」+「改善ポイント別ワーク」を 1 セクションに統合。
          各 card は axis label を主役にせず、analysis レポート由来の essay-specific な指摘
          （weakness / action）を見出しに据えて、その下に static questions を並べる。
          axis は内部 key（workAnswers の axisKey）として残し、chip 表示と questions の lookup
          にのみ使う。weakness / action は pickAnalysisForAxes で keyword 割当て、無ければ
          IMPROVEMENT_REASONINGS / IMPROVEMENT_COMMENTS の generic 文に fallback。
          AI summary や snapshot は持たない（edit 側で render-time derive する方針）。 */}
      {suggestions.length === 0 ? (
        <Section title="改善ポイント">
          <p className="text-sm text-slate-500 leading-relaxed">
            このスコアでは目立った改善ポイントは検出されませんでした。詳細分析で他の観点を確認できます。
          </p>
        </Section>
      ) : (
        <Section title="改善ポイント">
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            分析レポートで指摘された改善点ごとに、本文に入れる素材を書き出していきましょう。書いた内容は書き直し画面で見ながら執筆できます。
          </p>
          <ul className="space-y-4 list-none">
            {suggestions.map((s, i) => {
              const axisKey = getImprovementWorkKey(s);
              const questions = getRewriteWorkQuestions(axisKey);
              const weaknessText = analysisByAxis.weakness[axisKey] ?? s.reasoning;
              const actionText = analysisByAxis.action[axisKey] ?? s.comment;
              const excerptText = analysisByAxis.excerpt[axisKey] ?? null;
              const source = analysisByAxis.sourceByAxis[axisKey] ?? 'ai';
              return (
                <li key={`work-${s.id}`}>
                  <ImprovementActionCard
                    index={i}
                    suggestion={s}
                    axisKey={axisKey}
                    questions={questions}
                    answers={workAnswers[axisKey] ?? {}}
                    onChange={handleWorkChange}
                    weaknessText={weaknessText}
                    actionText={actionText}
                    excerptText={excerptText}
                    example={IMPROVEMENT_EXAMPLES[s.id]}
                    source={source}
                  />
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* ── 書き直し方針メモ（補足メモ）─────────
          STEP-REW-1: 元本文の直後・参考例の前に配置して「まず整理を書く」流れに変えた。
          STEP-WORK-2: 改善ポイント別ワークが主役 artifact になったため、本セクションは
            「ワークで書ききれなかった気付きを書き留める」補足メモへ役割を移した。配置も
            ワークの下に移動。text 自体の保存ロジックは不変（saveRewriteMemo は workAnswers
            未指定なら既存 workAnswers を保持する merge 動作）。
          表示用の lastSavedAt は最後に成功した save の ISO 文字列（text/workAnswers 共通）。 */}
      <Section title="書き直し方針メモ">
        <Label htmlFor="rewrite-memo">補足として書き留める</Label>
        <p className="text-xs text-slate-400 mb-3 leading-relaxed">
          上のワークに収まらない気付きや、全体に関わるメモを書く場所です。入力は自動的に保存されます。
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
          {lastSavedAt && (
            <span className="ml-3">最終更新 {formatDateTime(lastSavedAt)}</span>
          )}
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

    </article>
  );
}

// ── leaf component 群は ./components/ 配下に切り出した（STEP-PAGE-03）─────
//   - ImprovementActionCard: 改善ポイント card（v4）
//   - BeforeAfter:           軸別 Before / After 例示
//   - Section:               レイアウト primitive
//   - NotFound:              entry が見つからない時
//   すべて pure props rendering。RewritePrep の state / refs / autosave effects / storage I/O は
//   page.tsx 側に残置している。


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
