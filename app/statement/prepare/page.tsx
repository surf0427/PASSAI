'use client';

import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useQuotaDialog } from '@/components/billing/QuotaExceededDialog';
import {
  buildInputSignature,
  clearStatementPrepareFollowUpAnswers,
  getStatementPrepareFollowUpAnswers,
  getStatementPrepareSummary,
  saveStatementPrepareAnswers,
  saveStatementPrepareFollowUpAnswers,
  saveStatementPrepareSummary,
  type StatementPrepareFollowUpAnswers,
} from '@/lib/statement/prepare/statementPrepareStorage';
import {
  canUseStatementPrepare,
  getStatementPrepareLimitStatus,
  incrementStatementPrepareUsage,
  type StatementPrepareLimitStatus,
} from '@/lib/statement/prepare/statementPrepareLimit';
import {
  detectStatementPrepareWeakPoints,
  type StatementPrepareWeakPoint,
  type StatementPrepareWeakPointKey,
} from '@/lib/statement/prepare/detectStatementPrepareWeakPoints';
import {
  detectStatementPrepareLogicGaps,
  type StatementPrepareLogicGap,
} from '@/lib/statement/prepare/detectStatementPrepareLogicGaps';
import {
  evaluateStatementPrepareQuality,
  type StatementPrepareQualityEvaluation,
} from '@/lib/statement/prepare/evaluateStatementPrepareQuality';
import type { FacultyCategory } from '@/lib/facultyCategory';
// STEP 25: 既存 storage helper をそのまま使う（key を直書きしない）。
import { loadActivityData } from '@/lib/activityStorage';
import { loadAnalyzeState } from '@/lib/analyzeStorage';
import type { StatementPrepareMaterial } from '@/lib/statement/prepare/buildStatementPrepareMaterials';
import { cachedSummaryToDisplay } from '@/lib/statement/prepare/cachedSummaryToDisplay';
import type { ActivityData } from '@/types/activity';
import type { PersistedAnalyzeState } from '@/types/analysis';
// STEP8.7: prepare feature 専用 view は app/statement/prepare/components/ 配下へ physical split 済み。
import { MaterialsView } from './components/MaterialsView';
import { PrepareInputView } from './components/PrepareInputView';
import {
  SummaryDisplayView,
  type DisplaySummary,
  type FollowUpAnswers,
} from './components/SummaryDisplayView';


// STEP 13: 429 応答の Retry-After header（秒数文字列）から表示文言を作る。
// 取れない／数値変換できない場合は null を返し、呼び出し側で既存文言にフォールバック。
function formatRetryAfterMessage(retryAfterHeader: string | null): string | null {
  if (!retryAfterHeader) return null;
  const seconds = Number(retryAfterHeader);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) {
    return '短時間での利用回数が上限に達しました。あと1分以内に再度お試しください。';
  }
  const minutes = Math.ceil(seconds / 60);
  return `短時間での利用回数が上限に達しました。あと約${minutes}分後に再度お試しください。`;
}

// API レスポンスがちゃんと5項目揃っているかを確認する。
function isApiResult(value: unknown): value is DisplaySummary {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.impressiveExperience === 'string' &&
    typeof v.feltIssue === 'string' &&
    typeof v.interestInField === 'string' &&
    typeof v.universityLearning === 'string' &&
    typeof v.futureApplication === 'string'
  );
}

