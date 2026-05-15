'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/Label';
import { AlertBox } from '@/components/ui/AlertBox';
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
  getStatementPrepareFollowUpQuestions,
  STATEMENT_PREPARE_FOLLOW_UP_LABELS,
  type StatementPrepareWeakPoint,
  type StatementPrepareWeakPointKey,
  type StatementPrepareWeakPointSeverity,
} from '@/lib/statement/prepare/detectStatementPrepareWeakPoints';
import {
  detectStatementPrepareLogicGaps,
  type StatementPrepareLogicGap,
} from '@/lib/statement/prepare/detectStatementPrepareLogicGaps';
import {
  evaluateStatementPrepareQuality,
  type StatementPrepareQualityEvaluation,
  type StatementPrepareQualityLevel,
} from '@/lib/statement/prepare/evaluateStatementPrepareQuality';
import {
  FACULTY_CATEGORY_LIST,
  getFacultyCategoryCheckpoints,
  getFacultyCategoryLabel,
  isFacultyCategory,
  type FacultyCategory,
} from '@/lib/facultyCategory';
import {
  getStatementDraftStructureGuide,
  getStatementDraftStructureSummaryKeyLabel,
} from '@/lib/statement/prepare/getStatementDraftStructureGuide';
// STEP 25: 既存 storage helper をそのまま使う（key を直書きしない）。
import { loadActivityData } from '@/lib/activityStorage';
import { loadAnalyzeState } from '@/lib/analyzeStorage';
import {
  buildStatementPrepareMaterials,
  type StatementPrepareMaterial,
} from '@/lib/statement/prepare/buildStatementPrepareMaterials';
import type { ActivityData } from '@/types/activity';
import type { PersistedAnalyzeState } from '@/types/analysis';

// 整理メモの“表示用”形（5項目のみ）。storage 型は inputSignature / updatedAt を持つが、
// このページの state ではそれらは別管理にして表示と分ける。
type DisplaySummary = {
  impressiveExperience: string;
  feltIssue: string;
  interestInField: string;
  universityLearning: string;
  futureApplication: string;
};

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

// STEP 16: 深掘りメモ。永続化しないので localStorage は使わない（ページ更新で消える前提）。
type FollowUpAnswers = Partial<Record<StatementPrepareWeakPointKey, string>>;

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

