'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  saveEssayProgress,
  saveReviewResult,
  loadReviewResult,
  formatReviewDate,
  type ReviewResult,
  type SavedReview,
} from '@/lib/essayPracticeStorage';
import type { BasicInfo } from '@/types/basicInfo';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import {
  ESSAY_REVIEW_MODEL,
  ESSAY_REVIEW_PROMPT_VERSION,
  hashEssayReviewInput,
} from '@/lib/aiInputHash';
import {
  loadEssayReviewCache,
  saveEssayReviewCache,
} from '@/lib/essayReviewCache';
import { logAiCache } from '@/lib/aiCacheLog';
import { validateEssayReviewInput } from '@/lib/validation/validateEssayReviewInput';
import {
  detectStructureWarnings,
  type StructureWarning,
} from '@/lib/validation/structureWarnings';
import { logAiValidation } from '@/lib/aiValidationLog';
import {
  loadEssayWorkspace,
  loadEssayWorkspaces,
  upsertEssayWorkspace,
} from '@/lib/essayWorkspaceStorage';
import {
  appendInitialReview,
  createInitialWorkspace,
} from '@/lib/essay/workspaceOps';
import { buildBasicInfoForAi } from '@/lib/essay/buildBasicInfoForAi';
import BasicInfoSummary from '@/components/shared/BasicInfoSummary';
import { LoadingProgress } from '@/components/ui/LoadingProgress';
// STEP-PAGE-06 / 06b で page.tsx の JSX block から切り出した pure props component。
//   - MiniThoughtFields: ステップ 2（結論 / 理由①② の input）
//   - BodyInputFields:   ステップ 3（構成ガイド / ミニ思考欄参照 / 本文 textarea / 文字数 / 進行ボタン）
import { MiniThoughtFields } from './components/MiniThoughtFields';
import { BodyInputFields } from './components/BodyInputFields';
import { Input } from '@/components/ui/Input';
// STEP-PAGE-06b: ステップ 3 本文入力の JSX block を ./components/BodyInputFields.tsx に切り出した。
// Textarea import は当該 component 内に閉じたため page 側からは除去済み。
import { FormField } from '@/components/ui/FormField';
import { ImprovementList } from '@/components/shared/result';
import {
  getEssayThemeCandidates,
  type EssayThemeCandidate,
} from '@/lib/essayThemes';

// マウント前 false / マウント後 true を返す flag。
// loadReviewResult() / loadBasicInfo() は localStorage 依存のため SSR では null を返したい。
// useSyncExternalStore の getServerSnapshot/getSnapshot で setState なしにこの semantics を表現する。
// （STEP9/10/14/15 と同形パターン）
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// ステップ構成（ステップ0：練習条件設定 → 1：テーマ確認 → 2〜5：執筆〜添削）。
// TOTAL_STEPS は「執筆フェーズ」のステップ番号上限（テーマ確認＝1, …, 添削結果＝5）。
// 練習条件設定 (=0) はテーマ生成のための前段で、執筆ステップのカウンタには含めない。
const TOTAL_STEPS = 5;
const CHAT_MAX_COUNT = 3;

// 小論文テーマは getEssayThemeCandidates(selectedEssayTarget) で動的に取得し、
// themeIndex でその中の 1 件を選ぶ（同条件で「新しいテーマで始める」と次へ巡回）。
// essayTheme / essayThemeSource / essayThemeReason / themeCandidates は
// selectedEssayTarget から派生する概念で、コード上で明確に分けて扱う。

// ステップ0で選べる入試方式の選択肢。app/input/basic/page.tsx の EXAM_TYPE_OPTIONS と揃える。
// 共有定数化は利用者が増えた時点で検討（現状 2 箇所のため inline で許容）。
const ESSAY_EXAM_TYPE_OPTIONS = [
  '総合型選抜（AO入試）',
  '学校推薦型選抜（公募・指定校）',
  '一般選抜',
  '共通テスト利用',
  '海外大学受験',
  'まだ決まっていない',
] as const;

type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
};

const CHAT_SUGGESTIONS = [
  'この理由で弱いところは？',
  '反対意見ってどんなのがある？',
  'もっと具体例ある？',
];

// LoadingProgress に渡す sub-message。6 秒ごとに rotate される。
// 中身は ai prompt とは無関係（UI 上の「待ち時間中の雰囲気」のみ）。
// STEP-UX-FIX-06b-LOADING-PROGRESS-EXTEND で追加。
const ESSAY_REVIEW_SUB_MESSAGES: readonly string[] = [
  '本文の構成を確認しています',
  '評価軸ごとに採点しています',
  '改善ポイントを整理しています',
] as const;

// 今回の小論文練習で使う志望校・入試方式（テーマ生成の入力条件）。
// basicInfo.preferences[0] / basicInfo.examTypes[0] を初期値とするが、
// ステップ0で自由に書き換え可能。basicInfo 本体は更新せず、API へ渡す basicInfo の
// preferences[0] / examTypes のみ差し替える。
// 将来は大学DB・アドミッションポリシー・過去問傾向と組み合わせて
// essayTheme を生成するための入力として使われる。
type SelectedEssayTarget = {
  university: string;
  faculty: string;
  department: string;
  examType: string; // 単一選択。空文字なら未指定（API 側で basicInfo.examTypes を上書きしない）。
};

