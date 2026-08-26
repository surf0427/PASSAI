'use client';

import { useQuotaDialog } from '@/components/billing/QuotaExceededDialog';

// PASSAI 受験チューターAI のチャットページ。
//
// 役割:
//   - 受験生からのメッセージを受け取り /api/tutor に POST する chat UI
//   - 危険語の client-side 1 次 block（外部窓口誘導）
//   - daily limit（tutorLimit）の連携：UI 表示 + 成功時のみ消費
//   - intent / stabilization 判定（rule-based、AI を呼ばない）
//   - 直近 6 件の messages を history として server に送る（STEP-TUTOR-CONTEXT-01）
//   - **STEP-CHAT-HISTORY-01**: ChatGPT 風のスレッド管理を追加。
//     新しい相談 / 過去 thread 一覧 / 選択 / 削除 / 自動タイトル生成 / suggested starters。
//     現スレッドの messages のみ API へ送る（全 thread を送らない）。
//     localStorage 永続化（Auth / Stripe / user_id には触らない）。
//
// STEP-TUTOR-CONTEXT-03: lastTutorIntent state を保持し、次回 detectTutorIntent 呼び出しに
//   previousIntent として渡すことで「面接が不安 → 答えが出ない → どっちも」型の省略返答 turn でも
//   topic（interview）を継承する。継承ロジック本体は lib/tutor/detectTutorIntent.ts +
//   lib/tutor/tutorPrompt.ts [U-多ターン継承] 側で確定済み。本ファイルは wiring のみ担う。
//
// 含めない:
//   - context 詳細送信は basicInfo + studentProfileCompact の従来形を維持
//   - 機能接続ボタン化（parseTutorReply / TutorSuggestionLink は別 STEP）
//   - Supabase / user_id / Auth との結合（明示的に範囲外）

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { tutorLimit, type DailyUsage } from '@/lib/dailyLimit';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { loadDiagnosisResult } from '@/lib/diagnosisStorage';
import { loadSelfAnalysisLogs } from '@/lib/selfAnalysisLogStorage';
// Exam Spine — device revision claim（Stage 5.0 / E-S2）。純関数のみ。
import { buildTutorDeviceClaimEntries } from '@/lib/examSpine/sync/claim/deviceBasicInfo';
import {
  serializeDeviceClaim,
  withDeviceClaimHeader,
} from '@/lib/examSpine/sync/claim/serialize';
import { EXAM_DEVICE_CLAIM_HEADER } from '@/lib/examSpine/sync/claim/types';
import { getStudentProfileForFeature } from '@/lib/getStudentProfileForFeature';
import { loadReviewHistory } from '@/lib/statement/review/statementStorage';
import { loadActivityData } from '@/lib/activityStorage';
import { loadReviewResult } from '@/lib/essayPracticeStorage';
import { getInterviewRecords } from '@/lib/interviewRecordStorage';
import { isInterviewFeedback } from '@/lib/interview/isInterviewFeedback';
import { loadMypageData, type MypageData } from '@/lib/mypage/loadMypageData';
import { detectTutorIntent } from '@/lib/tutor/detectTutorIntent';
import { detectTutorStabilization } from '@/lib/tutor/detectTutorStabilization';
import type { BasicInfo } from '@/types/basicInfo';
import type { TutorIntent } from '@/lib/tutor/types';
import type {
  SupabaseTutorMessage,
  SupabaseTutorThread,
  TutorChatStore,
  TutorChatThread,
  TutorMessage,
} from '@/types/tutorChat';
import {
  loadTutorChatStore,
  saveTutorChatStore,
  createNewThread,
  deleteThread as deleteThreadFromStore,
  setCurrentThread,
  appendMessage,
  getThread,
  addRestoredThread,
} from '@/lib/tutorChatStorage';
import { useCurrentUserId } from '@/app/components/AuthProvider';
import {
  listTutorThreadsFromSupabase,
  loadTutorMessagesFromSupabase,
  mirrorTutorStoreDelta,
} from '@/lib/supabase/tutorChat';
import { TutorBubble } from './components/TutorBubble';
import { TutorInput } from './components/TutorInput';
import { TutorRemainingCount } from './components/TutorRemainingCount';
import { TutorThreadSidebar } from './components/TutorThreadSidebar';
import { TutorSuggestedStarters } from './components/TutorSuggestedStarters';

