'use client';

// PASSAI 受験チューターAI のチャットページ（実装 STEP8）。
//
// 役割:
//   - 受験生からのメッセージを受け取り /api/tutor に POST する最小の chat UI
//   - 危険語の client-side 1 次 block（外部窓口誘導）
//   - daily limit（tutorLimit）の連携：UI 表示 + 成功時のみ消費
//   - intent / stabilization 判定（rule-based、AI を呼ばない）
//   - 直近 6 件の messages を history として server に送る（STEP-TUTOR-CONTEXT-01）
//     → server 側で sanitize + Anthropic messages 配列に multi-turn 形式で投入される
//
// STEP-TUTOR-CONTEXT-03 追加: lastTutorIntent state を保持し、次回 detectTutorIntent
//   呼び出しに previousIntent として渡すことで「面接が不安 → 答えが出ない → どっちも」型の
//   省略返答 turn でも topic（interview）を継承する。継承ロジック本体は
//   lib/tutor/detectTutorIntent.ts:detectTutorIntent + lib/tutor/tutorPrompt.ts [U-多ターン継承]
//   側で確定済み（STEP-TUTOR-CONTEXT-02）。本ファイルは wiring のみ担う。
//   - 更新タイミングは「API 成功時のみ」。emergency block / daily limit / network error /
//     AI_REQUEST_FAILED / AI_REPLY_TRUNCATED では更新しない（topic を進めない原則）。
//   - 保存する値は detectTutorStabilization で上書きされる前の baseIntent。
//     理由: stabilize/general 上書きで継承チェーンが切れるのを防ぐため。
//
// 含めない:
//   - context 詳細送信（basicInfo / StudentProfile / statementDraft 等）は v1 では null 固定。
//     STEP9 以降で localStorage 経由の取得を段階導入する。
//   - 機能接続ボタン化（parseTutorReply / TutorSuggestionLink は STEP9）
//   - 会話履歴の永続化（refresh で初期化される、これは v1 仕様）
//   - history pass-through（STEP-TUTOR-CONTEXT-01 想定だが未配線。本 STEP の責務外）
//   - ConversationState / Thread UI / Supabase（明示的に範囲外）
//
// 関連:
//   - app/api/tutor/route.ts (STEP5)
//   - lib/tutor/detectTutorIntent.ts (STEP6)
//   - lib/tutor/detectTutorStabilization.ts (STEP6)
//   - lib/dailyLimit.ts:tutorLimit (STEP7)

import { useMemo, useState, useSyncExternalStore } from 'react';
import { tutorLimit, type DailyUsage } from '@/lib/dailyLimit';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { getStudentProfileForFeature } from '@/lib/getStudentProfileForFeature';
import { detectTutorIntent } from '@/lib/tutor/detectTutorIntent';
import { detectTutorStabilization } from '@/lib/tutor/detectTutorStabilization';
import type { BasicInfo } from '@/types/basicInfo';
import type { TutorIntent } from '@/lib/tutor/types';
import { TutorBubble } from './components/TutorBubble';
import { TutorInput } from './components/TutorInput';
import { TutorRemainingCount } from './components/TutorRemainingCount';

// ── 型 ──────────────────────────────────────────────────────────

type TutorMessage = {
  role: 'user' | 'assistant';
  text: string;
};

// ── 定数 ────────────────────────────────────────────────────────

// tutorLimit の limit 値を closure から取り出す（count=0 の getRemainingCount は limit 値そのもの）。
// dailyLimit.ts に直値が露出していないため、ここで安全に派生させる。
const TUTOR_DAILY_LIMIT = tutorLimit.getRemainingCount({ date: '', count: 0 });

// 危険語 client-side 1 次 block 用パターン。route 側の EMERGENCY_PATTERN と同じ。
// 三層防御（client UI / server route / SYSTEM PROMPT）の 1 層目を担う。
const EMERGENCY_PATTERN =
  /(死にたい|死のう|消えたい|いなくなりたい|もう生きていけない|終わりにしたい|自殺|自害)/;

const EMERGENCY_REPLY =
  'いま、ひとりで抱え込みすぎているかもしれません。\n信頼できる大人や、よりそいホットライン(0120-279-338、24時間・無料)など、人と話せる窓口に一度連絡してみてください。';