export default function StatementPreparePage() {
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
  // 1日あたりの整理回数制限。SSR と一致させるため初期値は固定（limit=3, 全消費なし）。
  // マウント後に useEffect で localStorage の実値に差し替える。
  const [limitStatus, setLimitStatus] = useState<StatementPrepareLimitStatus>({
    canUse: true,
    count: 0,
    limit: 3,
    remaining: 3,
  });
  const [mounted, setMounted] = useState(false);
  // STEP 16: 深掘りメモ。weakPoint key ごとの自由記述。永続化しない。
  const [followUpAnswers, setFollowUpAnswers] = useState<FollowUpAnswers>({});
  // STEP 25: 既存の活動整理 / 自己分析データ。表示専用、書き戻しは行わない。
  const [materialActivity, setMaterialActivity] = useState<ActivityData | null>(null);
  const [materialAnalyze, setMaterialAnalyze] = useState<PersistedAnalyzeState | null>(null);
  // STEP 29: 学部系統。UI 上のヒント表示にだけ使う（API には送らない、永続化しない）。
  const [facultyCategory, setFacultyCategory] = useState<FacultyCategory>('other');
  // STEP 31: 保存済み整理メモのメタ情報（存在チェックと表示用 updatedAt）。
  // null = 保存メモなし。useState 1 個に集約してフック数増を抑える。
  const [savedSummaryMeta, setSavedSummaryMeta] = useState<{ updatedAt: string } | null>(null);
  // STEP 31: 表示中の summary が「以前作った整理メモを見る」経由で復元された状態か。
  const [viewingSavedSummary, setViewingSavedSummary] = useState(false);

  useEffect(() => {
    setLimitStatus(getStatementPrepareLimitStatus());
    // STEP 23: 深掘り回答もマウント後に復元（trim 済み・既知 key だけが返ってくる）。
    setFollowUpAnswers(getStatementPrepareFollowUpAnswers());
    // STEP 25: 既存の自己分析・活動整理を読み込み（表示専用、書き戻ししない）。
    setMaterialActivity(loadActivityData());
    setMaterialAnalyze(loadAnalyzeState());
    // STEP 31: 保存済み整理メモのメタ情報を読み込み（あればボタンを表示）。
    const cached = getStatementPrepareSummary();
    if (cached) setSavedSummaryMeta({ updatedAt: cached.updatedAt });
    setMounted(true);
  }, []);

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
      const display: DisplaySummary = {
        impressiveExperience: cached.impressiveExperience,
        feltIssue: cached.feltIssue,
        interestInField: cached.interestInField,
        universityLearning: cached.universityLearning,
        futureApplication: cached.futureApplication,
      };
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
    const display: DisplaySummary = {
      impressiveExperience: cached.impressiveExperience,
      feltIssue:            cached.feltIssue,
      interestInField:      cached.interestInField,
      universityLearning:   cached.universityLearning,
      futureApplication:    cached.futureApplication,
    };
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
    setFollowUpAnswers(next);
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

      {/* STEP 25: これまでに整理した材料（自己分析・活動整理）を参考表示。
          mounted 後にだけ描画して hydration mismatch を防ぐ。書き戻しは行わない。 */}
      {mounted && (() => {
        const materials = buildStatementPrepareMaterials(materialActivity, materialAnalyze);
        return (
          <Card className="mb-6 bg-slate-50 border-slate-200">
            <h2 className="text-base font-bold text-slate-900 mb-1">
              これまでに整理した材料
            </h2>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              自己分析や活動整理で入力した内容です。志望理由書の材料として使えそうなものがあれば参考にしてください。
            </p>
            {materials.length === 0 ? (
              <p className="text-xs text-slate-400">
                まだ自己分析・活動整理の材料はありません。
              </p>
            ) : (
              <ul className="space-y-3">
                {materials.map((m: StatementPrepareMaterial) => (
                  <li
                    key={m.id}
                    className="rounded-lg bg-white border border-slate-200 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          m.source === '活動整理'
                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                            : 'bg-violet-100 text-violet-700 border border-violet-200'
                        }`}
                      >
                        {m.source}
                      </span>
                      <span className="text-sm font-semibold text-slate-700">
                        {m.category}
                      </span>
                    </div>
                    {m.body && (
                      <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                        {m.body}
                      </p>
                    )}
                    {m.reflection && (
                      <p className="text-xs text-slate-500 mt-1">
                        <span className="font-semibold">学び：</span>
                        {m.reflection}
                      </p>
                    )}
                    {m.futureConnection && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        <span className="font-semibold">将来とのつながり：</span>
                        {m.futureConnection}
                      </p>
                    )}
                    {/* STEP 26: 種類に応じた textarea 末尾へ追記。 */}
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleQuoteMaterial(m)}
                        className="text-xs text-blue-600 hover:text-blue-800 underline underline-offset-2"
                      >
                        この内容を{m.source === '活動整理' ? '「経験」' : '「興味」'}に参考にする
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })()}

      {/* ── 入力フォーム ── */}
      <Card className="mb-6">
        <div className="space-y-6">
          {/* STEP 29: 学部系統 select。API には送らず、整理結果画面のヒント表示にだけ使う。 */}
          <div>
            <Label htmlFor="prepare-faculty">志望学部の系統</Label>
            <p className="text-xs text-gray-500 mb-2 -mt-1">
              大学DBが入るまでは、学部系統に合わせて確認ポイントを出します。
            </p>
            <select
              id="prepare-faculty"
              value={facultyCategory}
              onChange={(e) => {
                const v = e.target.value;
                if (isFacultyCategory(v)) setFacultyCategory(v);
              }}
              disabled={loading}
              className="w-full sm:w-72 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {FACULTY_CATEGORY_LIST.map((c) => (
                <option key={c} value={c}>
                  {getFacultyCategoryLabel(c)}
                </option>
              ))}
            </select>
          </div>

          {/* 質問1 */}
          <div>
            <Label htmlFor="prepare-q1">
              なぜその分野・学部に興味を持ちましたか？
            </Label>
            <p className="text-xs text-gray-500 mb-2 -mt-1">
              きっかけだけでもOKです。短くて構いません。
            </p>
            <Textarea
              id="prepare-q1"
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
              rows={4}
              placeholder="例：高校の授業で扱ったテーマが面白かった／ニュースで気になった話題があった　など"
              className="resize-y"
              disabled={loading}
            />
          </div>

          {/* 質問2 */}
          <div>
            <Label htmlFor="prepare-q2">
              印象に残っている経験はありますか？
            </Label>
            <p className="text-xs text-gray-500 mb-2 -mt-1">
              部活・探究・留学・アルバイト・資格・読書・趣味など、何でもOK。1〜2行でも十分です。
            </p>
            <Textarea
              id="prepare-q2"
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              rows={4}
              placeholder="例：探究で地域の商店街を取材した／海外短期留学で価値観の違いに驚いた　など"
              className="resize-y"
              disabled={loading}
            />
          </div>

          {/* 質問3 */}
          <div>
            <Label htmlFor="prepare-q3">
              将来どんなことをしたいですか？
            </Label>
            <p className="text-xs text-gray-500 mb-2 -mt-1">
              まだ決まっていなくても、「興味がある方向性」で大丈夫です。
            </p>
            <Textarea
              id="prepare-q3"
              value={future}
              onChange={(e) => setFuture(e.target.value)}
              rows={4}
              placeholder="例：地域に関わる仕事がしたい／海外と関わりたい／まだ模索中　など"
              className="resize-y"
              disabled={loading}
            />
          </div>
        </div>

        {validationError && (
          <AlertBox variant="warning" className="mt-6">
            {validationError}
          </AlertBox>
        )}

        {apiError && (
          <AlertBox variant="error" className="mt-6">
            {apiError}
          </AlertBox>
        )}

        <div className="flex flex-wrap items-center gap-3 mt-6">
          <Button
            variant="primary"
            onClick={handleSummarize}
            disabled={loading || (mounted && !limitStatus.canUse)}
          >
            {loading ? '整理中...' : '整理する'}
          </Button>
          {/* STEP 31: 保存済み整理メモがあるときだけ表示。API は呼ばない復元ボタン。 */}
          {mounted && savedSummaryMeta && (
            <Button
              variant="secondary"
              size="md"
              onClick={handleViewSavedSummary}
              disabled={loading}
            >
              以前作った整理メモを見る
            </Button>
          )}
          <LinkButton href="/statement" variant="secondary" size="md">
            戻る
          </LinkButton>
          <span className="ml-auto text-xs text-slate-500">
            本日の整理回数：
            {mounted ? (
              <span
                className={
                  limitStatus.remaining === 0
                    ? 'text-red-500 font-semibold'
                    : limitStatus.remaining === 1
                      ? 'text-yellow-600 font-semibold'
                      : 'text-slate-700 font-semibold'
                }
              >
                {limitStatus.count}
              </span>
            ) : (
              <span className="text-slate-400">-</span>
            )}
            <span className="text-slate-400"> / {limitStatus.limit} 回</span>
          </span>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          ※ 同じ入力で再表示する場合（保存済み再利用）はカウントされません。
        </p>
      </Card>

      {/* ── 整理メモ ── */}
      {summary && (
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
          {summary && (
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
          )}

          {/* STEP 30: 下書きの構成ガイド。AI を呼ばず固定テンプレを学部系統で出し分け。
              本文 textarea への自動挿入は行わない。 */}
          {summary && (() => {
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
                              handleFollowUpAnswerChange(wp.key, e.target.value)
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
              onClick={handleStartDraft}
              disabled={draftDisabled}
            >
              {inputChanged
                ? '再整理してから下書きへ進む'
                : 'この整理をもとに下書きを書く →'}
            </Button>
          </div>
        </section>
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
    </div>
  );
}