// ── 定数 ────────────────────────────────────────────────────────

const TUTOR_DAILY_LIMIT = tutorLimit.getRemainingCount({ date: '', count: 0 });

// ── STEP-CHAT-RESTORE-01: Supabase → localStorage 変換 helper ──
//
// 仕様:
//   role:
//     'system' role は既存 TutorMessage 型に存在しないため **除外**する
//     （assistant 扱いにはしない）。
//   content: そのまま採用。
//   createdAt: Supabase の ISO 文字列をそのまま採用。
//   message id:
//     local_message_id があればそれを採用（mirror 経路で書いた元 id）。
//     なければ `remote-${supabase.id}` を派生 id とする。
//   thread id:
//     remote.localThreadId があればそれを採用。
//     なければ `remote-${supabase.id}` を派生 id とする。
//   タイトル:
//     remote.title をそのまま採用。
//
// 重複防止:
//   同じ thread id が既に store にあれば addRestoredThread が current 切替に倒す。

function deriveLocalThreadIdFromRemote(remote: SupabaseTutorThread): string {
  return remote.localThreadId ?? `remote-${remote.id}`;
}

// ── STEP-TUTOR-CONTEXT-MYPAGE-01 / GROWTH-01: マイページ compact projection ──
//
// loadMypageData() の結果から Tutor 向けに「本文・日付・生スコア・chart series を
// 含まない」compact projection を作る純関数。growth は delta（差分）のみで total は
// 載せない（server builder が定性ラベルへ変換する）。
//
// 呼び出し側は必ず try/catch で包むこと（loadMypageData は localStorage 由来の
// malformed データで throw し得るため）。本関数自体は MypageData の正規 shape を前提に
// 単純 projection するだけで、失敗時のフォールバックは呼び出し側責務。
type TutorMypageProjection = {
  counts: {
    statement: number;
    essay: number;
    interview: number;
    selfAnalysis: number;
    selfPR: number;
  };
  recentFeatures: string[];
  monthlyTopFeatures: string[];
  growth: { statement: number | null; essay: number | null };
};

function buildCompactMypageProjection(mp: MypageData): TutorMypageProjection {
  return {
    counts: {
      statement: mp.summary.statementCount,
      essay: mp.summary.essayReviewCount,
      interview: mp.summary.interviewCount,
      selfAnalysis: mp.summary.selfAnalysisCount,
      selfPR: mp.summary.selfPRCount,
    },
    recentFeatures: mp.recentActivities.map((a) => a.feature),
    monthlyTopFeatures: mp.monthlyRanking.map((m) => m.feature),
    // 成長傾向は delta（最新 − 最古 の差分）のみ。絶対スコア(total)は送らない。
    growth: {
      statement: mp.summary.statementLatest?.delta ?? null,
      essay: mp.summary.essayLatest?.delta ?? null,
    },
  };
}

// 単一 source の取得を独立して try/catch する小 helper。
// どの source が throw しても他の source / API 送信を巻き込まないようにする。
function safeSource<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}

function remoteMessageToLocal(
  m: SupabaseTutorMessage,
): TutorMessage | null {
  if (m.role !== 'user' && m.role !== 'assistant') {
    // 'system' は既存型に無いため捨てる
    return null;
  }
  return {
    id: m.localMessageId ?? `remote-${m.id}`,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
  };
}

function buildRestoredThread(
  remote: SupabaseTutorThread,
  remoteMessages: SupabaseTutorMessage[],
): TutorChatThread {
  const messages = remoteMessages
    .map(remoteMessageToLocal)
    .filter((m): m is TutorMessage => m !== null);
  return {
    id: deriveLocalThreadIdFromRemote(remote),
    title: remote.title,
    messages,
    createdAt: remote.createdAt,
    updatedAt: remote.lastMessageAt ?? remote.updatedAt,
  };
}

const EMERGENCY_PATTERN =
  /(死にたい|死のう|消えたい|いなくなりたい|もう生きていけない|終わりにしたい|自殺|自害)/;