// SSR セーフな mount フラグ。localStorage 直前で isMounted=true となる。
// PASSAI 既存パターン（essay-practice 等）と同形。
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

  // 初期メッセージは出さない（ChatGPT 的余白型 UI）。
  // 灰色の「相談フォーム感」を作っていた assistant bubble を除去し、
  // ユーザーが自分の意思で書き始められる空気を優先する。
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // STEP-TUTOR-CONTEXT-03 追加: 直前 turn で確定した「キーワード判定上の」intent。
  // detectTutorIntent に previousIntent として渡し、省略返答 turn で topic を継承する。
  //   - 初期値 undefined（first turn は従来通り継承スキップ）
  //   - API 成功時のみ baseIntent で上書きする（stabilization 上書き前の値を保存）
  //   - emergency / daily limit / fetch エラー / AI 失敗時は更新しない
  //   - localStorage 永続化しない（refresh で undefined に戻る、本 STEP は wiring のみ）
  const [lastTutorIntent, setLastTutorIntent] = useState<TutorIntent | undefined>(
    undefined,
  );

  // daily usage は (1) マウント時に loadUsage() で初期化し、(2) API 成功時に
  // incrementUsage() で上書きされる。post-API の上書き値だけを useState で持ち、
  // マウント時の値は useMemo([isMounted]) で結合することで、useEffect 内で setState
  // する形（react-hooks/set-state-in-effect）を回避する。PASSAI 既存パターン
  // （essay-practice の savedReview）と同形。
  const [postApiUsage, setPostApiUsage] = useState<DailyUsage | null>(null);
  const usage = useMemo<DailyUsage>(() => {
    if (postApiUsage !== null) return postApiUsage;
    if (!isMounted) return { date: '', count: 0 };
    return tutorLimit.loadUsage();
  }, [isMounted, postApiUsage]);

  const remaining = tutorLimit.getRemainingCount(usage);
  const canUse = tutorLimit.canUse(usage);

  // basicInfo は read-only で API body にそのまま渡す（v1.1 STEP12 で連携開始）。
  //   - SSR 中は localStorage 不可なので isMounted=false の間は null
  //   - loadBasicInfo() 例外時も null フォールバック（落ちない）
  //   - mutation しない（書き戻し / 上書きなし）
  //   - subjectGrades / overallGpa / name 等の sensitive field は API 側
  //     buildTutorBasicInfoSection が抽出時に意図的に除外する設計（STEP3）
  //   - SYSTEM PROMPT [K] が評定値の直引用を禁止しているので二重防御
  const basicInfo = useMemo<BasicInfo | null>(() => {
    if (!isMounted) return null;
    try {
      return loadBasicInfo();
    } catch {
      return null;
    }
  }, [isMounted]);

  // studentProfile compact object（v1.1 STEP13 で summary、STEP14 で strengths/weaknesses、
  // STEP15 で futureConnections、STEP16 で valueKeywords を段階追加連携）。
  //   - canonical な StudentProfile は `getStudentProfileForFeature()` 経由で取得
  //   - 送信は summary + strengths(上位 3) + weaknesses(上位 2) + futureConnections(上位 2)
  //     + valueKeywords(上位 3) の compact object
  //     （signatureEpisodes / applicantType / generatedAt / sourceHash / version は送らない）
  //   - valueKeywords は builder 側 MAX_VALUE_KEYWORDS=3 と client slice(0, 3) が一致
  //     （列挙化リスク抑制のため client/builder で二重に上限を設ける）
  //   - applicantType label の出力漏洩リスクをクライアント側で構造的に切り落とす（defense in depth）
  //   - 各 field は配列でない場合 [] フォールバック（型違反 localStorage への防御）
  //   - summary が空文字 / 空白のみ / null なら全体 null を返す（context section ヘッダが出ない）
  //   - SSR 中 / 例外時は null フォールバック
  //   - mutation しない（書き戻し / 上書きなし）
  //
  // ★ tutor は「あなたの強みは○○です」「あなたは○○学部向きです」型の判定 AI ではない。
  //   strengths / weaknesses / futureConnections は AI が「整理の素材」として参照する情報であり、
  //   出力での literal 引用 / 進路決めつけは SYSTEM PROMPT [H] で禁止されている。
  //   client 側で slice により上限を設けることで、AI が複数列挙の誘惑に引っ張られにくくする
  //   ([H]「複数並べない」原則と整合)。
  //
  //   futureConnections は SYSTEM PROMPT 経由で route 側 buildTutorStudentProfileContext で
  //   **intent='general' or 'statement' 時のみ 1 件** が context に乗る設計（STEP3）。
  //   self_analysis / interview / selfpr / stabilize 時は context に乗らない（責務外）。
  const studentProfileCompact = useMemo<
    {
      summary: string;
      strengths: string[];
      weaknesses: string[];
      futureConnections: string[];
      valueKeywords: string[];
      // STEP17: signatureEpisodes は title のみ送る compact 形（summary 除外）。
      // 監視感が最も高い field のため client 側で構造的に summary を切り落とす。
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
        // STEP15 追加: futureConnections 上位 2 件まで。builder は intent によって 1 件のみ出力
        futureConnections: Array.isArray(profile.futureConnections)
          ? profile.futureConnections.slice(0, 2)
          : [],
        // STEP16 追加: valueKeywords 上位 3 件まで（builder MAX_VALUE_KEYWORDS=3 と一致）。
        // builder は inline 形式「価値観キーワード: A / B / C」で 3 件を全 intent で出力する設計。
        valueKeywords: Array.isArray(profile.valueKeywords)
          ? profile.valueKeywords.slice(0, 3)
          : [],
        // STEP17 追加: signatureEpisodes は 1 件のみ、**title だけ** を送る。
        // summary（detail 本文）/ relatedStrengthIdx は構造的に除外。
        // builder MAX_SIGNATURE_EPISODES=1 と一致。
        // 「以前」「前回」「あなたは〜していた」型の監視感を防ぐため、最小情報のみ送る設計。
        // canonical SignatureEpisode の `title: string` を信頼しつつ、空 title は弾く。
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

  async function handleSubmit() {
    const message = input.trim();
    if (message === '' || loading) return;

    // emergency client-side block: API を呼ばず、tutorLimit も消費しない
    if (EMERGENCY_PATTERN.test(message)) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', text: message },
        { role: 'assistant', text: EMERGENCY_REPLY },
      ]);
      setInput('');
      setError('');
      return;
    }

    // daily limit check
    if (!canUse) {
      setError('今日の相談回数の上限に達しました。明日また来てください。');
      return;
    }

    // intent 判定（rule-based、AI 呼ばない）。stabilization 検出時は強制 stabilize に上書き。
    // STEP-TUTOR-CONTEXT-03: previousIntent=lastTutorIntent を渡して省略返答 turn の
    // topic 継承を有効化する（STEP-TUTOR-CONTEXT-02 で detectTutorIntent 側に追加済み）。
    const baseIntent = detectTutorIntent({ message, previousIntent: lastTutorIntent });
    const intent: TutorIntent = detectTutorStabilization(message)
      ? 'stabilize'
      : baseIntent;

    // user message を即時追加（送信中も画面に残る）
    setMessages((prev) => [...prev, { role: 'user', text: message }]);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 今回 turn の user 発話。server 側で context + system prompt と一緒に
          // Anthropic 最後の user メッセージとして組み立てられる。
          message,
          intent,
          // STEP-TUTOR-CONTEXT-01: 直近 6 件の messages を history として送る。
          //   - 形式: { role: 'user' | 'assistant', text: string }[]
          //   - 今回送信中の user message は state に未追加の段階で slice するため
          //     自然に含まれない（setMessages の append は fetch 後、L235 は閉包変数）。
          //   - server 側 sanitizeTutorHistory が role/text/長さ/交互制約をかける。
          //     不正値を送っても 400 にはならず、安全側で [] に倒される。
          //   - localStorage 永続化はしない。refresh で history=[] に戻る v1 仕様のまま。
          history: messages.slice(-6).map((m) => ({
            role: m.role,
            text: m.text,
          })),
          // basicInfo: v1.1 STEP12 で連携開始。null fallback あり。
          // route 側 buildTutorBasicInfoSection が学年・文理・第一志望・受験方式の先頭のみ
          // 抽出し、subjectGrades / overallGpa / name は含めない。
          basicInfo,
          // studentProfile: v1.1 STEP13 で summary 連携開始、STEP14 で strengths(3) +
          // weaknesses(2) 追加。送信内容は compact object に限定。futureConnections /
          // valueKeywords / signatureEpisodes / applicantType / generatedAt / sourceHash /
          // version はクライアント側で送信前に削ぎ落とす（defense in depth）。
          studentProfile: studentProfileCompact,
        }),
      });

      // response.json() が失敗するケース（5xx でボディが空 等）にも備える
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        // ignore — エラー表示で fallback
      }

      const dataObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};

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

      setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);

      // 成功時のみ daily limit 消費（失敗時・emergency 時は消費しない）
      const next = tutorLimit.incrementUsage(usage);
      setPostApiUsage(next);

      // STEP-TUTOR-CONTEXT-03: 成功時のみ previousIntent を進める。
      // 保存値は detectTutorStabilization で 'stabilize' に上書きされる前の baseIntent
      // （stabilize は state であり topic ではないため、上書き値を保存すると次 turn の
      // 「どっちも」型省略返答で interview 等の topic 継承が切れる）。
      // baseIntent が 'general'/'stabilize'/'advice' のときも保存はするが、
      // INHERITABLE_PREVIOUS_INTENTS に含まれないため次 turn での継承は発生しない
      // （実質的に「継承用の topic latch をクリアする」動作になる）。
      setLastTutorIntent(baseIntent);
    } catch {
      setError('通信エラーが発生しました。インターネット接続を確認してください。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-gray-800 mb-2">受験チューターAI</h1>
        <p className="text-sm text-gray-600 leading-relaxed">
          気になってることを、そのまま書いて大丈夫です。
        </p>
      </header>

      {/* マウント前は SSR で 0 残として描画されてしまうため、マウント後にだけ表示する */}
      {isMounted && (
        <div className="mb-4">
          <TutorRemainingCount remaining={remaining} limit={TUTOR_DAILY_LIMIT} />
        </div>
      )}

      <div className="space-y-3 mb-4 min-h-[200px]">
        {messages.map((msg, index) => (
          <TutorBubble key={index} role={msg.role} text={msg.text} />
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
  );
}