const EMPTY_SELECTED_ESSAY_TARGET: SelectedEssayTarget = {
  university: '',
  faculty: '',
  department: '',
  examType: '',
};

export default function EssayPracticePage() {
  // ステップ番号: 0=練習条件設定 / 1=テーマ確認 / 2=ミニ思考欄 / 3=本文 / 4=壁打ち / 5=添削結果
  const [currentStep, setCurrentStep] = useState(0);
  // テーマ候補（themeCandidates）の中のどれを表示中か。
  // selectedEssayTarget が変わるたびに 0 にリセット（handleConfirmCondition / handleReset 内で実施）。
  // 「新しいテーマで始める」で +1 する。bounds は modulo で常に正規化する（後段で派生時に処理）。
  const [themeIndex, setThemeIndex] = useState(0);
  const [conclusion, setConclusion] = useState('');
  const [reasonOne, setReasonOne] = useState('');
  const [reasonTwo, setReasonTwo] = useState('');
  const [essayBody, setEssayBody] = useState('');
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [prevReviewResult, setPrevReviewResult] = useState<ReviewResult | null>(null);
  const [reviewHistory, setReviewHistory] = useState<ReviewResult[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  // STEP-UX-FIX-06b-LOADING-PROGRESS-EXTEND: 経過秒数表示の起点。reviewLoading=true の
  // タイミングで Date.now() を捕捉、finally / handleReset で null に戻す。
  // cache hit 経路では setReviewLoading(true) が立たないため、ここも触らない（display gate
  // で loadingStartedAt が null なら LoadingProgress は出ない）。
  const [reviewLoadingStartedAt, setReviewLoadingStartedAt] = useState<number | null>(null);
  const [reviewError, setReviewError] = useState('');
  // V-4: deterministic structure warnings（non-blocking hint）。submit 時に再計算して上書き。
  const [reviewStructureWarnings, setReviewStructureWarnings] = useState<StructureWarning[]>([]);
  // essay STEP B: 現セッションに対応する EssayWorkspace の id。
  // - null = まだ workspace 未作成（初回 review 時に新規作成）
  // - 値あり = 既存 workspace に再添削の review を append
  // - handleReset（新しいテーマで始める）で null に戻す
  // - 既存の reviewResult / reviewHistory / essayPracticeReview とは独立（dual-write 用）
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  // savedReview は (1) マウント時に loadReviewResult() で初期化し、
  // (2) API 添削成功時 (handleEssayReview の最後) に上書きされる。
  // post-API の上書き値だけを useState で持ち、マウント時の値は useMemo([isMounted]) で結合する
  // ことで、useEffect 内で setState する形(react-hooks/set-state-in-effect)を回避する。
  // 既存の setSavedReview 呼び出し側はそのまま動くよう setter 名は維持する。
  const [postApiSavedReview, setSavedReview] = useState<SavedReview | null>(null);

  // basicInfo は両 API（chat / review）に同梱して、AI が志望大学・学部・学科・文理・受験方式を踏まえた回答を返せるようにする。
  // localStorage を直接読まず、共通関数 loadBasicInfo() を経由する。null フォールバック対応済み。
  // マウント前は null、マウント後に loadBasicInfo() を 1度だけ呼んで以降は memo 値を返す。
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  const mountedSavedReview = useMemo<SavedReview | null>(
    () => (isMounted ? loadReviewResult() : null),
    [isMounted],
  );
  const savedReview: SavedReview | null = postApiSavedReview ?? mountedSavedReview;
  const basicInfo = useMemo<BasicInfo | null>(
    () => (isMounted ? loadBasicInfo() : null),
    [isMounted],
  );

  // essay STEP A: legacy essayPracticeReview → essayWorkspaces への migration を
  // mount 後に 1 回発火させる。戻り値は使わない（UI には反映しない）。
  //   - migration は idempotent（essayWorkspaces キーが既に存在すれば no-op）
  //   - useEffect ではなく useMemo を使うのは、本ファイルが localStorage 経由の
  //     mount-after 処理を useSyncExternalStore + useMemo パターンに統一しており、
  //     useEffect 内 setState の禁則を避ける方針（上記コメント参照）
  //   - Strict Mode の double-invocation も idempotent により安全
  // STEP B 以降で workspace を実際に読み込む際にここを書き換える。
  useMemo(() => {
    if (isMounted) loadEssayWorkspaces();
  }, [isMounted]);

  // 今回の小論文練習で使う志望校・入試方式（selectedEssayTarget）。
  // - pre-mount: 空（hydration mismatch を避ける）
  // - post-mount: basicInfo.preferences[0] / basicInfo.examTypes[0] を初期値として表示
  // - ユーザーがステップ0で編集したら userEditedSelectedTarget を上書きする（以降そちらを優先）
  // 既存の savedReview パターンと同じ「postUser ?? mounted」結合で
  // useEffect 内 setState を回避する。
  const [userEditedSelectedTarget, setUserEditedSelectedTarget] =
    useState<SelectedEssayTarget | null>(null);
  const defaultSelectedEssayTarget = useMemo<SelectedEssayTarget>(() => {
    if (!isMounted) return EMPTY_SELECTED_ESSAY_TARGET;
    const pref = basicInfo?.preferences?.[0];
    const firstExamType = basicInfo?.examTypes?.[0];
    return {
      university: pref?.university?.trim() ?? '',
      faculty: pref?.faculty?.trim() ?? '',
      department: (pref?.department ?? '').trim(),
      examType: firstExamType?.trim() ?? '',
    };
  }, [isMounted, basicInfo]);
  const selectedEssayTarget: SelectedEssayTarget =
    userEditedSelectedTarget ?? defaultSelectedEssayTarget;

  // 添削/壁打ち API に渡す basicInfo は preferences[0] / examTypes を
  // selectedEssayTarget で差し替える。localStorage の basicInfo 本体は変更しない。
  // Phase 2 STEP P で lib/essay/buildBasicInfoForAi.ts に extract（戻り値 shape 不変）。
  const basicInfoForAi = useMemo<BasicInfo | null>(
    () => buildBasicInfoForAi(basicInfo, selectedEssayTarget),
    [basicInfo, selectedEssayTarget],
  );

  // selectedEssayTarget からテーマ候補を導出する。
  // lib/essayThemes.ts は大学DB（lib/universities.ts 経由）の admission_policy を
  // 素材にして候補を作る。該当 entries / policy が無い場合は fallback 候補が返る。
  // 常に 1 件以上返る保証があるため、表示時の空配列ハンドリングは不要。
  const themeCandidates = useMemo<EssayThemeCandidate[]>(
    () => getEssayThemeCandidates(selectedEssayTarget),
    [selectedEssayTarget],
  );
  // themeIndex は modulo で常に有効範囲に収める。
  // selectedEssayTarget 変更時は handleConfirmCondition / handleReset で 0 に戻すが、
  // 候補数が変わるケースに備えて派生時にも防御する。
  const currentThemeCandidate: EssayThemeCandidate =
    themeCandidates[themeIndex % themeCandidates.length];
  const essayTheme = currentThemeCandidate.theme;
  const essayThemeSource = currentThemeCandidate.sourceType;
  const essayThemeReason = currentThemeCandidate.reason;
  // themeType は添削/深掘り/面接質問の文脈調整に使うため API へも送る。
  const essayThemeType = currentThemeCandidate.themeType;

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatRemainingCount, setChatRemainingCount] = useState(CHAT_MAX_COUNT);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');

  async function handleChatSubmit() {
    if (!chatInput.trim() || chatRemainingCount === 0 || chatLoading) return;

    const userQuestion = chatInput.trim();
    const userMessage: ChatMessage = { role: 'user', text: userQuestion };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput('');
    setChatLoading(true);
    setChatError('');

    try {
      const res = await fetch('/api/essay-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: essayTheme, themeType: essayThemeType, conclusion, reasonOne, reasonTwo, essayBody, userQuestion, basicInfo: basicInfoForAi }),
      });

      const data = await res.json();

      if (!res.ok) {
        // 構造化エラー（{ error: 'AI_REPLY_TRUNCATED', message: '...' }）の場合は
        // ユーザー向け文言である message を優先表示する。後方互換で error が文言の場合にも対応。
        setChatError(data.message ?? data.error ?? 'AIの処理に失敗しました。時間をおいてお試しください。');
        return;
      }

      const aiMessage: ChatMessage = { role: 'assistant', text: data.reply };
      setChatMessages((prev) => [...prev, aiMessage]);
      setChatRemainingCount((prev) => prev - 1);
    } catch {
      setChatError('通信エラーが発生しました。インターネット接続を確認してください。');
    } finally {
      setChatLoading(false);
    }
  }

  // ステップ0 → ステップ1（練習条件設定からテーマ確認へ）。
  // 条件確定時は themeCandidates が新しい配列に切り替わる可能性が高いため、
  // themeIndex を 0 にリセットして「先頭の候補」を表示する。
  function handleConfirmCondition() {
    setThemeIndex(0);
    setCurrentStep(1);
  }

  // ステップ1 → ステップ2（テーマ確認 → ミニ思考欄）。
  function handleStart() {
    setCurrentStep(2);
  }

  // ステップ1 → ステップ0（条件を変更する）。
  function handleEditCondition() {
    setCurrentStep(0);
  }

  function handleBack() {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  }

  // essay STEP B: 添削成功時の dual-write。
  // legacy essayPracticeReview への保存 (saveReviewResult) は既存通り走らせた上で、
  // 同じ review entry を essayWorkspaces にも追記する。
  //
  // 仕様:
  //   - 同セッション (currentWorkspaceId 一致) なら既存 workspace に append
  //   - 未作成なら createInitialWorkspace で新規構築してから append
  //   - 既存 workspace でも target/theme/mini は最新値で更新（条件再編集に追従）
  //   - body と updatedAt は appendInitialReview が更新する
  //   - workspace.id を state に記録（同セッション中の再添削で再利用）
  //
  // best-effort:
  //   try/catch で握り console.warn のみ。legacy 保存は既に成功している前提なので、
  //   この経路の失敗はユーザー UX に伝播させない。
  function persistReviewToWorkspace(reviewResult: ReviewResult) {
    try {
      const target = {
        university: selectedEssayTarget.university,
        faculty: selectedEssayTarget.faculty,
        department: selectedEssayTarget.department,
        examType: selectedEssayTarget.examType,
      };
      const theme = {
        text: essayTheme,
        type: essayThemeType,
        source: essayThemeSource,
        reason: essayThemeReason,
      };
      const mini = { conclusion, reasonOne, reasonTwo };

      const existing = currentWorkspaceId ? loadEssayWorkspace(currentWorkspaceId) : null;
      const baseWorkspace = existing
        ? { ...existing, target, theme, mini }
        : createInitialWorkspace({ target, theme, mini, body: essayBody });

      const updated = appendInitialReview(baseWorkspace, reviewResult, essayBody);
      upsertEssayWorkspace(updated);
      setCurrentWorkspaceId(updated.id);
    } catch (e) {
      // legacy essayPracticeReview への保存は既に完了している。ユーザー側には何も表示しない。
      console.warn('[essay STEP B] dual-write to essayWorkspaces failed', e);
    }
  }

  async function handleReviewEssay() {
    // deterministic validation: AI 不要な低品質入力を hash / cache / fetch 到達前に弾く。
    // fail 時は setReviewError + return のみ。daily limit / ai usage / ai cache いずれも未消費。
    setReviewStructureWarnings([]);
    const validation = validateEssayReviewInput(essayBody);
    if (!validation.ok) {
      logAiValidation({
        type: 'validation_reject',
        route: 'essay-review',
        code: validation.code,
      });
      setReviewError(validation.message);
      return;
    }
    logAiValidation({ type: 'validation_pass', route: 'essay-review' });

    // V-4: structure warnings は validator 通過後に上書き。non-blocking（AI flow に介入しない）。
    const warnings = detectStructureWarnings(essayBody);
    setReviewStructureWarnings(warnings);
    if (warnings.length > 0) {
      logAiValidation({
        type: 'structure_warning',
        route: 'essay-review',
        codes: warnings.map((w) => w.code),
      });
    }

    // STEP5.11: input hash cache を先に判定する。
    // 同入力なら AI を呼ばずに保存済み review を復元する。
    // savedReview / reviewHistory / 出力 score / loading / error は AI 入力ではないので hash に含めない。
    // 出力 hash (StudentProfile.sourceHash) とは別レーン。
    const inputHash = hashEssayReviewInput({
      theme: essayTheme,
      themeType: essayThemeType,
      conclusion,
      reasonOne,
      reasonTwo,
      essayBody,
      basicInfo: basicInfoForAi,
      model: ESSAY_REVIEW_MODEL,
      promptVersion: ESSAY_REVIEW_PROMPT_VERSION,
    });

    const cached = loadEssayReviewCache();
    if (
      cached &&
      cached.inputHash === inputHash &&
      cached.model === ESSAY_REVIEW_MODEL &&
      cached.promptVersion === ESSAY_REVIEW_PROMPT_VERSION
    ) {
      // cache hit: AI を呼ばずに即復元。loading は立てない（spinner flash を避ける）。
      // 通常成功時と同じ state 更新 / 保存処理を通す。
      logAiCache({ route: 'api/essay-review', action: 'hit', inputHash });
      setReviewError('');
      const newResult = cached.review;
      const saved: SavedReview = {
        ...newResult,
        updatedAt: new Date().toISOString(),
        essayBodySnapshot: essayBody,
      };
      const previousResult = reviewHistory.length > 0
        ? reviewHistory[reviewHistory.length - 1]
        : null;
      setPrevReviewResult(previousResult);
      setReviewHistory([...reviewHistory, newResult]);
      setReviewResult(newResult);
      saveReviewResult(newResult, essayBody);
      setSavedReview(saved);
      setCurrentStep(5);
      saveEssayProgress({ hasContent: true, hasReview: true });
      // essay STEP B: legacy 保存と同時に essayWorkspaces にも dual-write（best-effort）。
      persistReviewToWorkspace(newResult);
      return;
    }
    logAiCache({ route: 'api/essay-review', action: 'miss', inputHash });

    setReviewLoading(true);
    setReviewLoadingStartedAt(Date.now());
    setReviewError('');

    try {
      const res = await fetch('/api/essay-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: essayTheme, themeType: essayThemeType, conclusion, reasonOne, reasonTwo, essayBody, basicInfo: basicInfoForAi }),
      });

      const data = await res.json();

      if (!res.ok) {
        // 構造化エラー（{ error: 'AI_REVIEW_TRUNCATED', message: '...' }）の場合は
        // ユーザー向け文言である message を優先表示する。後方互換で error が文言の場合にも対応。
        setReviewError(data.message ?? data.error ?? 'AIの処理に失敗しました。時間をおいてお試しください。');
        return;
      }

      const newResult = data as ReviewResult;
      const saved: SavedReview = {
        ...newResult,
        updatedAt: new Date().toISOString(),
        essayBodySnapshot: essayBody,
      };

      const previousResult = reviewHistory.length > 0
        ? reviewHistory[reviewHistory.length - 1]
        : null;
      setPrevReviewResult(previousResult);
      setReviewHistory([...reviewHistory, newResult]);
      setReviewResult(newResult);
      saveReviewResult(newResult, essayBody);
      setSavedReview(saved);
      setCurrentStep(5);
      saveEssayProgress({ hasContent: true, hasReview: true });
      // STEP5.11: 成功時のみ cache 書き込み（!res.ok / catch では保存しない）。
      saveEssayReviewCache({
        inputHash,
        model: ESSAY_REVIEW_MODEL,
        promptVersion: ESSAY_REVIEW_PROMPT_VERSION,
        savedAt: new Date().toISOString(),
        review: newResult,
      });
      // essay STEP B: legacy 保存と同時に essayWorkspaces にも dual-write（best-effort）。
      persistReviewToWorkspace(newResult);
    } catch {
      setReviewError('通信エラーが発生しました。インターネット接続を確認してください。');
    } finally {
      setReviewLoading(false);
      setReviewLoadingStartedAt(null);
    }
  }

  function handleViewSavedReview() {
    if (!savedReview) return;
    setReviewResult(savedReview);
    setCurrentStep(5);
  }

  // 「新しいテーマで始める」: 志望校条件（selectedEssayTarget）は保持し、
  // 同じ条件の中で themeCandidates の次のテーマに切り替える。
  // 書きかけ本文・添削結果・チャット履歴はクリアして、テーマ確認（ステップ1）に戻す。
  // 志望校条件を変えたい場合は「条件を変更する」(handleEditCondition) を使う。
  function handleReset() {
    setThemeIndex((prev) => prev + 1); // 派生側で modulo するので bounds 計算は不要。
    setCurrentStep(1);
    setReviewResult(null);
    setPrevReviewResult(null);
    setReviewHistory([]);
    setReviewLoading(false);
    // STEP-UX-FIX-06b-LOADING-PROGRESS-EXTEND: orphan startedAt 防止。
    // 通常 finally で null に戻るが、進行中に handleReset を踏まれても残らないよう
    // ここでも明示的に null へ戻す。
    setReviewLoadingStartedAt(null);
    setReviewError('');
    setReviewStructureWarnings([]);
    setConclusion('');
    setReasonOne('');
    setReasonTwo('');
    setEssayBody('');
    setChatMessages([]);
    setChatInput('');
    setChatRemainingCount(CHAT_MAX_COUNT);
    setChatLoading(false);
    setChatError('');
    // essay STEP B: 新しいテーマで始める = 新セッション。
    // 次回の persistReviewToWorkspace で新 workspace が作られるよう id を解除する。
    // 既存 workspace の localStorage 上のデータは保持される（LRU 退役を待つ）。
    setCurrentWorkspaceId(null);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      {/* essay STEP I: hub への戻り link。/essay/results / 改善フローへの導線を確保。
          ステップ進行中も常時表示で、ユーザーが小論文系の他経路（過去結果閲覧・改善）に
          いつでも抜けられる状態にしておく。 */}
      <div className="mb-6">
        <Link
          href="/essay"
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← 小論文トップへ
        </Link>
      </div>

      {/* Phase 2 STEP P: 新 architecture（/essay/structure / /essay/write）への
          deprecation banner。/essay-practice 自体は削除しないが、新フロー誘導を出す。
          rollback safety のため legacy ページは引き続き利用可能。 */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-blue-700 mb-1">
          新しい小論文機能が利用できます
        </p>
        <p className="text-xs text-gray-600 mb-3 leading-relaxed">
          整理して書く・いきなり書くの 2 つのフローに分かれた新 architecture を試せます。
          このページも引き続きご利用いただけます。
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/essay/structure"
            className="inline-flex items-center justify-center font-medium rounded-xl text-xs px-3 py-1.5 bg-brand-600 text-white hover:bg-brand-700 transition-colors"
          >
            整理して書く →
          </Link>
          <Link
            href="/essay/write"
            className="inline-flex items-center justify-center font-medium rounded-xl text-xs px-3 py-1.5 border border-brand-200 text-brand-700 bg-white hover:bg-brand-50 transition-colors"
          >
            いきなり書く →
          </Link>
        </div>
      </div>

      {/* ── ページタイトル・説明 ── */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-3">小論文練習AI</h1>
        <p className="text-gray-600 text-sm leading-relaxed">
          テーマに沿って小論文を書き、AIからフィードバックを受けながら論述力を高めます。
        </p>
        <p className="text-gray-500 text-xs mt-1">
          ※AIが代わりに書くのではなく、自分の力で書けるようにサポートします。
        </p>
      </div>

      <BasicInfoSummary basicInfo={basicInfo} />

      {/* ── ステップ表示 ──
          ステップ0（練習条件設定）は執筆フェーズ前の準備ステップとして
          カウンタには含めず、専用ラベルを表示する。 */}
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {currentStep > 1 && (
            <button
              type="button"
              onClick={handleBack}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded px-3 py-1.5 transition-colors"
            >
              ← 戻る
            </button>
          )}
          <p className="text-sm text-gray-500">
            {currentStep === 0 ? (
              <span className="font-semibold text-gray-700">練習条件設定</span>
            ) : (
              <>
                ステップ <span className="font-semibold text-gray-700">{currentStep}</span> / {TOTAL_STEPS}
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 hover:border-gray-300 rounded px-3 py-1.5 transition-colors"
        >
          新しいテーマで始める
        </button>
      </div>

      {/* ── ステップ0：練習条件設定 ──
          将来は selectedEssayTarget（大学・学部・学科・入試方式）と
          大学DB・アドミッションポリシー・過去問傾向をもとに essayTheme を生成する。
          現状はテキスト入力で selectedEssayTarget を選び、確定後に固定テーマを表示する。 */}
      {currentStep === 0 && (
        <section className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
          <h2 className="text-base font-semibold text-gray-700 mb-2">練習条件設定</h2>
          <p className="text-sm text-gray-500 mb-5">
            今回の小論文練習で使う志望校・入試方式を選んでください。基本情報の第一志望をもとに初期表示しており、必要に応じて変更できます（基本情報の値は上書きされません）。
          </p>

          <div className="space-y-3 mb-6">
            <FormField label="大学名">
              <Input
                type="text"
                value={selectedEssayTarget.university}
                onChange={(e) =>
                  setUserEditedSelectedTarget({ ...selectedEssayTarget, university: e.target.value })
                }
                placeholder="例：〇〇大学"
              />
            </FormField>
            <FormField label="学部名">
              <Input
                type="text"
                value={selectedEssayTarget.faculty}
                onChange={(e) =>
                  setUserEditedSelectedTarget({ ...selectedEssayTarget, faculty: e.target.value })
                }
                placeholder="例：〇〇学部"
              />
            </FormField>
            <FormField label="学科名（任意）">
              <Input
                type="text"
                value={selectedEssayTarget.department}
                onChange={(e) =>
                  setUserEditedSelectedTarget({ ...selectedEssayTarget, department: e.target.value })
                }
                placeholder="例：〇〇学科"
              />
            </FormField>
            <FormField
              label="入試方式（任意）"
              hint="基本情報で選んだ受験予定方式の先頭を初期値にしています。"
            >
              <select
                value={selectedEssayTarget.examType}
                onChange={(e) =>
                  setUserEditedSelectedTarget({ ...selectedEssayTarget, examType: e.target.value })
                }
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">未選択</option>
                {ESSAY_EXAM_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </FormField>
          </div>

          <button
            type="button"
            onClick={handleConfirmCondition}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
          >
            この条件でテーマを確認する
          </button>
        </section>
      )}

      {/* ── ステップ1：テーマ確認 ──
          selectedEssayTarget の確認と essayTheme の表示。両者は別 state として保持し、
          将来 essayTheme は selectedEssayTarget をもとに生成される想定。 */}
      {currentStep === 1 && (
        <section className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
          <h2 className="text-base font-semibold text-gray-700 mb-5">ステップ1：テーマ確認</h2>

          <div className="mb-6 bg-blue-50/50 border border-blue-100 rounded-lg p-4">
            <p className="text-sm font-semibold text-gray-700 mb-2">今回の練習で使う志望校</p>
            <div className="space-y-1 text-sm text-gray-800">
              <p><span className="text-gray-400 mr-1">大学</span>{selectedEssayTarget.university || '未入力'}</p>
              <p><span className="text-gray-400 mr-1">学部</span>{selectedEssayTarget.faculty || '未入力'}</p>
              <p><span className="text-gray-400 mr-1">学科</span>{selectedEssayTarget.department || '未入力'}</p>
              <p><span className="text-gray-400 mr-1">入試方式</span>{selectedEssayTarget.examType || '未選択'}</p>
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-gray-700">小論文テーマ</p>
              <span className="text-xs text-gray-400">この練習で使用</span>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-800 leading-relaxed">
              {essayTheme}
            </div>
            {/* themeType を小さく badge 風表示。値はそのまま英 snake_case を出す
                （添削/深掘り/面接質問との連携キーとして表示）。 */}
            <div className="mt-2">
              <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                {essayThemeType}
              </span>
            </div>
            {/* テーマの根拠（大学DB の admission_policy か汎用 fallback か）。
                essayThemeSource により表示色だけ分け、reason は essayThemes.ts が生成済み。 */}
            <p
              className={
                essayThemeSource === 'admission_policy'
                  ? 'text-xs text-blue-600 mt-2'
                  : 'text-xs text-amber-600 mt-2'
              }
            >
              {essayThemeReason}
            </p>
            {themeCandidates.length > 1 && (
              <p className="text-xs text-gray-400 mt-1">
                ※「新しいテーマで始める」で同じ条件のまま別テーマに切り替えられます（候補 {themeCandidates.length} 件）。
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleStart}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              このテーマで始める
            </button>
            <button
              type="button"
              onClick={handleEditCondition}
              className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-600 font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              条件を変更する
            </button>
          </div>
        </section>
      )}

      {/* ── ステップ2以降：テーマ確定表示（編集不可） ── */}
      {currentStep >= 2 && (
        <section className="mb-8">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-blue-600">テーマ</p>
              <span className="text-xs text-blue-400">確定済み・変更不可</span>
            </div>
            <p className="text-sm text-gray-800 leading-relaxed">{essayTheme}</p>
          </div>
        </section>
      )}

      {/* ── ステップ2：ミニ思考欄（JSX 本体は ./components/MiniThoughtFields.tsx に切り出し済み、STEP-PAGE-06）── */}
      {currentStep === 2 && (
        <MiniThoughtFields
          conclusion={conclusion}
          setConclusion={setConclusion}
          reasonOne={reasonOne}
          setReasonOne={setReasonOne}
          reasonTwo={reasonTwo}
          setReasonTwo={setReasonTwo}
          onProceed={() => setCurrentStep(3)}
        />
      )}

      {/* ── ステップ3：本文入力（JSX 本体は ./components/BodyInputFields.tsx に切り出し済み、STEP-PAGE-06b）── */}
      {currentStep === 3 && (
        <BodyInputFields
          essayBody={essayBody}
          setEssayBody={setEssayBody}
          conclusion={conclusion}
          reasonOne={reasonOne}
          reasonTwo={reasonTwo}
          onProceed={() => {
            setCurrentStep(4);
            if (essayBody.trim()) saveEssayProgress({ hasContent: true, hasReview: false });
          }}
        />
      )}

      {/* ── ステップ4：壁打ちAI相談 ── */}
      {currentStep === 4 && (
        <section className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
          <h2 className="text-base font-semibold text-gray-700 mb-2">壁打ちAI相談</h2>
          <p className="text-sm text-gray-500 mb-2">
            AIは答えを作るのではなく、あなたの思考を深めるサポートをします。
          </p>

          {/* 残り回数 */}
          <p className="text-sm mb-6">
            残り
            <span className={`font-bold mx-1 ${chatRemainingCount === 0 ? 'text-red-500' : 'text-blue-600'}`}>
              {chatRemainingCount}
            </span>
            回
          </p>

          {/* メッセージ一覧 */}
          {chatMessages.length > 0 && (
            <div className="space-y-3 mb-5">
              {chatMessages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs sm:max-w-md px-4 py-2.5 rounded-xl text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 相談例ボタン */}
          <div className="flex flex-wrap gap-2 mb-4">
            {CHAT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setChatInput(suggestion)}
                className="text-xs border border-gray-300 hover:border-blue-400 hover:text-blue-600 text-gray-500 rounded-full px-3 py-1 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>

          {/* ローディング */}
          {chatLoading && (
            <p className="text-sm text-gray-400 mb-4">AIが考えています...</p>
          )}

          {/* エラー */}
          {chatError && (
            <p className="text-sm text-red-500 mb-4">{chatError}</p>
          )}

          {/* 入力欄 */}
          <div className="flex gap-2 mb-8">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleChatSubmit(); }}
              placeholder="AIに相談したいことを入力してください"
              disabled={chatRemainingCount === 0 || chatLoading}
              className="flex-1 border border-slate-300 rounded-lg px-4 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleChatSubmit}
              disabled={!chatInput.trim() || chatRemainingCount === 0 || chatLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors"
            >
              {chatLoading ? '送信中...' : '相談する'}
            </button>
          </div>

          {reviewError && (
            <p className="text-sm text-red-500 mb-4">{reviewError}</p>
          )}
          {reviewStructureWarnings.length > 0 && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">
                構造のチェック（参考・AI添削は通常通り進みます）
              </p>
              <ul className="text-sm text-amber-900 leading-relaxed space-y-1">
                {reviewStructureWarnings.map((w) => (
                  <li key={w.code}>・{w.message}</li>
                ))}
              </ul>
            </div>
          )}
          {/* STEP-UX-FIX-06b-LOADING-PROGRESS-EXTEND: AI 添削中の経過秒 + sub-message ループ。
              reviewLoading=true かつ startedAt がある間だけ表示。reviewLoading false に戻る
              と unmount されて setInterval も cleanup される。
              cache hit 経路では setReviewLoading(true) を立てずに早期 return するため
              ここは出ない。 */}
          {reviewLoading && reviewLoadingStartedAt !== null && (
            <div className="mb-4">
              <LoadingProgress
                startedAt={reviewLoadingStartedAt}
                label="AIが添削しています"
                subMessages={ESSAY_REVIEW_SUB_MESSAGES}
                estimatedSeconds={20}
              />
            </div>
          )}
          {savedReview?.essayBodySnapshot !== undefined && essayBody !== savedReview.essayBodySnapshot && (
            <p className="text-xs text-amber-600 mb-3">
              本文が変更されています。前回の添削結果は古い可能性があります。
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleReviewEssay}
              disabled={reviewLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              {reviewLoading ? 'AIが添削中...' : 'AI添削する'}
            </button>
            {savedReview && (
              <button
                type="button"
                onClick={handleViewSavedReview}
                disabled={reviewLoading}
                className="bg-white hover:bg-gray-50 disabled:opacity-50 border border-blue-300 text-blue-600 font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
              >
                前回の添削結果を見る（{formatReviewDate(savedReview.updatedAt)}）
              </button>
            )}
            <button
              type="button"
              onClick={() => { setCurrentStep(3); setReviewError(''); }}
              disabled={reviewLoading}
              className="bg-white hover:bg-gray-50 disabled:opacity-50 border border-gray-300 text-gray-600 font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              本文に戻る
            </button>
          </div>
        </section>
      )}

      {/* ── ステップ5：AI添削結果 ── */}
      {currentStep === 5 && reviewResult && (
        <section className="mb-8">
          <h2 className="text-xl font-bold text-gray-800 mb-6">AI添削結果</h2>

          {/* 総合評価 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-4 mb-2">
              <span className="text-4xl font-bold text-blue-700">{reviewResult.totalScore}</span>
              <div>
                <p className="text-sm font-semibold text-blue-800">総合評価</p>
                <p className="text-xs text-blue-600">/ 100点</p>
              </div>
              <span className="ml-auto text-sm font-semibold text-blue-700 bg-blue-100 px-3 py-1 rounded-full">
                {reviewResult.verdict}
              </span>
            </div>
          </div>

          {/* 前回との比較（2回目以降の添削時のみ表示） */}
          {prevReviewResult && (() => {
            const scoreDiff = reviewResult.totalScore - prevReviewResult.totalScore;
            const diffLabel = scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff < 0 ? `${scoreDiff}` : '±0';
            const cardColor = scoreDiff > 0 ? 'bg-green-50 border-green-200' : scoreDiff < 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200';
            const titleColor = scoreDiff > 0 ? 'text-green-800' : scoreDiff < 0 ? 'text-red-800' : 'text-gray-700';
            const title = scoreDiff > 0 ? '成長しました' : scoreDiff < 0 ? '見直しが必要です' : '同じ水準です';

            // breakdown の差分リストを作る（label が一致する項目同士で比較）
            // currScore / prevScore も持たせて、後の表示ループで再検索しないようにする
            const breakdownDiffs = reviewResult.breakdown.map((curr) => {
              const prev = prevReviewResult.breakdown.find((b) => b.label === curr.label);
              return {
                label: curr.label,
                currScore: curr.score,
                prevScore: prev?.score ?? curr.score,
                diff: prev ? curr.score - prev.score : 0,
              };
            });

            // スコアが上がった中で最大の項目 / 下がった中で最小の項目を取得
            const mostImproved = breakdownDiffs.reduce((a, b) => (b.diff > a.diff ? b : a));
            const mostDropped = breakdownDiffs.reduce((a, b) => (b.diff < a.diff ? b : a));

            const message =
              scoreDiff > 0
                ? `特に「${mostImproved.label}」が +${mostImproved.diff} 点改善されています。`
                : scoreDiff < 0
                ? `特に「${mostDropped.label}」が ${mostDropped.diff} 点下がっています。本文の該当部分を見直しましょう。`
                : '大きな点数変化はありません。改善提案をもとに、次は具体例や反対意見への対応を強化しましょう。';

            return (
              <div className={`border rounded-xl p-5 mb-6 ${cardColor}`}>
                <h3 className={`text-sm font-bold mb-3 ${titleColor}`}>{title}</h3>

                {/* totalScore 比較 */}
                <p className="text-sm text-gray-700 mb-3">
                  前回：<span className="font-semibold">{prevReviewResult.totalScore}点</span>
                  　→　今回：<span className="font-semibold">{reviewResult.totalScore}点</span>
                  　<span className={`font-bold ${scoreDiff > 0 ? 'text-green-600' : scoreDiff < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                    （{diffLabel}）
                  </span>
                </p>

                {/* breakdown 比較（breakdownDiffs を再利用して重複検索を避ける） */}
                <div className="space-y-1">
                  {breakdownDiffs.map(({ label, prevScore, currScore, diff }) => {
                    const diffStr = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '±0';
                    const diffColor = diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-500' : 'text-gray-400';
                    return (
                      <p key={label} className="text-xs text-gray-600">
                        {label}：{prevScore} → {currScore}
                        <span className={`ml-1 font-semibold ${diffColor}`}>（{diffStr}）</span>
                      </p>
                    );
                  })}
                </div>

                <p className="text-xs text-gray-500 mt-3">{message}</p>
              </div>
            );
          })()}

          {/* 改善提案（結論ファースト UX：最優先で目に入る位置に置く） */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold text-yellow-800 mb-2">まず直すこと</h3>
            <p className="text-sm text-yellow-900 leading-relaxed">{reviewResult.improvement}</p>
          </div>

          {/* まだ弱い点（次に優先すべき箇所をまとめて見せる） */}
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold text-red-800 mb-2">まだ弱い点</h3>
            <ul className="space-y-1">
              {reviewResult.weakPoints.map((w, i) => (
                <li key={i} className="text-sm text-red-700 flex gap-2">
                  <span>△</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 良かった点
              ラッパー（bg-green-50 + h3）は raw 維持。リストだけ ImprovementList に置換。
              variant="success" は ✓ + text-green-700 で元の見た目とほぼ一致する
              （prefix span に shrink-0 が付く点だけ差分。長文折り返し時の整列が改善）。 */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold text-green-800 mb-2">良かった点</h3>
            <ImprovementList items={reviewResult.goodPoints} variant="success" />
          </div>

          {/* 内訳（参照情報。最後に置く） */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">内訳</h3>
            <div className="space-y-4">
              {reviewResult.breakdown.length === 0 ? (
                <p className="text-sm text-gray-400">内訳データを取得できませんでした。再度添削をお試しください。</p>
              ) : (
                reviewResult.breakdown.map((item) => {
                  const percentage = (item.score / 20) * 100;
                  const barColor =
                    percentage >= 80 ? 'bg-green-500' : percentage >= 60 ? 'bg-yellow-400' : 'bg-red-400';
                  return (
                    <div key={item.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-gray-700">{item.label}</span>
                        <span className="text-sm font-semibold text-gray-700">{item.score} / 20</span>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 添削履歴（2回以上添削した場合のみ表示） */}
          {reviewHistory.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">添削履歴</h3>
              <div className="space-y-1">
                {reviewHistory.map((item, index) => (
                  <p key={index} className="text-sm text-gray-600">
                    {index + 1}回目：
                    <span className="font-semibold text-gray-800">{item.totalScore}点</span>
                    　{item.verdict}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* アクションボタン */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setCurrentStep(3)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              改善して再提出する
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-600 font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              最初からやり直す
            </button>
          </div>
        </section>
      )}

    </div>
  );
}
