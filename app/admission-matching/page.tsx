'use client';

import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { AiMatchAdvice, EligibilityResult } from '@/types/matching';
import type { AdmissionMatchingInput } from '@/types/admissionMatchingInput';
import { buildMatchingResults } from '@/lib/matching/suggestUniversities';
import { toBasicInfo } from '@/lib/matching/toBasicInfo';
import {
  findUniversityEntriesByUserChoices,
  getAllUniversities,
} from '@/lib/universities';
import { checkEligibility } from '@/lib/matching/checkEligibility';
import { devLog, devWarn } from '@/lib/devLog';
import {
  collectAndSaveMatchingInput,
  loadFreshMatchingInputSnapshot,
  getMissingItems,
  markMatchingCompleted,
  loadAiMatchAdviceCache,
  loadAiMatchAdviceTimestamp,
  saveAiMatchAdviceCache,
  type AiMatchAdviceCache,
} from '@/lib/admissionMatchingStorage';
import { loadSelfPRs } from '@/lib/selfPRStorage';
import { deriveStudentAnalysis } from '@/lib/matching/deriveStudentAnalysis';
import { buildUniversityContextsFromBasicInfo } from '@/lib/matching/buildUniversityContextsFromBasicInfo';
import { getStudentProfileForFeature } from '@/lib/getStudentProfileForFeature';
import type { MatchingInput } from '@/types/matchingInput';
import { LoadingProgress } from '@/components/ui/LoadingProgress';
// STEP6.12: feature-local components は barrel export 経由でまとめて import。
import { ConfirmView, ResultView } from './components';

// STEP6.13: toBasicInfo 変換ヘルパーは @/lib/matching/toBasicInfo へ移動済み。
//   pure domain helper のため orchestration layer (page.tsx) から除去した。

// STEP-PAGE-FIX-01: SSR-stable mount flag。loadFreshMatchingInputSnapshot() は localStorage
// 依存のため SSR では null を返したい。useSyncExternalStore の getServerSnapshot/getSnapshot で
// setState なしにこの semantics を表現する（他 page と同形パターン）。これにより mount useEffect 内の
// setMatchingInput / setLoading が不要になり、`react-hooks/set-state-in-effect` 違反を解消する。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// LoadingProgress に渡す sub-message。6 秒ごとに rotate される。
// STEP-UX-FIX-06-LOADING-PROGRESS で導入。
const MATCHING_SUB_MESSAGES: readonly string[] = [
  'あなたの活動・自己分析を整理しています',
  '志望校との一致度を計算しています',
  '志望校別のアドバイスをまとめています',
] as const;

// ── ページ本体 ───────────────────────────────────────────────────