const EMERGENCY_REPLY =
  'いま、ひとりで抱え込みすぎているかもしれません。\n信頼できる大人や、よりそいホットライン(0120-279-338、24時間・無料)など、人と話せる窓口に一度連絡してみてください。';

const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// ── page ────────────────────────────────────────────────────────

export default function TutorPage() {
  // STEP-BILLING-07A: 402 quota-exceeded ハンドラ。
  const { handleResponse: handleQuotaResponse, dialog: quotaDialog } =
    useQuotaDialog();

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // ── thread store ──
  // lazy useState 初期化で localStorage から store をロード（useActivityForm.ts と同形パターン）。
  //   - SSR: safeGetStorage が `typeof window === 'undefined'` ガードで empty store を返す
  //   - Client first render: localStorage から復元（旧 single chat があれば migration が走る）
  // store が空（thread 0 件）のときは初回 send 時に 1 thread を作る lazy 戦略。
  const [store, setStore] = useState<TutorChatStore>(loadTutorChatStore);

  // STEP-CHAT-PERSISTENCE-01: Supabase mirror 用に「直前の store」を保持し、
  // localStorage 保存後に差分を auth-scoped table へ best-effort 同期する。
  //   - currentUserId が無いタイミングでの追加分は mirror されない（仕様通り）。
  //   - 初回マウント時の既存 thread / message は同期しない（過去履歴移行は別 STEP）。
  //   - mirror の成否は UI に伝えない（fire-and-forget）。
  const currentUserId = useCurrentUserId();
  const prevStoreRef = useRef<TutorChatStore | null>(null);

  // STEP-CHAT-SIDEBAR-01: Supabase 側にも保存されている thread 一覧を
  // 補助的に取得し、サイドバーへ渡す。
  //   - 取得元: lib/supabase/tutorChat.ts:listTutorThreadsFromSupabase
  //   - 所有者: currentUserId (= auth.uid())。display_user_id は使わない。
  //   - 失敗時: 空配列のまま。サイドバーは localStorage のみで表示し続ける。
  //   - 復元はしない（thread 選択は localStorage に閉じる、本 STEP の非ゴール）。
  const [remoteThreads, setRemoteThreads] = useState<SupabaseTutorThread[]>([]);
  useEffect(() => {
    if (!isMounted || !currentUserId) {
      // 未マウント / 未ログイン時は remote thread を空に保つ意図的な同期（挙動は変更しない）。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemoteThreads([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await listTutorThreadsFromSupabase(currentUserId);
      if (cancelled) return;
      if (result.kind === 'ok') {
        setRemoteThreads(result.threads);
      } else {
        // no-env / error: fallback は「localStorage のみで表示」。state は空に保つ。
        setRemoteThreads([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isMounted, currentUserId, store]);

  // store が変わるたびに永続化（初回 render はスキップ）。
  // setState-in-effect ではなく、user 操作起点で setStore された結果を save するだけの sync effect。
  useEffect(() => {
    if (!isMounted) return;
    try {
      saveTutorChatStore(store);
    } catch {
      // ignore（safeStorage 内部でも try/catch 済）
    }
    if (currentUserId) {
      void mirrorTutorStoreDelta({
        prev: prevStoreRef.current,
        next: store,
        userId: currentUserId,
      });
    }
    prevStoreRef.current = store;
  }, [isMounted, store, currentUserId]);

  const currentThread = useMemo(
    () => getThread(store, store.currentThreadId),
    [store],
  );
  const messages = currentThread?.messages ?? [];

  // ── input / loading / error ──
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── intent 継承 ──
  const [lastTutorIntent, setLastTutorIntent] = useState<TutorIntent | undefined>(
    undefined,
  );

  // ── daily usage ──
  const [postApiUsage, setPostApiUsage] = useState<DailyUsage | null>(null);
  const usage = useMemo<DailyUsage>(() => {
    if (postApiUsage !== null) return postApiUsage;
    if (!isMounted) return { date: '', count: 0 };
    return tutorLimit.loadUsage();
  }, [isMounted, postApiUsage]);
  const remaining = tutorLimit.getRemainingCount(usage);
  const canUse = tutorLimit.canUse(usage);

  // ── basicInfo / studentProfile (compact) ──
  const basicInfo = useMemo<BasicInfo | null>(() => {
    if (!isMounted) return null;
    try {
      return loadBasicInfo();
    } catch {
      return null;
    }
  }, [isMounted]);

  const studentProfileCompact = useMemo<
    {
      summary: string;
      strengths: string[];
      weaknesses: string[];
      futureConnections: string[];
      valueKeywords: string[];
      signatureEpisodes: { title: string }[];
    } | null
  >(() => {
    if (!isMounted) return null;
    try {
      const profile = getStudentProfileForFeature();
      if (!profile) return null;
      const summary = profile.summary?.trim() ?? '';
      if (summary === '') return null;
      return {
        summary,
        strengths: Array.isArray(profile.strengths) ? profile.strengths.slice(0, 3) : [],
        weaknesses: Array.isArray(profile.weaknesses) ? profile.weaknesses.slice(0, 2) : [],
        futureConnections: Array.isArray(profile.futureConnections)
          ? profile.futureConnections.slice(0, 2)
          : [],
        valueKeywords: Array.isArray(profile.valueKeywords)
          ? profile.valueKeywords.slice(0, 3)
          : [],
        signatureEpisodes: Array.isArray(profile.signatureEpisodes)
          ? profile.signatureEpisodes
              .slice(0, 1)
              .map((e) => ({ title: typeof e?.title === 'string' ? e.title.trim() : '' }))
              .filter((e) => e.title !== '')
          : [],
      };
    } catch {
      return null;
    }
  }, [isMounted]);

  // ── studentContext 用 横断データ（STEP-TUTOR-STUDENT-CONTEXT） ──
  // PASSAI 内の各機能の保存データを localStorage から集め、/api/tutor に送る。
  // server は localStorage を読めないため、横断要約の素材は client が body で渡す。
  //   - statementReviewLatest: 志望理由書レビュー履歴の直近 1 件の result（StatementResult）。
  //     essay 本文など重い field は載せず result のみ送る。
  //   - activityData: 活動データ全体（builder 側で件数のみ要約）。
  //   - essayReviewLatest: 小論文添削の直近結果（SavedReview）。
  //   - interviewRecordLatest: 面接練習履歴の直近 1 件（StoredInterviewRecord）。
  //   - interviewFeedbackLatest: 直近記録の feedbackJson を parse + guard した InterviewFeedback。
  //     parse 失敗・guard 不通過・未保存はすべて null（builder 側は record の自己記録に fallback）。
  //   - mypageSummary: マイページ集約状況の compact projection（STEP-TUTOR-CONTEXT-MYPAGE-01）。
  //     本文・日付・生スコア・chart series は載せず、機能別件数と feature enum 配列のみ送る。
  //     定性圧縮（件数→状態 / 推奨 / ラベル）は server 側 builder に集約する。
  // いずれも失敗時は null に倒す（送信失敗で chat を壊さない）。
  const studentContextSources = useMemo<{
    statementReviewLatest: unknown | null;
    activityData: unknown | null;
    essayReviewLatest: unknown | null;
    interviewRecordLatest: unknown | null;
    interviewFeedbackLatest: unknown | null;
    mypageSummary: unknown | null;
  } | null>(() => {
    if (!isMounted) return null;

    // STEP-TUTOR-API-FAIL-DEBUG-01: 各 source を独立して try/catch する。
    // どの source（loadMypageData / growth 含む）が throw しても、null に倒すだけで
    // 他の source・/api/tutor の送信を絶対に巻き込まない（送信は常に継続する）。
    //
    // STEP（payload スリム化）: builder が実際に読む field だけを compact projection で送る。
    // feedbackJson 全文・面接 Q&A 本文・betterAnswer・essayBodySnapshot・志望理由書の
    // strengths/actions/評価・活動本文は一切載せない（本文除外 + 重複送信除去）。

    // 志望理由書レビュー: builder は weaknesses のみ参照。
    const statementReviewLatest = safeSource(() => {
      const result = loadReviewHistory()[0]?.result;
      if (!result) return null;
      return {
        weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses : [],
      };
    });

    // 活動: builder はカテゴリ別件数のみ参照。本文を載せず counts だけ送る。
    const activityData = safeSource(() => {
      const a = loadActivityData();
      if (!a) return null;
      return {
        counts: {
          clubActivities: a.clubActivities.length,
          volunteerActivities: a.volunteerActivities.length,
          studyAbroadActivities: a.studyAbroadActivities.length,
          researchActivities: a.researchActivities.length,
          partTimeJobActivities: a.partTimeJobActivities.length,
          certificationActivities: a.certificationActivities.length,
          contestActivities: a.contestActivities.length,
          readingActivities: a.readingActivities.length,
          hobbyActivities: a.hobbyActivities.length,
          otherActivities: a.otherActivities.length,
        },
      };
    });

    // 小論文添削: builder は weakPoints のみ参照（essayBodySnapshot 等は送らない）。
    const essayReviewLatest = safeSource(() => {
      const review = loadReviewResult();
      if (!review) return null;
      return {
        weakPoints: Array.isArray(review.weakPoints) ? review.weakPoints : [],
      };
    });

    // 面接: record は improvementSummary / whatWentWrong のみ、feedback は improvements のみ。
    // feedbackJson 全文・Q&A 本文・betterAnswer は載せない（重複・本文を除去）。
    const interviewRecord = safeSource(() => getInterviewRecords()[0] ?? null);
    let interviewRecordLatest: unknown | null = null;
    let interviewFeedbackLatest: unknown | null = null;
    if (interviewRecord) {
      interviewRecordLatest = {
        improvementSummary: interviewRecord.improvementSummary ?? '',
        whatWentWrong: interviewRecord.whatWentWrong ?? '',
      };
      if (interviewRecord.feedbackJson) {
        const parsed = safeSource<unknown>(() =>
          JSON.parse(interviewRecord.feedbackJson as string),
        );
        if (isInterviewFeedback(parsed)) {
          interviewFeedbackLatest = { improvements: parsed.improvements };
        }
      }
    }

    // マイページ集約 → Tutor 向け compact projection。
    // loadMypageData / projection いずれの失敗も null に倒す（推奨修正パターン）。
    const mypageSummary = safeSource(() =>
      buildCompactMypageProjection(loadMypageData()),
    );

    return {
      statementReviewLatest,
      activityData,
      essayReviewLatest,
      interviewRecordLatest,
      interviewFeedbackLatest,
      mypageSummary,
    };
  }, [isMounted]);

  // ── thread 操作 ──
  function handleCreateThread() {
    setStore((prev) => createNewThread(prev));
    setInput('');
    setError('');
    setLastTutorIntent(undefined);
  }

  function handleSelectThread(threadId: string) {
    setStore((prev) => setCurrentThread(prev, threadId));
    setInput('');
    setError('');
    setLastTutorIntent(undefined);
  }

  function handleDeleteThread(threadId: string) {
    setStore((prev) => deleteThreadFromStore(prev, threadId));
  }

  // ── STEP-CHAT-RESTORE-01: remote thread の取り込み ──
  //
  // - currentUserId が null なら何もしない（auth が確立していない）。
  // - 同じ localThreadId が既に store にあれば再 fetch せず current に切り替える。
  // - load 成功 → addRestoredThread で先頭に追加 + current にする。既存 useEffect が
  //   localStorage 永続化 + Supabase delta mirror を処理（mirror は差分ゼロなので no-op）。
  // - load 失敗 → error state にメッセージを出すだけ。UI は壊さない。
  const [restoringRemoteId, setRestoringRemoteId] = useState<string | null>(null);

  async function handleRestoreRemoteThread(remote: SupabaseTutorThread) {
    if (!currentUserId) return;
    if (restoringRemoteId !== null) return;

    const derivedLocalId = deriveLocalThreadIdFromRemote(remote);
    const existing = store.threads.find((t) => t.id === derivedLocalId);
    if (existing) {
      setStore((prev) => setCurrentThread(prev, derivedLocalId));
      setInput('');
      setError('');
      setLastTutorIntent(undefined);
      return;
    }

    setRestoringRemoteId(remote.id);
    setError('');
    try {
      const result = await loadTutorMessagesFromSupabase({
        userId: currentUserId,
        threadId: remote.id,
      });
      if (result.kind !== 'ok') {
        setError('履歴の復元に失敗しました');
        return;
      }
      const thread = buildRestoredThread(remote, result.messages);
      setStore((prev) => addRestoredThread(prev, thread));
      setInput('');
      setLastTutorIntent(undefined);
    } catch {
      // 念のための catch（helper 内で吸収済みのため通常到達しない）
      setError('履歴の復元に失敗しました');
    } finally {
      setRestoringRemoteId(null);
    }
  }

  // ── handleSubmit ──
  async function handleSubmit() {
    const message = input.trim();
    if (message === '' || loading) return;

    // emergency client-side block: API を呼ばず、tutorLimit も消費しない
    if (EMERGENCY_PATTERN.test(message)) {
      let workingStore = store;
      // 現在 thread が無ければ作る
      if (!workingStore.currentThreadId) {
        workingStore = createNewThread(workingStore);
      }
      const threadId = workingStore.currentThreadId!;
      workingStore = appendMessage(workingStore, threadId, { role: 'user', content: message });
      workingStore = appendMessage(workingStore, threadId, {
        role: 'assistant',
        content: EMERGENCY_REPLY,
      });
      setStore(workingStore);
      setInput('');
      setError('');
      return;
    }

    if (!canUse) {
      setError('今日の相談回数の上限に達しました。明日また来てください。');
      return;
    }

    const baseIntent = detectTutorIntent({ message, previousIntent: lastTutorIntent });
    const intent: TutorIntent = detectTutorStabilization(message)
      ? 'stabilize'
      : baseIntent;

    // 現スレッド確保（無ければ新規作成）+ user message を即時追加（送信中も画面に残る）。
    // 失敗時に user message を消さない要件（要件 9）はこの設計で自然に満たされる。
    let workingStore = store;
    if (!workingStore.currentThreadId) {
      workingStore = createNewThread(workingStore);
    }
    const threadId = workingStore.currentThreadId!;
    workingStore = appendMessage(workingStore, threadId, { role: 'user', content: message });
    setStore(workingStore);
    setInput('');
    setError('');
    setLoading(true);

    // API に送るのは現スレッドの最新 6 件のみ。全 thread は絶対に送らない。
    const currentMessages = getThread(workingStore, threadId)?.messages ?? [];
    // append された user message が末尾にあるため、最後の 1 件を除いた直前 6 件を history とする
    // （server 側は今回 user message を別 field で受ける既存 contract）。
    const historyForApi = currentMessages.slice(-7, -1).map((m) => ({
      role: m.role,
      text: m.content,
    }));

    const requestBody = {
      message,
      intent,
      history: historyForApi,
      basicInfo,
      studentProfile: studentProfileCompact,
      // STEP-TUTOR-STUDENT-CONTEXT: 横断要約 studentContext の素材。
      statementReviewLatest: studentContextSources?.statementReviewLatest ?? null,
      activityData: studentContextSources?.activityData ?? null,
      essayReviewLatest: studentContextSources?.essayReviewLatest ?? null,
      // STEP-TUTOR-CONTEXT-INTERVIEW-01: 面接練習の横断課題素材。
      interviewRecordLatest: studentContextSources?.interviewRecordLatest ?? null,
      interviewFeedbackLatest: studentContextSources?.interviewFeedbackLatest ?? null,
      // STEP-TUTOR-CONTEXT-MYPAGE-01: マイページ集約状況の compact projection。
      mypageSummary: studentContextSources?.mypageSummary ?? null,
    };

    // ── Exam Spine device revision claim（Stage 5.0 / E-S2）──────────
    //
    //   device canonical（localStorage `basicFormData`）から算出した content 由来 token を
    //   header で申告する。server はこれを **negative safety gate** の入力にのみ使い、
    //   一致しない限り server 側 mirror を canonical として採用しない。
    //
    //   ★ 回答生成には影響しない ★
    //     Stage 5.0 では consumer の prompt / 出力経路を一切変えない。
    //     header が無くても・壊れていても request は従来どおり成立する。
    //
    //   ★ 本文・氏名・userId は送らない ★
    //     serializer が受け取るのは kind と token だけ（型で閉じている）。
    //   ★ 既存 header を壊さない ★
    //     Content-Type は上書きせず、claim が無ければ header 自体を付けない。
    //   Stage 5.2: diagnosis も申告する（class 1 なので claim が無いと
    //   canonical block が生成されない / G1）。localStorage は読み取りのみ。
    const deviceClaimHeader = serializeDeviceClaim(
      //   Stage 5.3: activity も申告する（G6）。**device canonical の
      //   ActivityData 本体**を渡す（body に載せている counts 射影ではない）。
      //   Stage 5.4: self_analysis も申告する（G7）。履歴 list なので
      //   window 選択（server の read cap と同じ上位 N 件）は canonical view が行う。
      buildTutorDeviceClaimEntries(
        basicInfo,
        loadDiagnosisResult(),
        loadActivityData(),
        loadSelfAnalysisLogs(),
      ),
    );

    try {
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: withDeviceClaimHeader(
          { 'Content-Type': 'application/json' },
          EXAM_DEVICE_CLAIM_HEADER,
          deviceClaimHeader,
        ),
        body: JSON.stringify(requestBody),
      });

      // STEP-BILLING-07A: 402 quota-exceeded はダイアログに委譲して早期 return。
      // user message は thread に残るので、解約 / アップグレード後に再送できる。
      if (await handleQuotaResponse(res)) {
        return;
      }

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        // ignore
      }

      const dataObj =
        typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};

      if (!res.ok) {
        // status 別にユーザー向けメッセージを分岐。
        //   401（unauthenticated）は route が message を返さないため、ここで明示分岐する。
        let errorMessage: string;
        if (res.status === 401) {
          errorMessage = 'ログインが必要です。ログインしてから、もう一度お試しください。';
        } else if (typeof dataObj.message === 'string') {
          errorMessage = dataObj.message;
        } else {
          errorMessage = 'AIの呼び出しに失敗しました。時間をおいてお試しください。';
        }
        setError(errorMessage);
        return;
      }

      const reply = dataObj.reply;
      if (typeof reply !== 'string' || reply.trim() === '') {
        setError('AIの返答を取得できませんでした。');
        return;
      }

      // assistant 返答を append（成功時のみ）。失敗時は user message が残り、再送できる。
      setStore((prev) => appendMessage(prev, threadId, { role: 'assistant', content: reply }));

      const next = tutorLimit.incrementUsage(usage);
      setPostApiUsage(next);
      setLastTutorIntent(baseIntent);
    } catch {
      setError('通信エラーが発生しました。インターネット接続を確認してください。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col sm:flex-row min-h-screen bg-white">
      {isMounted && (
        <TutorThreadSidebar
          threads={store.threads}
          currentThreadId={store.currentThreadId}
          onSelect={handleSelectThread}
          onCreate={handleCreateThread}
          onDelete={handleDeleteThread}
          remoteThreads={remoteThreads}
          onRestoreRemote={handleRestoreRemoteThread}
          restoringRemoteId={restoringRemoteId}
        />
      )}

      <main className="flex-1 mx-auto max-w-2xl w-full px-4 py-6 sm:py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-gray-800 mb-2">受験チューターAI</h1>
          <p className="text-sm text-gray-600 leading-relaxed">
            気になってることを、そのまま書いて大丈夫です。
          </p>
        </header>

        {isMounted && (
          <div className="mb-4">
            <TutorRemainingCount remaining={remaining} limit={TUTOR_DAILY_LIMIT} />
          </div>
        )}

        <div className="space-y-3 mb-4 min-h-[200px]">
          {isMounted && messages.length === 0 && !loading && (
            <TutorSuggestedStarters onPick={(text) => setInput(text)} />
          )}
          {/* HYDRATION-DEBUG-01: messages は localStorage (= client only) 由来。
              SSR では空、client hydration で復元 thread の messages が増える
              ため、isMounted (= post-hydration) でのみ render して mismatch を避ける。 */}
          {isMounted &&
            messages.map((msg) => (
              <TutorBubble key={msg.id} role={msg.role} text={msg.content} />
            ))}
          {loading && (
            <div className="flex justify-start">
              <div className="max-w-[85%] sm:max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed bg-gray-100 text-gray-500">
                整理しています…
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-500 mb-3" role="alert">
            {error}
          </p>
        )}

        <TutorInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          disabled={!canUse}
          loading={loading}
        />
      </main>

      {/* STEP-BILLING-07A: 402 quota-exceeded ダイアログ。 */}
      {quotaDialog}
    </div>
  );
}
