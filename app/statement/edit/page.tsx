'use client';

import { Suspense, useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import type { StatementImprovementTargetSection } from '@/types/statementInterviewInsights';
import type { StudentProfile } from '@/types/studentProfile';
import {
  saveDraft, loadDraft, clearDraft,
  saveReviewHistory,
  // STEP4-2: ④ /statement/improve から ?rewriteFrom=<id> 経由で来た場合に
  // 該当 entry を read-only で読み出して prefill / 参考表示するために再 import。
  // 履歴の保存・削除には触らない（loadReviewHistory は read only 用途）。
  loadReviewHistory,
  type ReviewHistoryItem,
} from '@/lib/statement/review/statementStorage';
import {
  canUseStatementReview,
  incrementStatementReviewCount,
  getRemainingStatementReviewCount,
} from '@/lib/statement/review/statementLimit';
import type { StatementResult } from '@/types/statement';
import { normalizeStatementScore } from '@/lib/statement/score/statementScore';
import { loadActivityData } from '@/lib/activityStorage';
import {
  getStatementPrepareSummary,
  getStatementPrepareFollowUpAnswers,
  type StatementPrepareFollowUpAnswers,
  type StatementPrepareSummary,
} from '@/lib/statement/prepare/statementPrepareStorage';
import {
  loadUniversityPrepareHistory,
  type UniversityPrepareEntry,
} from '@/lib/statement/prepare/universityPrepareHistory';
import {
  loadRewriteDrafts,
  type RewriteDraftRecord,
} from '@/lib/statement/rewrite/rewriteDraftStorage';
import type { ActivityData } from '@/types/activity';
import type { BasicInfo } from '@/types/basicInfo';
import type { WallHittingResult } from '@/types/analysis';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { loadWallHittingResult } from '@/lib/wallHittingStorage';
import { getStudentProfileForFeature } from '@/lib/getStudentProfileForFeature';
import {
  STATEMENT_REVIEW_MODEL,
  STATEMENT_REVIEW_PROMPT_VERSION,
  hashStatementReviewInput,
} from '@/lib/aiInputHash';
import {
  loadStatementReviewCache,
  saveStatementReviewCache,
} from '@/lib/statement/review/statementReviewCache';
import { parseStatementReviewError } from '@/lib/statement/review/parseStatementReviewError';
import { logAiCache } from '@/lib/aiCacheLog';
import BasicInfoSummary from '@/components/shared/BasicInfoSummary';
import { StepHeader } from '@/components/StatementFlow/StepHeader';
import { Accordion } from '@/components/ui/Accordion';
// STEP8.5: edit feature 専用 view は app/statement/edit/components/ 配下へ physical split 済み。
import { InputFormView } from './components/InputFormView';
import { ReviewResultView } from './components/ReviewResultView';
import { DetailAnalysisAccordionView } from './components/DetailAnalysisAccordionView';

// ── 面接 → 志望理由書改善 動線（STEP7.5 / STEP9）──────────────────
// InterviewHistoryCard の CTA から ?focus=<targetSection> で遷移してきたときに、
// 「どこを見直すか」を上部に軽く案内するためのラベル + 見直しポイントチェックリスト。
// スクロール / ハイライト等の複雑実装は持たない（最小差分）。
const FOCUS_LABELS: Record<StatementImprovementTargetSection, string> = {
  motivation: '面接で見えた改善点をもとに、志望理由やきっかけを見直しましょう。',
  past_experience:
    '面接で見えた改善点をもとに、過去の経験や活動の具体性を見直しましょう。',
  problem_awareness:
    '面接で見えた改善点をもとに、問題意識や課題意識を見直しましょう。',
  university_fit:
    '面接で見えた改善点をもとに、大学で学びたい内容や志望校との接続を見直しましょう。',
  future_goal:
    '面接で見えた改善点をもとに、将来像と大学での学びのつながりを見直しましょう。',
  other: '面接で見えた改善点をもとに、志望理由書全体を見直しましょう。',
};

// STEP9: focus 別の「今回見るポイント」3 件チェックリスト。
// 「指摘」ではなく「見直し観点」として軽く出す。代筆ではなく自問プロンプトの位置づけ。
const FOCUS_CHECKLIST: Record<StatementImprovementTargetSection, string[]> = {
  motivation: [
    'なぜこの大学・学部を志望するのか',
    'その関心を持ったきっかけは何か',
    '他大学ではなくこの大学である理由はあるか',
  ],
  past_experience: [
    '過去の活動や経験が具体的に書けているか',
    'その経験から何を学んだか',
    '志望理由と経験がつながっているか',
  ],
  problem_awareness: [
    'どんな問題意識を持っているか',
    'なぜその問題に関心を持ったのか',
    '自分の経験と問題意識がつながっているか',
  ],
  university_fit: [
    '大学で何を学びたいのか',
    'カリキュラム・授業・研究分野と接続できているか',
    '将来目標と大学での学びがつながっているか',
  ],
  future_goal: [
    '将来どんなことをしたいのか',
    '大学での学びが将来像につながっているか',
    '目標が抽象的すぎないか',
  ],
  other: [
    '志望理由書全体の流れが自然か',
    '経験・学び・将来像がつながっているか',
    '面接で説明できる内容になっているか',
  ],
};

function isFocusKey(value: string | null): value is StatementImprovementTargetSection {
  if (value === null) return false;
  return Object.prototype.hasOwnProperty.call(FOCUS_LABELS, value);
}

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

// ── 書き出しヒント挿入ロジック ────────────────────────────────────

function appendHintToText(currentText: string, hint: string): string {
  const trimmedHint = hint.trim();
  if (!currentText.trim()) return trimmedHint;
  if (currentText.endsWith('\n\n')) return `${currentText}${trimmedHint}`;
  if (currentText.endsWith('\n')) return `${currentText}\n${trimmedHint}`;
  return `${currentText}\n\n${trimmedHint}`;
}

// ── 書き直しメモ section の表示用 axis ラベル ───────────────────────
// PASS_LINE_TARGETS / breakdown ラベルの subset を local に持つ（cross-file 依存を増やさない）。
const REWRITE_AXIS_LABELS: Record<string, string> = {
  logic:         '論理構造',
  specificity:   '具体性',
  universityFit: '大学との一致',
  futureGoal:    '将来目標',
  originality:   '独自性',
};

// ── ページ本体 ────────────────────────────────────────────────────

// マウント前 false / マウント後 true を返す flag（SSR/hydration セーフ）。
// useSyncExternalStore は server snapshot / client snapshot を React のハイドレーション
// フェーズと協調させるため、setState を使わずに「マウント済み」フラグを表現できる。
// app/self-analysis/page.tsx と同形パターン。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// useSearchParams を本コンポーネントが使うため、default export 側で <Suspense> ラップする
// （Next.js 16 の prerender bailout warning を抑える）。本体は実装は維持。
function StatementPageInner() {
  // form 入力（value 属性が render に直結するので SSR-stable の空値で初期化、useEffect で seeding）。
  // 後段の mount-init useEffect で draft / basicInfo.preferences[0] から復元する。
  const [university, setUniversity] = useState('');
  const [faculty, setFaculty] = useState('');
  const [department, setDepartment] = useState('');
  const [statementText, setStatementText] = useState('');

  // STEP5.13: SSR/hydration セーフな mount フラグ。useState + useEffect の従来パターンを
  // useSyncExternalStore + useMemo に切り替えて react-hooks/set-state-in-effect を解消する。
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // 読み取り専用 state（mount 後に書き換わらない）は useMemo で派生させる。
  // isMounted = false 期間（SSR + ハイドレーション直前）は null を返してハイドレーション安全、
  // isMounted = true に切り替わったタイミングで再計算して実値を返す。
  // basicInfo / wallHitting / activities は submitReview の payload・cache hash 入力で使う補助情報。
  const basicInfo = useMemo<BasicInfo | null>(
    () => (isMounted ? loadBasicInfo() : null),
    [isMounted],
  );
  const wallHitting = useMemo<WallHittingResult | null>(
    () => (isMounted ? loadWallHittingResult() : null),
    [isMounted],
  );
  const activities = useMemo<ActivityData | null>(
    () => (isMounted ? loadActivityData() : null),
    [isMounted],
  );
  const prepareSummary = useMemo<StatementPrepareSummary | null>(
    () => (isMounted ? getStatementPrepareSummary() : null),
    [isMounted],
  );

  // ① 大学軸 prepare の履歴。配列 / 最大 10 件 / 先頭が最新。
  // 履歴が 1 件以上あれば左サイド欄で「整理メモ履歴」を優先表示し、
  // 旧 prepareSummary（最新 1 枚）の表示は履歴 0 件時の fallback に下ろす。
  const prepareHistory = useMemo<UniversityPrepareEntry[]>(
    () => (isMounted ? loadUniversityPrepareHistory() : []),
    [isMounted],
  );

  // 「書き直しメモ」 section 用。空 text の draft は drop。statementText は触らない参照表示専用。
  // SSR 時は []、mount 後に load して filter する既存の useMemo[isMounted] パターンを踏襲。
  const rewriteDraftEntries = useMemo<Array<[string, RewriteDraftRecord]>>(
    () => {
      if (!isMounted) return [];
      const all = loadRewriteDrafts();
      return Object.entries(all).filter(
        ([, d]) => d && d.text.length > 0,
      ) as Array<[string, RewriteDraftRecord]>;
    },
    [isMounted],
  );

  // C1 mitigation: StudentProfile を useMemo 化して submit ごとの再 derivation を停止する。
  // canonical 不在の legacy user で getStudentProfileForFeature→toStudentProfile が
  // generatedAt=new Date() で毎回新規 object を返し、inputHash 計算で drift する問題を抑える。
  // [isMounted, wallHitting] 依存: wallHitting 自体が isMounted-gated useMemo なので
  // post-hydration 後の reference は安定し、submit を何度繰り返しても同じ hash になる。
  // 出力 hash (StudentProfile.sourceHash) とは別レーン: ここでは AI 入力 hash の安定のためだけに使う。
  const studentProfile = useMemo<StudentProfile | null>(
    () => (isMounted ? getStudentProfileForFeature({ wallHittingResult: wallHitting }) : null),
    [isMounted, wallHitting],
  );

  // mutable state（submitReview 成功時に更新される）。
  // 初期値は SSR-stable な空値。実値は後段の mount-init useEffect で setState する。
  // 過去の添削履歴の閲覧/復元/削除は ③ /statement/score 系に分離済みのため、本ページでは保持しない
  // （storage への保存 saveReviewHistory はそのまま継続）。
  const [remainingCount, setRemainingCount] = useState(5); // サーバーと一致するデフォルト値
  // STEP 18: /statement/prepare で書いた追加メモ。表示専用、textarea には自動挿入しない。
  const [prepareFollowUps, setPrepareFollowUps] = useState<StatementPrepareFollowUpAnswers>({});
  // STEP 22: 参考メモ（左カラム）の表示/非表示。session 中のみ、localStorage 保存しない。
  const [showReferenceNotes, setShowReferenceNotes] = useState(true);
  // 後方互換: 既存 JSX は `mounted &&` でデータ依存表示をガードしているのでエイリアスとして残す。
  const mounted = isMounted;

  // STEP7.5 / STEP9: 面接 → 志望理由書改善 動線。?focus=<targetSection> を読み取り、
  // 該当する案内文 + 見直しチェックリストを上部バナーに描画する。`mounted` ゲートにより
  // SSR / hydration 一致を保つ（既存ページの SSR-stable 方針を踏襲）。
  const searchParams = useSearchParams();
  const focusParam = searchParams?.get('focus') ?? null;
  const focusKey: StatementImprovementTargetSection | null =
    mounted && isFocusKey(focusParam) ? focusParam : null;

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

  // 書き直しメモのコピー。statementText には触らない（PASSAI 思想: 本文の自動書き換えはしない）。
  // toastTimerRef は触らず fire-and-forget。
  // 連打時に短い flicker が出る可能性はあるが副作用は限定的（user 起点アクション）。
  async function handleCopyRewrite(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast('コピーしました');
      setTimeout(() => setToast(''), 2000);
    } catch {
      // clipboard 拒否時は silent
    }
  }

  const [result, setResult] = useState<StatementResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // STEP4-2: ④ → ② への書き直し対象履歴の context。?rewriteFrom=<id> が指す
  // ReviewHistoryItem を mount-init useEffect で 1 回だけ load する。
  // mount 後は不変（書き直し対象は per-visit で固定）。
  // 左サイド欄の「書き直し中：参考メモ」表示に使う。本文 textarea には自動反映しない
  //（prefill は mount-init で 1 回のみ）。
  const [rewriteContext, setRewriteContext] = useState<ReviewHistoryItem | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // STEP5.13: mount 後に localStorage から実値を取得し、form 入力 + mutable state にセットする。
  // 残存している setState 群は以下の理由で本 effect でしか実現できない:
  //   - form 入力 (university/faculty/department/statementText) の value 属性は SSR と
  //     client first render で同一でないとハイドレーションエラーになる。lazy initializer で
  //     localStorage を読むと server '' / client '実値' で必ず mismatch するため、useState('')
  //     + mount 後 setState で post-hydration に統一する従来パターンを維持する。
  //   - remainingCount / prepareFollowUps は mutable で後段の submitReview 成功時等に
  //     setState される。lazy init + useMemo では mutability を表現できない。
  //   - draft が無いときは basicInfo.preferences[0] から form を seed する条件付きロジックを
  //     伴うため、ここで loadBasicInfo() を 1 度だけローカル変数として読み直している
  //     （useMemo 側の basicInfo は同等値を後段で返すが、mount-init はまだ undefined の
  //     可能性があるためローカルに取り直す）。
  // 真の external system (localStorage) sync で、A (lazy init) / B (useSyncExternalStore) /
  // C (派生化) では SSR 安全性を保てない genuine side-effect。eslint-disable は本 effect
  // 内のみで limited に閉じる。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // STEP4-2: ?rewriteFrom=<id> が指す履歴 entry があれば、それを優先 prefill する。
    // ユーザーが ④ で「この内容をもとに書き直す」を明示的にクリックして来た経路なので、
    // 既存 draft / basicInfo の seeding より優先。
    // entry が見つからない（id 不正・履歴削除済み）場合は silently fall through。
    // prefill は mount で 1 回だけ（rerun しない）。
    const rewriteId = searchParams?.get('rewriteFrom') ?? null;
    let rewritePrefilled = false;
    if (rewriteId) {
      const entry = loadReviewHistory().find((h) => h.id === rewriteId);
      if (entry) {
        setRewriteContext(entry);
        setUniversity(entry.university);
        setFaculty(entry.faculty);
        setDepartment(entry.department);
        setStatementText(entry.essay);
        rewritePrefilled = true;
      }
    }

    if (!rewritePrefilled) {
      const draft = loadDraft();
      if (draft) {
        setUniversity(draft.university);
        setFaculty(draft.faculty);
        setDepartment(draft.department);
        setStatementText(draft.statementText);
      } else {
        // 初回アクセスで下書きがない場合は basicInfo の第一志望を初期値に入れる。
        // ユーザーは画面上で上書きできる。department が空なら空欄のまま。
        const basic = loadBasicInfo();
        const pref = basic?.preferences?.[0];
        if (pref) {
          setUniversity(pref.university ?? '');
          setFaculty(pref.faculty ?? '');
          setDepartment(pref.department ?? '');
        }
      }
    }

    setRemainingCount(getRemainingStatementReviewCount());
    setPrepareFollowUps(getStatementPrepareFollowUpAnswers());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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
    // 入力 validation は cache 判定より前。fetch するかどうか以前に「入力がそもそも妥当か」
    // を確かめる責務で、cache hit でも結果は同じ（invalid 入力で hit させない）。
    const validationError = options.validate?.();
    if (validationError) {
      setError(validationError);
      return;
    }

    // C1 mitigation: studentProfile は page 上位の useMemo で派生済みの stable reference を
    // 閉包経由で参照する。inline で getStudentProfileForFeature() を呼ぶと canonical 不在 user で
    // toStudentProfile() が新 generatedAt を都度生成し inputHash が drift するため。
    // 後方互換のため wallHittingResult は fetch body 側にだけ載せる（API 側で
    // studentProfile が無効なときの prompt fallback に使う）。

    // STEP5.10 / STEP-F: input hash cache を daily limit gate より先に判定する。
    // 同入力なら AI を呼ばずに保存済み response を復元する。limit gate は AI 生成回数の
    // 制御で、cache hit は生成が起きないため bypass する（STEP5.4 と同方針）。
    // history は「ユーザーが確認した添削履歴」semantics として hit 時も append する。
    // 出力 hash (StudentProfile.sourceHash) とは別レーン。
    //
    // INTENTIONAL ASYMMETRY (STEP-F):
    //   - hash 入力（本 call）: canonical studentProfile のみ。wallHittingResult は含めない
    //     （v5 で除外。同素材を 2 object で二重 hash するのを止め canonical 一本化）
    //   - fetch body（下の fetch(...)）: studentProfile / wallHittingResult を両方送る
    //     （route.ts の prompt builder が studentProfile ?? toStudentProfile(wallHittingResult)
    //      で fallback するため、canonical 不在ユーザでも prompt 品質を落とさない）
    //   この非対称は cache identity と prompt 入力を別レーンとして扱う設計。
    //   STEP-F は minimum migration で、studentProfile.generatedAt drift の完全解消は
    //   別 STEP として残す（C1 useMemo が session 内 stabilizer として依然必要）。
    const inputHash = hashStatementReviewInput({
      university,
      faculty,
      department,
      essay,
      basicInfo,
      activityData: activities,
      studentProfile,
      model: STATEMENT_REVIEW_MODEL,
      promptVersion: STATEMENT_REVIEW_PROMPT_VERSION,
    });

    const cached = loadStatementReviewCache();
    if (
      cached &&
      cached.inputHash === inputHash &&
      cached.model === STATEMENT_REVIEW_MODEL &&
      cached.promptVersion === STATEMENT_REVIEW_PROMPT_VERSION
    ) {
      // cache hit: AI を呼ばずに即復元。loading は立てない（spinner flash を避ける）。
      // limit は消費しない（AI call が起きていないため）。
      logAiCache({ route: 'api/statement-review', action: 'hit', inputHash });
      if (options.clearResultOnStart) setResult(null);
      setError('');
      const mapped = mapApiResponse(cached.response);
      setResult(mapped);
      saveReviewHistory({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        university,
        faculty,
        department,
        essay: statementText,
        result: mapped,
      });
      options.afterSuccess?.();
      return;
    }
    logAiCache({ route: 'api/statement-review', action: 'miss', inputHash });

    // cache miss: 通常 AI call 経路。limit gate は ここで効かせる。
    if (!canUseStatementReview()) {
      setError('本日の添削回数上限に達しました。明日またお試しください。');
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
          studentProfile,
          wallHittingResult: wallHitting,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // STEP9.2: 構造化エラー解析を parseStatementReviewError(lib/statement/review/) に抽出済み。
        //   優先順位: data.message → data.error → 固定 fallback 文言。
        setError(parseStatementReviewError(data));
        return;
      }

      const apiResponse = data as ApiReviewResponse;
      const mapped = mapApiResponse(apiResponse);
      setResult(mapped);

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

      // STEP5.10: 成功時のみ cache 書き込み（!res.ok / catch では保存しない）。
      saveStatementReviewCache({
        inputHash,
        model: STATEMENT_REVIEW_MODEL,
        promptVersion: STATEMENT_REVIEW_PROMPT_VERSION,
        savedAt: new Date().toISOString(),
        response: apiResponse,
      });

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
    clearDraft();
  }

  // 過去履歴の閲覧/復元/削除ハンドラ（handleImproveSubmit / handleRestoreHistory /
  // handleDeleteHistoryItem / handleClearHistory）は ③ /statement/score 等に分離した
  // ことで本ページからは未使用となったため除去済み。
  // 保存パス（saveReviewHistory）は cache hit / API 成功の 2 経路に温存している。

  // C1 mitigation: submit disable 条件の single source of truth。
  // mounted 前は localStorage 由来の state (basicInfo / wallHitting / activities / studentProfile)
  // が null のため、submit を発火させると hash 計算に null が混じる。post-hydration まで disable。
  // remainingCount === 0 の gate は既存挙動を維持。
  const submitDisabled = loading || !isMounted || remainingCount === 0;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">

      {/* ── ステップヘッダー ─────────────────────────────── */}
      <StepHeader
        currentStep={1}
        totalSteps={5}
        title="志望理由書を入力する"
        description="入力した志望理由書をAIが添削します。AIは完成文を代筆するのではなく、自分で改善できるようにアドバイスします。"
        backHref="/statement"
        backLabel="志望理由書トップへ"
        nextHref="/statement/score"
        nextLabel="完成度を見る"
      />
      <p className="text-xs text-gray-400 mb-6 -mt-4">
        論理構造・具体性・大学との一致・将来目標・独自性の観点から添削します。
      </p>

      {focusKey && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6">
          <p className="text-sm text-amber-900 leading-relaxed">
            {FOCUS_LABELS[focusKey]}
          </p>
          <p className="text-xs font-semibold text-amber-800 mt-3 mb-1">
            今回見るポイント
          </p>
          <ul className="text-sm text-amber-900 leading-relaxed space-y-1">
            {FOCUS_CHECKLIST[focusKey].map((item) => (
              <li key={item}>・{item}</li>
            ))}
          </ul>
        </div>
      )}

      <BasicInfoSummary basicInfo={basicInfo} />

      {/* ── 書き直しメモ ──────────────────────────────────────────────
          /improve/[slug] で保存された書き直し下書きを、本文の近くで参照できる軽い section。
          statementText には自動反映せず、コピー経由でユーザーが手で取り込む。
          PASSAI 思想: AI が代わりに書くのではなく、受験生が自分の言葉で整える。 */}
      {mounted && rewriteDraftEntries.length > 0 && (
        <section className="bg-blue-50 border border-blue-100 rounded-xl p-4 sm:p-5 mb-6">
          <h2 className="text-sm font-bold text-slate-900 mb-1">
            書き直しメモ
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed mb-4">
            保存した書き直しを見ながら、本文を自分の言葉で整えられます。
          </p>
          <div className="space-y-2">
            {rewriteDraftEntries.map(([axisId, draft]) => {
              const axisLabel = REWRITE_AXIS_LABELS[axisId] ?? axisId;
              return (
                <details
                  key={axisId}
                  className="group bg-white rounded-lg border border-slate-200"
                >
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden px-4 py-3 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800">
                      {axisLabel}
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums flex items-center gap-2">
                      {draft.text.length}文字
                      <span className="text-slate-400 transition-transform group-open:rotate-180 inline-block">
                        ▾
                      </span>
                    </span>
                  </summary>
                  <div className="px-4 pb-4 pt-1">
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words mb-3">
                      {draft.text}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleCopyRewrite(draft.text)}
                      className="text-xs text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-900"
                    >
                      コピー
                    </button>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

      {/* STEP8.4: 入力フォーム section は InputFormView へ logical split 済み。 */}
      <InputFormView
        university={university}
        setUniversity={setUniversity}
        faculty={faculty}
        setFaculty={setFaculty}
        department={department}
        setDepartment={setDepartment}
        statementText={statementText}
        setStatementText={setStatementText}
        rewriteGuide={rewriteGuide}
        setRewriteGuide={setRewriteGuide}
        showInsertedHint={showInsertedHint}
        setShowInsertedHint={setShowInsertedHint}
        mounted={mounted}
        prepareSummary={prepareSummary}
        prepareHistory={prepareHistory}
        rewriteContext={rewriteContext}
        activities={activities}
        prepareFollowUps={prepareFollowUps}
        setPrepareFollowUps={setPrepareFollowUps}
        showReferenceNotes={showReferenceNotes}
        setShowReferenceNotes={setShowReferenceNotes}
        loading={loading}
        remainingCount={remainingCount}
        submitDisabled={submitDisabled}
        onSubmit={handleSubmit}
        onSaveDraft={handleSaveDraft}
        onResetForm={handleReset}
        inputSectionRef={inputSectionRef}
        textareaRef={textareaRef}
      />

      {error && (
        <p className="text-red-600 text-sm mb-6">{error}</p>
      )}

      {/* STEP8.4: 添削結果エリア・次のステップ CTA は ReviewResultView へ logical split 済み。
          ②の責務整理に伴い「もう一度改善する」ボタン / 再添削フォーム / 各評価カードは UI 側で削除済み。
          関連する dead state / dead handler も page.tsx から除去済み。 */}
      <ReviewResultView result={result} />

      {/* STEP8.4: 詳細分析（折りたたみ）内 content は DetailAnalysisAccordionView へ logical split 済み。
          Accordion 自体は layout primitive として page に残す。 */}
      <Accordion title="詳細分析を見る">
        <DetailAnalysisAccordionView
          result={result}
          statementText={statementText}
          university={university}
          faculty={faculty}
          activities={activities}
          onStartRewrite={handleStartRewrite}
          onInsertStarterHint={handleInsertStarterHint}
        />
      </Accordion>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-5 py-2.5 rounded-lg shadow-lg pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}

export default function StatementPage() {
  return (
    <Suspense fallback={null}>
      <StatementPageInner />
    </Suspense>
  );
}

