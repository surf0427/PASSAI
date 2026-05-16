'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { AiThinkingState } from '@/components/shared/result';
// STEP6.12: feature-local components は barrel export 経由でまとめて import。
import { ConfirmView, ResultView } from './components';

// STEP6.13: toBasicInfo 変換ヘルパーは @/lib/matching/toBasicInfo へ移動済み。
//   pure domain helper のため orchestration layer (page.tsx) から除去した。

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
  const [matchingInput, setMatchingInput] = useState<AdmissionMatchingInput | null>(null);
  // STEP6.3: STEP6.2 で導入した cachedResultsSnapshot（MatchingResult[] 単体）を
  //   AiMatchAdviceCache（{results, aiAdvices, matchingLevel}）に拡張。cache 表示時の
  //   results / aiAdvices / matchingLevel を 1 つの snapshot から取り出す形に統合した。
  //   storage 側の AiMatchAdviceCache 型・保存形式は無変更。
  const [cachedSnapshot, setCachedSnapshot] = useState<AiMatchAdviceCache | null>(null);
  const [liveAiAdvices, setLiveAiAdvices] = useState<AiMatchAdvice[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
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

  useEffect(() => {
    // STEP6.8: mount-init は意味的に独立した 3 セクションを順に実行する。
    //   custom hook 化や関数切り出しは禁止スコープのため、境界はコメントで明示する。
    //   ────────────────────────────────────────────────────────────────
    //   (1) matching input restore  — read-only snapshot を取って state へ反映
    //   (2) cache existence/timestamp restore — 「以前の診断結果を見る」CTA 用
    //   (3) hydration-safe loading gate を解除（Recipe X）
    //   ────────────────────────────────────────────────────────────────

    // ── (1) matching input restore ────────────────────────────────
    // STEP6.6: mount restore は read-only snapshot に変更（admissionMatchingInput key への
    //   write を伴わない）。これにより「matching ページを開いただけで進捗 in_progress 化」
    //   する旧挙動はなくなり、in_progress は「診断開始ボタンを押した瞬間」に切り替わる
    //   （= handleStartMatching の collectAndSaveMatchingInput が走ったとき）。
    //   ローカル変数名は state alias と衝突しないよう input にしている。
    const input = loadFreshMatchingInputSnapshot();

    // STEP6.8/6.14: dev observability。snapshot 内容 + 不足項目の dev 警告。
    //   UI 側の missing 警告（confirm 画面の黄色枠）とは別経路の dev-only ログ。
    //   guard は devLog / devWarn helper 内に閉じ込め済み。
    devLog("=== MATCHING INPUT DATA ===");
    devLog({
      savedAt: input.savedAt,
      basicInfo: input.basicInfo,
      activityData: input.activityData,
      selfPRs_count: input.selfPRs.length,
      selfPRs: input.selfPRs,
      wallHittingResult: input.wallHittingResult,
    });
    if (!input.basicInfo)           devWarn("MISSING: basicInfo（基本情報が未入力）");
    if (!input.activityData)        devWarn("MISSING: activityData（活動整理が未入力）");
    if (input.selfPRs.length === 0) devWarn("MISSING: selfPRs（自己分析添削が未入力）");
    if (!input.wallHittingResult)   devWarn("MISSING: wallHittingResult（AI壁打ちが未実施）");

    if (input.basicInfo) {
      // STEP6.5: 旧 4 setter (setBasicFormData / setActivityData / setSelfPRs / setWallHitting)
      //   を 1 件に集約。derived (results / missingItems) は useMemo 側で recompute される。
      setMatchingInput(input);
    }

    // ── (2) cache existence / timestamp restore ───────────────────
    // キャッシュ済み結果があれば「以前の診断結果を見る」ボタンを有効化
    if (loadAiMatchAdviceCache()) {
      setHasCachedResult(true);
      const ts = loadAiMatchAdviceTimestamp();
      if (ts) setCachedTimestamp(ts);
    }

    // ── (3) hydration-safe loading gate 解除（Recipe X） ──────────
    setLoading(false);
  }, []);

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
  async function handleAiEnhance(): Promise<AiMatchAdvice[]> {
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

    try {
      const advices = await handleAiEnhance();
      // キャッシュ保存（API成功時のみ）。live derive を canonical として保存する。
      // 保存形式（AiMatchAdviceCache）は STEP6.2 以前と同一。
      const cache: AiMatchAdviceCache = { results: liveResults, aiAdvices: advices, matchingLevel: level };
      saveAiMatchAdviceCache(cache, new Date().toISOString());
      setHasCachedResult(true);
      setCachedTimestamp(null); // live結果なので表示タイムスタンプはクリア
      markMatchingCompleted();
      setHasRunMatching(true);
    } catch (error) {
      console.error(error);
      alert('マッチングに失敗しました。もう一度お試しください。');
    } finally {
      setAiLoading(false);
    }
  };

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

  if (aiLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-gray-800 mb-8">AI志望校マッチング</h1>
        <AiThinkingState
          message="AIがあなたの活動・自己分析・志望校情報をもとに診断しています..."
          estimatedSeconds={30}
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
