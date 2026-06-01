'use client';

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

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { tutorLimit, type DailyUsage } from '@/lib/dailyLimit';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { getStudentProfileForFeature } from '@/lib/getStudentProfileForFeature';
import { detectTutorIntent } from '@/lib/tutor/detectTutorIntent';
import { detectTutorStabilization } from '@/lib/tutor/detectTutorStabilization';
import type { BasicInfo } from '@/types/basicInfo';
import type { TutorIntent } from '@/lib/tutor/types';
import type { TutorChatStore } from '@/types/tutorChat';
import {
  loadTutorChatStore,
  saveTutorChatStore,
  createNewThread,
  deleteThread as deleteThreadFromStore,
  setCurrentThread,
  appendMessage,
  getThread,
} from '@/lib/tutorChatStorage';
import { TutorBubble } from './components/TutorBubble';
import { TutorInput } from './components/TutorInput';
import { TutorRemainingCount } from './components/TutorRemainingCount';
import { TutorThreadSidebar } from './components/TutorThreadSidebar';
import { TutorSuggestedStarters } from './components/TutorSuggestedStarters';

// ── 定数 ────────────────────────────────────────────────────────

const TUTOR_DAILY_LIMIT = tutorLimit.getRemainingCount({ date: '', count: 0 });

const EMERGENCY_PATTERN =
  /(死にたい|死のう|消えたい|いなくなりたい|もう生きていけない|終わりにしたい|自殺|自害)/;

const EMERGENCY_REPLY =
  'いま、ひとりで抱え込みすぎているかもしれません。\n信頼できる大人や、よりそいホットライン(0120-279-338、24時間・無料)など、人と話せる窓口に一度連絡してみてください。';

const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// ── page ────────────────────────────────────────────────────────

export default function TutorPage() {
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

  // store が変わるたびに永続化（初回 render はスキップ）。
  // setState-in-effect ではなく、user 操作起点で setStore された結果を save するだけの sync effect。
  useEffect(() => {
    if (!isMounted) return;
    try {
      saveTutorChatStore(store);
    } catch {
      // ignore（safeStorage 内部でも try/catch 済）
    }
  }, [isMounted, store]);

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

    try {
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          intent,
          history: historyForApi,
          basicInfo,
          studentProfile: studentProfileCompact,
        }),
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        // ignore
      }

      const dataObj =
        typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};

      if (!res.ok) {
        const errorMessage =
          typeof dataObj.message === 'string'
            ? dataObj.message
            : 'AIの呼び出しに失敗しました。時間をおいてお試しください。';
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
          {messages.map((msg) => (
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
    </div>
  );
}