// マウント前 false / マウント後 true を返す flag（SSR/hydration セーフ）。
// useSyncExternalStore は server snapshot / client snapshot を React のハイドレーション
// フェーズと協調させるため、setState を使わずに「マウント済み」フラグを表現できる。
// app/self-analysis/page.tsx / app/statement/edit/page.tsx / app/input/basic/page.tsx と同形。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function StatementPreparePage() {
  // STEP-GATE-COMPLETE: 402 quota-exceeded ハンドラ。
  const { handleResponse: handleQuotaResponse, dialog: quotaDialog } =
    useQuotaDialog();

  const router = useRouter();
  const [interest, setInterest] = useState('');
  const [experience, setExperience] = useState('');
  const [future, setFuture] = useState('');
  // 候補カードからの追記時に出す軽量な成功メッセージ（toast）。
  const [quoteToast, setQuoteToast] = useState('');
  const quoteToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [summary, setSummary] = useState<DisplaySummary | null>(null);
  // 表示中の summary がどの入力で作られたか覚えておく。下書き遷移時の再保存に使う。
  const [summarySignature, setSummarySignature] = useState('');
  const [reusedFromCache, setReusedFromCache] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);
  // STEP5.16: mount フラグを useSyncExternalStore に置換。`mounted` alias を残して
  // 既存 JSX の `{mounted && ...}` ガード 3 箇所は無変更維持する。
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  const mounted = isMounted;

  // STEP5.16: 1日あたりの整理回数制限。lazy initializer で localStorage から読む。
  // getStatementPrepareLimitStatus() は SSR で safeStorage 経由 fallback により
  // { count:0, canUse:true, limit:3, remaining:3 } を返す（lib/statementPrepareLimit.ts のコメント参照）。
  // 描画経路: line 737 の {limitStatus.limit} は SSR/client とも常に 3 で一致。
  //          残り（count/canUse/remaining）は line 702/722 で mounted ガード済み → SSR で評価されない。
  const [limitStatus, setLimitStatus] = useState<StatementPrepareLimitStatus>(
    () => getStatementPrepareLimitStatus(),
  );
  // STEP 16: 深掘りメモ。weakPoint key ごとの自由記述。
  // STEP-PAGE-FIX-02-PREPARE: 旧 `useState({}) + mount-init useEffect で setFollowUpAnswers(...)` を
  //   restored(useMemo) + draft(useState) の 2 段に分離して `react-hooks/set-state-in-effect`
  //   違反を解消する。挙動は完全等価:
  //     - SSR / 初回 client render: isMounted=false → restored={} → followUpAnswers={}（hydration セーフ）
  //     - mount 後: isMounted=true → restored が storage 値 → followUpAnswers が storage 値
  //     - user 入力後: draft が non-null → followUpAnswers が draft 値（restored を上書き）
  //   draft が null のうちは restored を使うため、storage 復元タイミングは旧 effect と同じ。
  //   handleFollowUpAnswerChange は setFollowUpAnswersDraft を呼ぶ形に振り替え。
  //   storage への永続化（saveStatementPrepareFollowUpAnswers）は不変。
  const restoredFollowUpAnswers = useMemo<FollowUpAnswers>(
    () => (isMounted ? getStatementPrepareFollowUpAnswers() : {}),
    [isMounted],
  );
  const [followUpAnswersDraft, setFollowUpAnswersDraft] = useState<FollowUpAnswers | null>(null);
  const followUpAnswers: FollowUpAnswers = followUpAnswersDraft ?? restoredFollowUpAnswers;
  // STEP 25: 既存の活動整理 / 自己分析データ。表示専用、書き戻しは行わない。
  // STEP5.16: read-only なので isMounted ガード付きの useMemo 派生に置換。
  // line 531 の `{mounted && (() => { ... })()}` で SSR は描画されないため hydration セーフ。
  const materialActivity = useMemo<ActivityData | null>(
    () => (isMounted ? loadActivityData() : null),
    [isMounted],
  );
  const materialAnalyze = useMemo<PersistedAnalyzeState | null>(
    () => (isMounted ? loadAnalyzeState() : null),
    [isMounted],
  );
  // STEP 29: 学部系統。UI 上のヒント表示にだけ使う（API には送らない、永続化しない）。
  const [facultyCategory, setFacultyCategory] = useState<FacultyCategory>('other');
  // STEP 31: 保存済み整理メモのメタ情報（存在チェックと表示用 updatedAt）。
  // null = 保存メモなし。useState 1 個に集約してフック数増を抑える。
  // STEP5.16: lazy initializer 化。consumer (line 707) が `{mounted && savedSummaryMeta && ...}`
  // で SSR は描画されないため hydration セーフ。setter は line 304/342 で後段 mutate される。
  const [savedSummaryMeta, setSavedSummaryMeta] = useState<{ updatedAt: string } | null>(
    () => {
      const cached = getStatementPrepareSummary();
      return cached ? { updatedAt: cached.updatedAt } : null;
    },
  );
  // STEP 31: 表示中の summary が「以前作った整理メモを見る」経由で復元された状態か。
  const [viewingSavedSummary, setViewingSavedSummary] = useState(false);

  // STEP-PAGE-FIX-02-PREPARE: STEP 23 の「深掘り回答をマウント後に復元」は restoredFollowUpAnswers の
  // useMemo (isMounted ゲート) で表現済みのため、本 effect は不要になった。
  // 旧 effect の semantics:
  //   - mount 後 1 回だけ getStatementPrepareFollowUpAnswers() を読んで state へ反映
  //   - re-run なし（deps=[]）
  // 新 semantics（同等）:
  //   - isMounted が false→true へ遷移する瞬間に useMemo が 1 回だけ getStatementPrepareFollowUpAnswers() を再評価
  //   - isMounted は subscribeMount=() => () => {}（no-op）のため再 fire しない
  //   - SSR / 初回 client render の {} と完全等価

  async function handleSummarize() {
    if (loading) return;

    const allEmpty =
      !interest.trim() && !experience.trim() && !future.trim();
    if (allEmpty) {
      setValidationError('まずは1つだけでも入力してください');
      setApiError('');
      setSummary(null);
      setSummarySignature('');
      setReusedFromCache(false);
      return;
    }
    setValidationError('');
    setApiError('');

    const answers = {
      interestReason: interest,
      memorableExperience: experience,
      futureGoal: future,
    };
    const currentSignature = buildInputSignature(answers);

    // STEP 8: 同じ入力なら API を呼ばずに保存済み summary を再利用する。
    // 旧データには inputSignature が空文字で補完されるため、必ずミスマッチして API へ進む。
    const cached = getStatementPrepareSummary();
    if (cached && cached.inputSignature && cached.inputSignature === currentSignature) {
      saveStatementPrepareAnswers(answers);
      // STEP9.3: 保存済み summary → display 形への field copy は cachedSummaryToDisplay へ抽出済み。
      const display = cachedSummaryToDisplay(cached);
      setSummary(display);
      setSummarySignature(cached.inputSignature);
      setReusedFromCache(true);
      // STEP 31: cache 再利用パスでは「以前のメモを見る」状態ではないので false に。
      setViewingSavedSummary(false);
      setTimeout(() => {
        document.getElementById('summary-result')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 0);
      return;
    }

    setReusedFromCache(false);
    setViewingSavedSummary(false);

    // STEP 10: API を呼ぶ前に1日あたりの利用回数を確認する。
    // 再利用パスに到達した場合はここまで来ないのでカウントの対象外。
    if (!canUseStatementPrepare()) {
      setApiError('本日の整理回数の上限に達しました。明日またお試しください。');
      setLimitStatus(getStatementPrepareLimitStatus());
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/statement-prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answers),
      });

      // STEP-GATE-COMPLETE: 402 quota-exceeded はダイアログに委譲して早期 return。
      // finally で loading 解除されるため state 整合性は保たれる。
      if (await handleQuotaResponse(res)) {
        return;
      }

      // STEP 11: サーバ側 rate limit に引っかかった場合は専用文言を表示する。
      // クライアント側の1日3回カウントは進めない（成功時のみ進める仕様を維持）。
      // STEP 13: Retry-After header があれば「あと約◯分後」を含む文言に差し替え。
      if (res.status === 429) {
        const retryMessage = formatRetryAfterMessage(res.headers.get('Retry-After'));
        setApiError(
          retryMessage ??
            '短時間に整理を繰り返しすぎています。しばらく時間をおいてからお試しください。',
        );
        return;
      }

      if (!res.ok) {
        setApiError('整理に失敗しました。もう一度お試しください。');
        return;
      }

      const data: unknown = await res.json();
      if (!isApiResult(data)) {
        setApiError('整理に失敗しました。もう一度お試しください。');
        return;
      }

      saveStatementPrepareAnswers(answers);
      saveStatementPrepareSummary({ ...data, inputSignature: currentSignature });
      setSummary(data);
      setSummarySignature(currentSignature);
      // STEP 31: 新規生成によって localStorage が更新されたので、
      // 復元ボタンの存在判定とメタを最新化する。
      const fresh = getStatementPrepareSummary();
      if (fresh) setSavedSummaryMeta({ updatedAt: fresh.updatedAt });

      // STEP 10: 成功時のみカウントを進める（失敗時・再利用時はカウントしない）。
      incrementStatementPrepareUsage();
      setLimitStatus(getStatementPrepareLimitStatus());

      setTimeout(() => {
        document.getElementById('summary-result')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 0);
    } catch {
      setApiError('整理に失敗しました。もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  }

  // STEP 31: API を呼ばず、localStorage に保存済みの summary を画面に復元する。
  // 既存 summary 保存 key (`statement_prepare_summary`) をそのまま再利用。
  // 「下書きへ進む」disable は既存 inputChanged ロジックに任せる（signature 不一致なら自動 disable）。
  function handleViewSavedSummary(): void {
    const cached = getStatementPrepareSummary();
    if (!cached) return;
    // STEP9.3: 保存済み summary → display 形への field copy は cachedSummaryToDisplay へ抽出済み。
    const display = cachedSummaryToDisplay(cached);
    setSummary(display);
    setSummarySignature(cached.inputSignature);
    setReusedFromCache(false);
    setViewingSavedSummary(true);
    setApiError('');
    setValidationError('');
    setSavedSummaryMeta({ updatedAt: cached.updatedAt });
    setTimeout(() => {
      document.getElementById('summary-result')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 0);
  }

  // STEP 26: 既存入力末尾に追記する小ヘルパ。空なら丸ごと差し替え、
  // 末尾改行の有無に応じて空行 1 行で区切る。上書きはしない。
  function appendQuoteToText(prev: string, quote: string): string {
    if (!prev.trim()) return quote;
    if (prev.endsWith('\n\n')) return prev + quote;
    if (prev.endsWith('\n')) return prev + '\n' + quote;
    return prev + '\n\n' + quote;
  }

  // 候補カードの追記先：3 つの textarea state に対応。
  // 元の入力スキーマ名（interestReason / impressiveExperience / futureGoal）と
  // 実際の state 名 / 表示ラベル / DOM id をここで一元的に紐付ける。
  type QuoteFieldKey = 'interest' | 'experience' | 'future';
  const FIELD_DISPLAY: Record<QuoteFieldKey, { label: string; domId: string }> = {
    interest:   { label: '興味', domId: 'prepare-q1' },
    experience: { label: '経験', domId: 'prepare-q2' },
    future:     { label: '将来', domId: 'prepare-q3' },
  };

  // 仕様で指定された helper 形式：field 名・ラベル・本文を受け取り、対応 textarea
  // に **末尾追記**（上書きしない）。state 経由なので既存 inputSignature 比較や
  // 「下書きへ進む」disable 条件は自動的に追従する。
  function appendReferenceToField(
    field: QuoteFieldKey,
    label: string,
    text: string,
  ): void {
    const block = `【${label}】\n${text}`;
    const setterByField: Record<QuoteFieldKey, typeof setInterest> = {
      interest:   setInterest,
      experience: setExperience,
      future:     setFuture,
    };
    setterByField[field]((prev) => appendQuoteToText(prev, block));

    // 視覚的フィードバック：3 秒で自動消える toast。
    const display = FIELD_DISPLAY[field];
    setQuoteToast(`${display.label}欄に参考メモを追加しました。`);
    if (quoteToastTimerRef.current !== null) clearTimeout(quoteToastTimerRef.current);
    quoteToastTimerRef.current = setTimeout(() => setQuoteToast(''), 3000);

    // 該当 textarea が画面外にあると「押しても反応しない」と感じやすいので、
    // 直後に該当入力欄までスムーズスクロールする。
    setTimeout(() => {
      document
        .getElementById(display.domId)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }

  // STEP 26: 候補カードの「この内容を参考にする」押下時のディスパッチ。
  //   - 活動整理 → 印象に残っている経験（experience / impressiveExperience）
  //   - 自己分析 → 興味・学部理由（interest / interestReason）
  function handleQuoteMaterial(m: StatementPrepareMaterial): void {
    const labelByLane: Record<StatementPrepareMaterial['source'], string> = {
      活動整理: '活動整理メモ',
      自己分析: '自己分析メモ',
    };
    const fieldByLane: Record<StatementPrepareMaterial['source'], QuoteFieldKey> = {
      活動整理: 'experience',
      自己分析: 'interest',
    };
    const lines: string[] = [m.category];
    if (m.body) lines.push(m.body);
    if (m.reflection) lines.push(`学び：${m.reflection}`);
    if (m.futureConnection) lines.push(`将来とのつながり：${m.futureConnection}`);
    appendReferenceToField(fieldByLane[m.source], labelByLane[m.source], lines.join('\n'));
  }

  // STEP 23: 深掘り回答の編集を都度 localStorage に同期する。
  // 空白だけの値は保存対象から除外し、結果が 0 件なら key を消す（古い残骸を残さない）。
  // 「下書きへ進む」時の保存とはキー・データ形式が一致するため上書き競合は起きない。
  function handleFollowUpAnswerChange(
    key: StatementPrepareWeakPointKey,
    value: string,
  ): void {
    const next: FollowUpAnswers = { ...followUpAnswers, [key]: value };
    // STEP-PAGE-FIX-02-PREPARE: setFollowUpAnswers → setFollowUpAnswersDraft へ振り替え。
    // draft が non-null になった以降は restored を上書きする形で followUpAnswers の effective 値を制御する。
    setFollowUpAnswersDraft(next);
    const filtered: StatementPrepareFollowUpAnswers = {};
    for (const [k, v] of Object.entries(next) as Array<
      [StatementPrepareWeakPointKey, string | undefined]
    >) {
      if ((v ?? '').trim().length > 0 && v !== undefined) filtered[k] = v;
    }
    if (Object.keys(filtered).length > 0) {
      saveStatementPrepareFollowUpAnswers(filtered);
    } else {
      clearStatementPrepareFollowUpAnswers();
    }
  }

  function handleStartDraft() {
    if (!summary) return;
    if (inputChanged) return; // ガード：表示中の整理メモと現在の入力がズレていれば遷移させない
    // 表示中の summary をそのまま再保存してから遷移する。
    // signature は summary 生成時のものを使い、現在のテキスト編集の影響を受けない。
    saveStatementPrepareAnswers({
      interestReason: interest,
      memorableExperience: experience,
      futureGoal: future,
    });
    saveStatementPrepareSummary({
      ...summary,
      inputSignature: summarySignature,
    });

    // STEP 18: 深掘り回答（trim 後 1 文字以上）を localStorage に保存。
    // 0 件のときは前回の残骸を消して、edit 側で古いメモが表示されないようにする。
    if (filledFollowUpAnswers.length > 0) {
      const payload: StatementPrepareFollowUpAnswers = {};
      for (const { key, value } of filledFollowUpAnswers) {
        payload[key] = value;
      }
      saveStatementPrepareFollowUpAnswers(payload);
    } else {
      clearStatementPrepareFollowUpAnswers();
    }

    router.push('/statement/edit');
  }

  // 表示中の整理メモが、いま textarea にある内容と本当に対応しているか毎レンダ確認する。
  // 一致しなければ「下書きへ」ボタンを止め、再整理を促す。
  const currentInputSignature = buildInputSignature({
    interestReason: interest,
    memorableExperience: experience,
    futureGoal: future,
  });
  const inputChanged =
    summary !== null &&
    summarySignature !== '' &&
    summarySignature !== currentInputSignature;
  const draftDisabled = loading || !summary || inputChanged;

  // STEP 14: 整理メモの弱点を簡易判定。summary が無いときは判定しない。
  // 純関数なので useMemo を足さず、毎レンダ計算（5項目 × 軽量正規表現で十分軽い）。
  const weakPoints: StatementPrepareWeakPoint[] | null = summary
    ? detectStatementPrepareWeakPoints(summary)
    : null;

  // STEP 27: 5 項目間の「つながり」を簡易判定（4 ペア）。同じく純関数で毎レンダ。
  const logicGaps: StatementPrepareLogicGap[] | null = summary
    ? detectStatementPrepareLogicGaps(summary)
    : null;

  // STEP 28: 既存の weakPoints / logicGaps を再利用して品質評価を算出。
  // 判定ロジックは既存 helper に委ね、ここでは集約のみ（ロジック重複なし）。
  const qualityEvaluation: StatementPrepareQualityEvaluation | null =
    weakPoints !== null && logicGaps !== null
      ? evaluateStatementPrepareQuality(weakPoints, logicGaps)
      : null;

  // STEP 17: 深掘り回答のうち trim 後に1文字以上あるものだけを抽出（表示専用、保存しない）。
  // followUpAnswers のキーは setFollowUpAnswers 側で WeakPointKey しか入らないため cast は安全。
  const filledFollowUpAnswers: Array<{
    key: StatementPrepareWeakPointKey;
    value: string;
  }> = (
    Object.entries(followUpAnswers) as Array<
      [StatementPrepareWeakPointKey, string | undefined]
    >
  ).flatMap(([key, value]) => {
    const trimmed = value?.trim() ?? '';
    return trimmed ? [{ key, value: trimmed }] : [];
  });

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
          志望理由書を書く前に整理する
        </h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          いきなり完璧な文章を書く必要はありません。<br />
          まずは、あなたの経験・興味・将来像を短く整理しましょう。
        </p>
      </header>

      {/* STEP8.6: これまでに整理した材料 section は MaterialsView へ logical split 済み。
          mounted gate は hydration mismatch 防止のため page-level に維持。 */}
      {mounted && (
        <MaterialsView
          materialActivity={materialActivity}
          materialAnalyze={materialAnalyze}
          onQuoteMaterial={handleQuoteMaterial}
        />
      )}

      {/* STEP8.6: 入力フォーム section は PrepareInputView へ logical split 済み。 */}
      <PrepareInputView
        interest={interest}
        setInterest={setInterest}
        experience={experience}
        setExperience={setExperience}
        future={future}
        setFuture={setFuture}
        facultyCategory={facultyCategory}
        setFacultyCategory={setFacultyCategory}
        validationError={validationError}
        apiError={apiError}
        loading={loading}
        mounted={mounted}
        limitStatus={limitStatus}
        savedSummaryMeta={savedSummaryMeta}
        onSummarize={handleSummarize}
        onViewSavedSummary={handleViewSavedSummary}
      />

      {/* STEP8.6: 整理メモ表示 section は SummaryDisplayView へ logical split 済み。
          summary null 時は何も描画しないため page-level で gate。 */}
      {summary && (
        <SummaryDisplayView
          summary={summary}
          reusedFromCache={reusedFromCache}
          viewingSavedSummary={viewingSavedSummary}
          summarySignature={summarySignature}
          currentInputSignature={currentInputSignature}
          savedSummaryMeta={savedSummaryMeta}
          qualityEvaluation={qualityEvaluation}
          facultyCategory={facultyCategory}
          weakPoints={weakPoints}
          logicGaps={logicGaps}
          filledFollowUpAnswers={filledFollowUpAnswers}
          followUpAnswers={followUpAnswers}
          onFollowUpAnswerChange={handleFollowUpAnswerChange}
          inputChanged={inputChanged}
          draftDisabled={draftDisabled}
          onStartDraft={handleStartDraft}
        />
      )}

      {/* 候補カードからの追記成功トースト */}
      {quoteToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm px-5 py-2.5 rounded-lg shadow-lg pointer-events-none"
        >
          {quoteToast}
        </div>
      )}

      {/* STEP-GATE-COMPLETE: 402 quota-exceeded ダイアログ。 */}
      {quotaDialog}
    </div>
  );
}