export default function AdmissionMatchingPage() {
  const [hasRunMatching, setHasRunMatching] = useState(false);
  // STEP6.3: matchingLevel / aiAdvices を live 専用へ寄せた（live*）。cache snapshot 経路は
  //   cachedSnapshot に統合済み。handleShowCached からは live state を書かない。
  const [liveMatchingLevel, setLiveMatchingLevel] = useState<'basic' | 'full' | null>(null);
  // STEP6.5: 旧 4 canonical state (basicFormData / activityData / selfPRs / wallHitting) を
  //   matchingInput 1 state に集約。すべて mount 1 回限りの restore で、ランタイム中の
  //   個別 setter が無く ownership が共通だったため統合可能。read は下の readonly alias 経由。
  // STEP6.6: mount restore は loadFreshMatchingInputSnapshot (read-only) を使う形に切り替え済み。
  //   admissionMatchingInput key への write は handleStartMatching の collectAndSaveMatchingInput
  //   のみに集約された。これに伴い home の "in_progress" 判定タイミングが
  //   「ページを開いた瞬間」→「診断開始ボタンを押した瞬間」へ変更されている。
  // STEP-PAGE-FIX-01: 旧 `useState<AdmissionMatchingInput | null>(null)` + mount useEffect の
  //   `setMatchingInput(input)` を、isMounted + useMemo の derived value に置き換えた。
  //   mount 1 回限りの restore で writer が存在しなかったため、state の必要性が無い。
  //   SSR ではまだ isMounted=false で null を返し、hydration 後に loadFreshMatchingInputSnapshot()
  //   の結果に切り替わる。挙動（旧 effect 後の matchingInput 値）と完全等価。
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  const matchingInput = useMemo<AdmissionMatchingInput | null>(() => {
    if (!isMounted) return null;
    const input = loadFreshMatchingInputSnapshot();
    // basicInfo が無いと downstream 経路が成立しないため null に倒す（旧 effect の if-guard と同形）。
    return input.basicInfo ? input : null;
  }, [isMounted]);
  // STEP6.3: STEP6.2 で導入した cachedResultsSnapshot（MatchingResult[] 単体）を
  //   AiMatchAdviceCache（{results, aiAdvices, matchingLevel}）に拡張。cache 表示時の
  //   results / aiAdvices / matchingLevel を 1 つの snapshot から取り出す形に統合した。
  //   storage 側の AiMatchAdviceCache 型・保存形式は無変更。
  const [cachedSnapshot, setCachedSnapshot] = useState<AiMatchAdviceCache | null>(null);
  const [liveAiAdvices, setLiveAiAdvices] = useState<AiMatchAdvice[]>([]);
  // STEP-API-MATCHING-01: matching API が partial fail（一部 candidate のみ AI 生成失敗）
  // で 200 を返したときに、live 結果画面に小さい注意文を出すための flag。
  // 全成功時 = false。cache snapshot 表示時は対象外（保存形式は変えていない）。
  const [livePartial, setLivePartial] = useState(false);
  // STEP-PAGE-FIX-01: 旧 `useState(true)` + mount effect の `setLoading(false)` を
  //   isMounted から derive する形に変更。loading=true の唯一の writer が mount effect だったため、
  //   isMounted の否定で機能的に等価（SSR / hydration 直後は loading=true、mount 後は false）。
  const loading = !isMounted;
  const [aiLoading, setAiLoading] = useState(false);
  // STEP-UX-FIX-06-LOADING-PROGRESS: aiLoading=true に切り替わる時に Date.now() を捕捉。
  // finally で null に戻し、LoadingProgress unmount で setInterval を cleanup させる。
  const [aiLoadingStartedAt, setAiLoadingStartedAt] = useState<number | null>(null);
  // STEP-UX-FIX-06c-CANCEL-WIRING: 進行中の /api/matching fetch を中断するための AbortController。
  // - 値は handleStartMatching → handleAiEnhance の fetch 直前に new し、ref に保持
  // - cancel button または unmount で .abort() を呼ぶ
  // - handleAiEnhance には signal を引数で渡す（fetch options に注入）
  // - finally で必ず null に戻し orphan controller を残さない
  // - handleShowCached は fetch しないため controller を作らない（cache hit 不変）
  const abortControllerRef = useRef<AbortController | null>(null);
  // STEP6.7: 旧 aiError state を削除。エラー UI は handleStartMatching の catch にある
  //   alert(...) を正式 UX として採用済み。inline banner は writer が存在せず dead branch
  //   だったため削除した（state / render / setter まとめて廃止）。
  const [hasCachedResult, setHasCachedResult] = useState(false);
  // STEP6.7: cachedTimestamp は 4 経路で更新される ──
  //   (1) mount-init: cache 存在時に loadAiMatchAdviceTimestamp() を反映
  //   (2) handleStartMatching 成功時: null クリア（live 結果のため "前回診断" ラベルを出さない）
  //   (3) handleShowCached: loadAiMatchAdviceTimestamp() を再反映（cached snapshot 表示中ラベル用）
  //   (4) handleReset: loadAiMatchAdviceTimestamp() を再反映（confirm 画面の "前回診断" 表示維持）
  //   現状この 4 経路の分岐は各 handler に分散しているが、cache semantics そのものが意味的に
  //   別物なので統合はしない。意図ある分散として残す。
  const [cachedTimestamp, setCachedTimestamp] = useState<string | null>(null);

  // STEP6.5: matchingInput からの readonly alias（state ではない）。
  //   旧 state 名と同名にすることで render / handler の参照を機械的に維持している。
  //   alias は state ではないので setter を持たず、書き換えはすべて setMatchingInput 経由。
  const basicFormData = matchingInput?.basicInfo ?? null;
  const activityData = matchingInput?.activityData ?? null;
  const selfPRs = matchingInput?.selfPRs ?? [];
  const wallHitting = matchingInput?.wallHittingResult ?? null;

  // STEP6.2/6.5: canonical 入力からの純関数 derive。
  //   STEP6.5 で source を matchingInput 1 state に切り替え、依存配列も [matchingInput] に縮約した。
  // STEP6.8: dev observability log は production noise 防止のため NODE_ENV guard 配下に移した。
  //   挙動・出力内容は dev で完全同一。
  const liveResults = useMemo(() => {
    if (!matchingInput?.basicInfo) return [];
    const basicInfo = toBasicInfo(matchingInput.basicInfo);
    const analysis = deriveStudentAnalysis(
      matchingInput.basicInfo,
      matchingInput.activityData,
      matchingInput.selfPRs,
      matchingInput.wallHittingResult,
    );
    devLog("=== DERIVED ANALYSIS ===", analysis);
    return buildMatchingResults(basicInfo, analysis);
  }, [matchingInput]);

  // STEP6.2/6.5: missingItems は AdmissionMatchingInput を直接 getMissingItems へ渡せる。
  //   matchingInput が null（mount 前）の場合は警告 UI を出さない既存挙動に合わせ空配列。
  const missingItems = useMemo(
    () => (matchingInput ? getMissingItems(matchingInput) : []),
    [matchingInput],
  );

  // 出願条件 eligibility（AO 適性 score とは別レーン）。
  //   - basicInfo.preferences の各志望校について lib/universities.ts 経由で entries を取得し
  //     checkEligibility() で評定条件と照合する pure 派生
  //   - MatchingResult / localStorage cache / AI prompt には一切影響しない
  //   - cached snapshot 表示中も「現在の basicInfo」基準で再計算される（fresh eligibility 表示優先）
  //
  // PR9d-1 (H7): key を University.id に統一する。
  //   旧実装は pref.university（user 入力文字列）をキーにしていたため、
  //     1. 同名・別学部の preference が複数あると最初の 1 件しか保持されない
  //     2. 同名大学が 2 校以上存在した場合に collision のリスク
  //     3. ResultView 側の lookup と React key (PR9d-1 C1 で id 化) との semantics 不一致
  //   が発生していた。getAllUniversities() の static 25 件で (name + faculty) →
  //   University.id を解決し、univ id を Record key にすることで上記をまとめて回避する。
  //   pref の (name, faculty) が static DB に無い場合は eligibility 表示の対象外になる
  //   ことを許容する（現状でも結果側 MatchingResult は static DB 起点のため UI 等価）。
  const eligibilityById = useMemo<Record<string, EligibilityResult[]>>(() => {
    const basicInfo = matchingInput?.basicInfo;
    if (!basicInfo) return {};
    const allUniversities = getAllUniversities();
    const map: Record<string, EligibilityResult[]> = {};
    for (const pref of basicInfo.preferences ?? []) {
      const name = (pref.university ?? '').trim();
      if (!name) continue;
      const univ = allUniversities.find(
        (u) => u.name === name && u.faculty === pref.faculty,
      );
      if (!univ || map[univ.id]) continue;
      const entries = findUniversityEntriesByUserChoices({
        university: pref.university,
        faculty: pref.faculty,
        department: pref.department,
      });
      if (entries.length > 0) {
        map[univ.id] = checkEligibility(basicInfo, entries);
      }
    }
    return map;
  }, [matchingInput]);

  // STEP6.3: 表示中の (results / aiAdvices / matchingLevel) を 1 つの snapshot 由来に揃える。
  //   cachedSnapshot が非 null のときは 3 つすべて snapshot から、live 表示時は 3 つすべて live state から。
  //   これで「results は cached、advice は live」のような source 不整合が構造上発生しなくなる。
  const isShowingCached = cachedSnapshot !== null;
  const displayResults = cachedSnapshot ? cachedSnapshot.results : liveResults;
  const displayAiAdvices = cachedSnapshot ? cachedSnapshot.aiAdvices : liveAiAdvices;
  const displayMatchingLevel = cachedSnapshot ? cachedSnapshot.matchingLevel : liveMatchingLevel;

  // STEP-PAGE-FIX-01: dev observability。snapshot 内容 + 不足項目の dev 警告。
  //   旧 mount useEffect (matching input restore) と統合していたが、matchingInput を
  //   useMemo 化したため、log だけを別 effect に切り出した。matchingInput が確定した
  //   瞬間（isMounted=true で 1 回）のみ発火する semantics は維持。
  //   UI 側の missing 警告（confirm 画面の黄色枠）とは別経路の dev-only ログで、guard は
  //   devLog / devWarn helper 内に閉じ込め済み（production では no-op）。
  useEffect(() => {
    if (!matchingInput) return;
    devLog("=== MATCHING INPUT DATA ===");
    devLog({
      savedAt: matchingInput.savedAt,
      basicInfo: matchingInput.basicInfo,
      activityData: matchingInput.activityData,
      selfPRs_count: matchingInput.selfPRs.length,
      selfPRs: matchingInput.selfPRs,
      wallHittingResult: matchingInput.wallHittingResult,
    });
    if (!matchingInput.basicInfo)           devWarn("MISSING: basicInfo(基本情報が未入力)");
    if (!matchingInput.activityData)        devWarn("MISSING: activityData(活動整理が未入力)");
    if (matchingInput.selfPRs.length === 0) devWarn("MISSING: selfPRs(自己分析添削が未入力)");
    if (!matchingInput.wallHittingResult)   devWarn("MISSING: wallHittingResult(AI壁打ちが未実施)");
  }, [matchingInput]);

  // STEP-PAGE-FIX-01: cache existence / timestamp restore — 「以前の診断結果を見る」CTA 用。
  //   hasCachedResult / cachedTimestamp は handleStartMatching / handleShowCached /
  //   refreshCachedTimestamp / handleReset でも書き換わる genuine state（mount 1 回の derive では
  //   表現できない）。よって本 effect は意図的に setState を伴う side-effect として残し、
  //   `react-hooks/set-state-in-effect` は本 block 限定で disable する。matchingInput / loading は
  //   別経路で derive 化したため、本 effect から除外済み。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (loadAiMatchAdviceCache()) {
      setHasCachedResult(true);
      const ts = loadAiMatchAdviceTimestamp();
      if (ts) setCachedTimestamp(ts);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ───────────────────────────────────────────────────────────────────
  // STEP6.15: Matching execution handlers
  //   各 handler の責務境界を読みやすくするための section comment。
  //   handler 内部の STEP6.x history コメントは load-bearing context として温存。
  // ───────────────────────────────────────────────────────────────────

  // STEP7.2: Re-sync cached result timestamp from storage.
  //   handleShowCached / handleReset の 2 経路 (cf. STEP6.7 の 4 経路明文化のうち (3) と (4))
  //   で同一だった setCachedTimestamp(loadAiMatchAdviceTimestamp()) を DRY 化したもの。
  const refreshCachedTimestamp = () => {
    setCachedTimestamp(loadAiMatchAdviceTimestamp());
  };

  // ── handleAiEnhance() ─────────────────────────────────────────────
  //   Responsibility: /api/matching への単発 POST と AI advice の受領のみ。
  //   - liveResults / wallHitting が空なら no-op で [] を返す
  //   - apiPayload を組み立てて /api/matching に送信
  //   - 成功時: advices を liveAiAdvices state へ格納し戻り値として返す
  //   - 失敗時: throw（cache 保存 / loading toggle / alert は呼び出し元 handleStartMatching の責務）
  // STEP6.2: 送信対象は live derive の liveResults。cached snapshot を再送しないようにした。
  async function handleAiEnhance(signal?: AbortSignal): Promise<AiMatchAdvice[]> {
    if (!wallHitting || liveResults.length === 0) return [];

    // ── MatchingInput を組み立てる ───────────────────────────────
    // 設計意図: 文章生成層 (/api/matching) への入力契約を MatchingInput 型で表現する。
    //   将来 大学DB 接続後は universityContexts を enrich してから送る、または
    //   API 側の TODO 箇所で enrich 処理を挟む。
    // STEP6.5: state の matchingInput (AdmissionMatchingInput) と shadow しないよう apiPayload に改名。
    const apiPayload: MatchingInput = {
      basicInfo: basicFormData,
      activityData,
      selfAnalysis: wallHitting,
      universityContexts: buildUniversityContextsFromBasicInfo(basicFormData),
    };

    // STEP6.8/6.14: API 送信前 payload の dev observability。
    //   この site のみ outer guard を温存している。理由: payload に loadSelfPRs() という
    //   storage read が含まれており、STEP6.8 で「production では loadSelfPRs() 自体を呼ばない」
    //   挙動を保証していたため。devLog の inner guard だけだと引数評価で read が走ってしまう。
    //   devLog 内 guard と二重になるが、production 挙動維持を優先。
    if (process.env.NODE_ENV !== 'production') {
      devLog("=== MATCHING FINAL INPUT ===", {
        ...apiPayload,
        // selfPRs は MatchingInput 型には含めないが、デバッグ目的でログには出す（既存挙動維持）
        selfPRs: loadSelfPRs(),
      });
    }

    // 【canonical path】下流に渡るのは StudentProfile 経由のみ。
    //   1. localStorage の canonical StudentProfile を最優先（getStudentProfileForFeature 内で読む）
    //   2. 無ければ wallHitting から派生（後方互換）
    //   3. どちらも無ければ null（自己分析未実施）
    // selfAnalysis / wallHitting は server-side fallback 用に併送する（移行が済み次第削除可）。
    // 新しい feature は selfAnalysis / wallHitting を直接送らず studentProfile を canonical input とする。
    const studentProfile = getStudentProfileForFeature({ wallHittingResult: wallHitting });

    const res = await fetch('/api/matching', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // STEP-UX-FIX-06c-CANCEL-WIRING: caller (handleStartMatching) から signal を受けとり
      // LoadingProgress の cancel button / unmount で中断できるようにする。signal が
      // undefined のときは AbortController を通さない fetch と等価。
      signal,
      // results はスコアリング層 (lib/matching/*) からの deterministic な出力。
      // studentProfile が canonical。selfAnalysis / wallHitting は LEGACY fallback として併送する。
      body: JSON.stringify({
        results: liveResults,
        basicInfo: apiPayload.basicInfo,
        activityData: apiPayload.activityData,
        // canonical artifact。API はこれを最優先で読み、buildMatchingStudentProfileContext へ渡す。
        studentProfile,
        // LEGACY fallback。studentProfile が null のときに API が toStudentProfile() で派生する保険。
        // canonical path への移行が完了次第このフィールドは削除可能。
        selfAnalysis: apiPayload.selfAnalysis,
        wallHitting: apiPayload.selfAnalysis,
        universityContexts: apiPayload.universityContexts,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail ?? 'AI強化に失敗しました');
    }
    const advices = data.advices as AiMatchAdvice[];
    // STEP6.3: API 結果は live 専用 state へ。cache snapshot を汚さない。
    setLiveAiAdvices(advices);
    // STEP-API-MATCHING-01: partial fail（一部 candidate のみ失敗）を最小 UX で通知する。
    // response 形式が変わっても既存 advices 読込は壊れない（partial は optional）。
    // cache 保存はせず、live 表示中のみ flag を立てる。
    setLivePartial(data.partial === true);
    return advices;
  }

  // ── handleStartMatching() ─────────────────────────────────────────
  //   Responsibility: 「志望校マッチングをする」ボタンのフロー全体。
  //   - 入力 snapshot を集約・persist（collectAndSaveMatchingInput の write 経路 → admissionMatchingInput key）
  //   - 診断 level を入力時点で確定（wallHittingResult の有無で 'full' / 'basic'）
  //   - cachedSnapshot を null クリアして live 表示へ切替
  //   - handleAiEnhance を await し、成功時のみ AiMatchAdviceCache を保存（saveAiMatchAdviceCache）
  //   - cachedTimestamp を null クリア（live 結果なので "前回診断" ラベルを出さない）
  //   - markMatchingCompleted で完了フラグ（admissionMatchingResult key）を立てて結果ページへ遷移
  //   - 失敗時は alert + console.error、cache 更新は行わない
  //   - aiLoading は finally で常に解除
  // 成功時のみ結果ページへ遷移するフロー制御
  const handleStartMatching = async () => {
    // 診断レベルはAPIの成否に依存しない。入力データの時点で確定させる
    const input = collectAndSaveMatchingInput();
    const level = input.wallHittingResult ? 'full' : 'basic';
    // STEP6.3: live 表示用の matchingLevel を書き換える。cachedSnapshot 経路は触らない。
    setLiveMatchingLevel(level);
    // STEP6.2/6.3: cached 表示中から「再診断する」で呼ばれた場合に live 表示へ切り替える。
    setCachedSnapshot(null);
    setAiLoading(true);
    setAiLoadingStartedAt(Date.now());

    // STEP-UX-FIX-06c-CANCEL-WIRING: 既存 ref に残っていれば（前回 fetch が finally 経由
    // しなかった保険として）abort して上書き。新 controller を ref に保持し signal を
    // handleAiEnhance に渡す。
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const advices = await handleAiEnhance(controller.signal);
      // キャッシュ保存（API成功時のみ）。live derive を canonical として保存する。
      // 保存形式（AiMatchAdviceCache）は STEP6.2 以前と同一。
      const cache: AiMatchAdviceCache = { results: liveResults, aiAdvices: advices, matchingLevel: level };
      saveAiMatchAdviceCache(cache, new Date().toISOString());
      setHasCachedResult(true);
      setCachedTimestamp(null); // live結果なので表示タイムスタンプはクリア
      markMatchingCompleted();
      setHasRunMatching(true);
    } catch (error) {
      // STEP-UX-FIX-06c-CANCEL-WIRING: user cancel は通常エラーと分離。alert を出さず、
      // cache 保存 / markMatchingCompleted / hasRunMatching toggle にも到達していない
      // （fetch が throw した時点で後続の save* / setHasRunMatching を skip 済み）。
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error(error);
      alert('マッチングに失敗しました。もう一度お試しください。');
    } finally {
      setAiLoading(false);
      setAiLoadingStartedAt(null);
      // 終了経路（成功 / abort / network error）共通の cleanup。
      // 別 submit が立ち上がる前に必ず ref を空にして orphan controller を残さない。
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  // ── handleCancelMatching() ────────────────────────────────────────
  // STEP-UX-FIX-06c-CANCEL-WIRING: LoadingProgress の cancel button から呼ばれる。
  // 進行中の /api/matching fetch を AbortController.abort() で中断する。state は
  // handleStartMatching の finally で揃って null に戻るため、ここで setAiLoading 等
  // は触らない（一元管理）。cache hit 経路（handleShowCached）は別 handler なので影響なし。
  function handleCancelMatching() {
    abortControllerRef.current?.abort();
  }

  // STEP-UX-FIX-06c-CANCEL-WIRING: page unmount 時に in-flight fetch を中断する。
  // ユーザーが結果を待たずに別ページへ遷移したケースでも、AI route 側 timeout を待たずに
  // client 側で接続を閉じる。unmount 後の setState は React 18 では no-op で安全。
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  // ── handleShowCached() ────────────────────────────────────────────
  //   Responsibility: 「以前の診断結果を見る」CTA のハンドラ。
  //   - cache 層（matchingResult key）から AiMatchAdviceCache を読み出す
  //   - データが無い場合は alert で異常系を通知して何もせず終了
  //   - cachedSnapshot に restore し、render が snapshot 由来の 3 値（results / aiAdvices / matchingLevel）を表示
  //   - cachedTimestamp も storage から再反映（結果画面のキャッシュ表示インジケーター用）
  //   - hasRunMatching=true で結果ページへ遷移
  //   - 注: live state（liveAiAdvices / liveMatchingLevel）は意図的に書き換えない（live を汚さない）
  function handleShowCached() {
    const cached = loadAiMatchAdviceCache();
    if (!cached) {
      // hasCachedResult が true だったのに読めない = データ破損などの異常系
      alert('保存済みの結果を読み込めませんでした。');
      return;
    }
    // STEP6.3: cache 由来の表示データは cachedSnapshot に集約。
    //   liveAiAdvices / liveMatchingLevel は意図的に書き換えない（live state を汚さない）。
    //   render 側は cachedSnapshot 非 null のときに 3 値すべて snapshot 由来となる。
    setCachedSnapshot(cached);
    refreshCachedTimestamp();
    setHasRunMatching(true);
  }

  // ── handleReset() ─────────────────────────────────────────────────
  //   Responsibility: 結果画面から confirm 画面へ戻すための in-memory リセット。
  //   - hasRunMatching=false で confirm view へ遷移
  //   - live state（liveMatchingLevel / liveAiAdvices）を初期値へ
  //   - cachedSnapshot を null（次回 handleShowCached が呼ばれたとき storage から再 load）
  //   - cachedTimestamp は storage から再 load（confirm 画面の "前回診断" ラベル表示用）
  //   - 注: localStorage の cache / snapshot 自体は削除しない。同セッションで再表示可能なまま残す。
  function handleReset() {
    setHasRunMatching(false);
    // STEP6.3: live state を初期化（既存挙動を維持）。snapshot 経路は別途破棄。
    setLiveMatchingLevel(null);
    setLiveAiAdvices([]);
    // STEP-API-MATCHING-01: 再診断に向けて partial 表示も解除。
    setLivePartial(false);
    // STEP6.7: setAiError('') は dead state クリーンアップだったため削除。
    // STEP6.2/6.3: cached 表示中に reset された場合に snapshot を破棄して live derive に戻す。
    setCachedSnapshot(null);
    // 確認ページに戻った後もキャッシュ日時を表示するため localStorage から再読み込み
    refreshCachedTimestamp();
  }

  // ── ローディング ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <p className="text-gray-500 text-sm">読み込み中...</p>
      </div>
    );
  }

  // ── basicInfo なし ──────────────────────────────────────────────

  if (!basicFormData) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
          <p className="text-yellow-800 font-semibold mb-2">基本情報が見つかりません</p>
          <p className="text-yellow-700 text-sm mb-4">
            先に基本情報フォームを入力してください。
          </p>
          <a
            href="/input/basic"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded-lg text-sm transition-colors"
          >
            基本情報フォームへ →
          </a>
        </div>
      </div>
    );
  }

  // ── API診断中 ───────────────────────────────────────────────────

  if (aiLoading && aiLoadingStartedAt !== null) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-gray-800 mb-8">AI志望校マッチング</h1>
        <LoadingProgress
          startedAt={aiLoadingStartedAt}
          label="AIがあなたの活動・自己分析・志望校情報をもとに診断しています"
          subMessages={MATCHING_SUB_MESSAGES}
          estimatedSeconds={30}
          onCancel={handleCancelMatching}
        />
      </div>
    );
  }

  // ── 確認 / 結果のスイッチ ──────────────────────────────────────
  // STEP6.11: confirm screen と result screen を logical view block へ切り出した。
  //   state ownership / handler ownership は page (AdmissionMatchingPage) に残し、
  //   各 view は props を受け取って render するだけの pure-ish 関数。
  //   state 移動・hook 移動・custom hook 化は STEP6.11 のスコープ外。
  return hasRunMatching ? (
    <>
      {/* STEP-API-MATCHING-01: live で partial fail（一部 candidate の AI 文生成失敗）が
          発生したときだけ小さい注意文を出す。cache 表示中（isShowingCached=true）は対象外。
          UI レイアウトを大きく変えないため、ResultView の直上に 1 行 alert として置く。 */}
      {!isShowingCached && livePartial && (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-6">
          <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            一部候補の分析に失敗しましたが、取得できた結果を表示しています。
          </p>
        </div>
      )}
      <ResultView
        displayMatchingLevel={displayMatchingLevel}
        wallHitting={wallHitting}
        displayResults={displayResults}
        displayAiAdvices={displayAiAdvices}
        eligibilityById={eligibilityById}
        isShowingCached={isShowingCached}
        cachedTimestamp={cachedTimestamp}
        onReset={handleReset}
        onStartMatching={handleStartMatching}
      />
    </>
  ) : (
    <ConfirmView
      missingItems={missingItems}
      basicFormData={basicFormData}
      activityData={activityData}
      wallHitting={wallHitting}
      selfPRs={selfPRs}
      hasCachedResult={hasCachedResult}
      cachedTimestamp={cachedTimestamp}
      onStartMatching={handleStartMatching}
      onShowCached={handleShowCached}
    />
  );
}


// STEP6.9:  ActivitySummary → app/admission-matching/components/ActivitySummary.tsx
// STEP6.10: MatchingCard + 評価サマリー helper 4 つ
//           (getScoreSubLabel / getAffinityLabel / getAcceptanceLabel / getSummaryComment)
//           → app/admission-matching/components/MatchingCard.tsx
// STEP6.11: ConfirmView / ResultView を local function として logical split
// STEP6.12: ConfirmView / ResultView を physical split
//           → app/admission-matching/components/{ConfirmView,ResultView}.tsx
//           本ファイルからは barrel ./components 経由で import する。
