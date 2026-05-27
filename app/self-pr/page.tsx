'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import type { SelfPR } from '@/types/selfPR';
import type { StudentProfile } from '@/types/studentProfile';
import type { SummaryResult } from '@/types/analysis';
import { loadSelfPRs, saveSelfPRs } from '@/lib/selfPRStorage';
import { loadSelfPRDraft, clearSelfPRDraft } from '@/lib/selfPRDraftStorage';
import { selfAnalysisLimit, type DailyUsage } from '@/lib/dailyLimit';
import { saveAnalyzeState, loadAnalyzeState } from '@/lib/analyzeStorage';
import { loadWallHittingResult } from '@/lib/wallHittingStorage';
import { getStudentProfileForFeature } from '@/lib/getStudentProfileForFeature';
import { buildSelfPRDraftSeed } from '@/lib/buildSelfPRDraftSeed';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/ui/FormField';

// ── 日時フォーマット ──────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${h}:${min}`;
}

// buildSelfPRDraftSeed の入力（profile + analyzeSummary）を identity-stable に hash 化する。
// 既存 selfPRs[].seedInputHash と比較し、現在の canonical 入力に対応する PR が無い時だけ
// 新規カードを追加する判定キー（重複作成を防ぐ）。
// 含めるフィールドは buildSelfPRDraftSeed が実際に読む全項目 + profile.sourceHash の早期判定キー。
// djb2 base36 — 衝突耐性は要求しない（重複作成判定用途のみ）。
function computeSeedInputHash(
  profile: StudentProfile | null,
  analyzeSummary: SummaryResult | null,
): string {
  const payload = {
    profileSourceHash: profile?.sourceHash ?? null,
    profileSummary: profile?.summary ?? null,
    profileStrengths: profile?.strengths ?? null,
    profileFutureConnections: profile?.futureConnections ?? null,
    profileSignatureEpisodes: profile?.signatureEpisodes ?? null,
    analyzeActivitySummary: analyzeSummary?.activitySummary ?? null,
    analyzeStrengths: analyzeSummary?.strengths ?? null,
    analyzeAppealPoints: analyzeSummary?.appealPoints ?? null,
  };
  const text = JSON.stringify(payload);
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// タイトルが未入力の場合に本文冒頭20文字を使う
function resolveTitle(pr: SelfPR): string {
  if (pr.title && pr.title.trim()) return pr.title.trim();
  if (pr.text.trim()) return pr.text.trim().slice(0, 20) + (pr.text.trim().length > 20 ? '…' : '');
  return '（本文未入力）';
}

// ── ページ本体 ───────────────────────────────────────────────────

// useSearchParams を本コンポーネントが使うため、default export 側で <Suspense> ラップする
// （Next.js prerender bailout warning を抑える）。/statement/edit/page.tsx と同形パターン。
function SelfPrPageInner() {
  const router = useRouter();
  // ?mode=direct と ?from=run を reactive に観測する。
  // useEffect の [] deps だと同一 route 内 navigation（/self-pr ↔ /self-pr?mode=direct 等）で
  // mount 効果が再実行されず、前 session の state（selectedId / openedFromRun / text 等）が
  // 残ったまま editor が描画されてしまうため、search を deps に取った別 effect で
  // mode=direct entry を都度処理する。
  const searchParams = useSearchParams();
  const modeParam = searchParams?.get('mode') ?? null;
  const [selfPRs, setSelfPRs] = useState<SelfPR[]>([]);
  const [usage, setUsage] = useState<DailyUsage>({ date: '', count: 0 });
  // 「まだ自己分析が作成されていません」を出すかの判定材料。
  // analyzeState.summary（/api/summarize の結果）が存在すれば自己分析は完了済み。
  // 既存の selfPRs 件数（=自己PR添削履歴）とは別レーン。
  const [hasSelfAnalysis, setHasSelfAnalysis] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [followupText, setFollowupText] = useState('');
  const [result, setResult] = useState('');
  // 今セッションで /api/reason から fetch した直後の result かどうかを示す。
  // 過去 PR を開いて saveResult を hydrate しただけのときは false。
  // followup フォームは「今 fetch した result」に対してだけ意味があるため、
  // この flag が true のときだけ表示する（保存済み result に followup を被せると
  // 古い分析結果を combined prompt に含めて再課金する経路に入ってしまうため）。
  const [freshlyFetched, setFreshlyFetched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // ①フロー（/self-analysis/run summary →「自己PR添削ページへ進む」→ fromRun 経由 auto-open）
  // で編集画面に着地したかを記録する session-only flag。
  // URL は mount 直後に router.replace('/self-pr') で正規化されるため、
  // query で判定し続けることはできない（refresh / 共有時に来歴を失う）。
  // mount 効果で fromRun 経由 openPR を実行した瞬間にだけ true に立て、
  // 「← ステップ3に戻る」ボタンの表示分岐に使う。
  //   - mode=direct 経路: 早期 return で本 flag は touched 無し → false 維持
  //   - 一覧カード経由 openPR: mount 効果が openPR を呼ばないため false 維持
  //   - /self-pr 直接アクセス: fromRun=false で setOpenedFromRun 未呼出
  const [openedFromRun, setOpenedFromRun] = useState(false);
  // ②フロー（hub「書いた自己PRを添削する」→ /self-pr?mode=direct 経由）で着地したかを
  // 記録する session-only flag。URL は mount 効果で router.replace('/self-pr') へ
  // 正規化されるため query では判別できず、state で持つ。
  // 編集画面 UI を「タイトル / 本文 / 添削する / 添削結果」だけに簡略化するための分岐に使う。
  //   - fromRun 経路: 早期 return ではないが mode=direct とは異なる branch → false 維持
  //   - 一覧カード経由 openPR: 後段 mount 効果が openPR を呼ばず、また setOpenedDirectMode も
  //     呼ばないため false 維持
  //   - /self-pr 直接アクセス: modeDirect=false で setter 未呼出
  const [openedDirectMode, setOpenedDirectMode] = useState(false);

  // 本 effect は単純な storage restore ではなく、以下を兼ねる
  //   genuine mount-time side-effect である。
  //
  //   (1) storage 読込: selfPRs / selfAnalysisLimit usage / hasSelfAnalysis 判定
  //   (2) 自動 prefill の **one-time consumption（write side-effect）**:
  //       canonical priority に従って新規 PR を 1 件だけ追加するか決める。
  //         a. legacy selfPR_draft（writer 廃止済み）が残っていれば消費して 1 件追加
  //         b. 上記が無く、現在の canonical 入力に対応する PR が無く、
  //            StudentProfile/analyzeState.summary から seed が作れる場合は 1 件追加
  //         c. どちらも該当しなければ何も作らず既存 selfPRs を読むだけ
  //       a の場合、および b で初回（stored 空）の場合は openPR で自動オープンする。
  //       b で既存カードがあるとき（STEP3 等で summary 更新後の 2 件目追加）は
  //       openPR せず、user に一覧で新規カード追加を視認させる。
  //   (3) 既存 PR の text / seedInputHash は触らない（user 編集済みカードを保護）。
  //       同じ seed hash を持つ PR が既にあれば重複作成しない。
  //
  // mount gate（`if (!mounted) return null`）を持たないため lazy initializer /
  // useMemo に逃がすと SSR / client first render で hydration mismatch を起こす。
  // また prefill consumption は render 経路に置けない genuine write side-effect で、
  // useState() の初期化フェーズには載せられない。よって本 effect は genuine
  // side-effect のままにし、react-hooks/set-state-in-effect は scoped に disable する。
  //
  // exhaustive-deps も同じ block で disable: 末尾で `router.replace('/self-pr')` を
  // 呼ぶが、依存配列に `router` を入れると Next.js の useRouter 戻り値の参照変化で
  // effect が再 trigger され、seed PR 重複作成・redirect replay が発生する
  // （/home/page.tsx の PR10c (H2) と同形パターン）。router.replace は同一 segment
  // 内の soft navigation なので closure 経由の安定参照で問題ない。
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    try {
      // ②（mode=direct）は別 effect が担当するため、ここで初動から弾く。
      // 同一 route 内 navigation（query 変化）に対応するため、mount 効果 (`[]` deps) では
      // 不十分。別 effect が modeParam reactive deps で都度処理する。
      if (modeParam === 'direct') return;

      // ①フロー（hub の "0から自己PRを書く" → /self-analysis/run 完走 →
      //   summary CTA「自己PR添削ページへ進む」）からの着地を判別するフラグ。
      // 検出経路: 同 mount 直後の URL から from クエリを 1 度だけ確認する。
      // modeParam とは違って fromRun は ① 専用で 1 度立てば session-final、
      // re-entry も発生しない（① flow から /self-pr に来る経路は単一）ため
      // 別 effect 化は不要で本 mount 効果のみで扱う。
      const search =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search)
          : null;
      const fromRun = search?.get('from') === 'run';

      const stored = loadSelfPRs();
      const currentUsage = selfAnalysisLimit.loadUsage();
      const analyzeState = loadAnalyzeState();
      const legacyDraft = loadSelfPRDraft();
      // analyzeState.summary が非 null なら自己分析が完了済み（empty-state の文言分岐に使う）。
      // 旧 selfPR_draft writer 撤去後、ここでは「自己分析の有無」を analyzeState で直接判定する。
      setHasSelfAnalysis(!!analyzeState?.summary);

      // ②フロー (hub「全文を自力で書く」) 経路の処理は別の reactive effect
      // (`[modeParam]` deps) に切り出した。理由:
      //   - 同一 route 内 navigation（/self-pr?from=run → /self-pr?mode=direct 等）では
      //     本 mount 効果 (`[]` deps) は再実行されず、前 session の state が残るバグが
      //     発生していた。
      //   - modeParam を deps にした別 effect で都度初期化することで、URL 変化に追従する。
      // ここでは何もせず、modeDirect は下流の effect に委ねる。

      // seed 生成 / 重複判定で同じ source を読むために、profile / currentSeedInputHash を
      // branch 前に確定する（hash 計算は副作用なしの純粋関数）。
      const profile = getStudentProfileForFeature({
        wallHittingResult: loadWallHittingResult(),
      });
      const currentSeedInputHash = computeSeedInputHash(profile, analyzeState?.summary ?? null);

      // canonical prefill: legacy drain → 現在の seed hash 未対応なら追加 → none の順で
      // 1 度だけ決定する。既存カードの text / seedInputHash は触らない。
      let prefillText = '';
      let openAfterCreate = false;
      // ①フロー（fromRun=true）で seed が既に PR 化済みのとき、新規作成せずに
      // 既存 PR を 1 件だけ自動 open するための保留 id（write 経路には入らない）。
      let resumePRId: string | null = null;
      if (legacyDraft) {
        // legacy drain: 旧 raw string storage を消費して 1 件目 PR にする。
        // writer は廃止済みのため、stale data の自然な吐き出し経路として 1 度きり走る。
        clearSelfPRDraft();
        prefillText = legacyDraft;
        openAfterCreate = true;
      } else {
        // 現在の canonical 入力 hash に対応する PR が無ければ新規追加する。
        //   - stored 空: 初回。1 件目を seed で作って auto-open（従来 UX 維持）
        //   - stored あり, fromRun=false: 自己分析 summary が更新された（STEP3 等）→ 新規 2 件目を追加。
        //     auto-open しない: user に一覧で新規カードを視認させる。
        //   - stored あり, fromRun=true: ①フロー経由 → 一覧をスキップして新規 PR を直接 open。
        // user 編集後も seedInputHash は保持する（updateCurrentPR 参照）ため、
        // 同じ seed の重複作成は防げる。
        //
        // PR10c (H1): legacy user の selfPRs に seedInputHash 未設定の record が
        //   ある状態でも、自動 seed 追加は **同一 currentSeedInputHash で 1 度だけ** 走る。
        //   理由: 追加直後の new PR は `seedInputHash: currentSeedInputHash` を持つため
        //   (L 下流の newPR 生成参照)、次回 mount で
        //   `stored.find(pr => pr.seedInputHash === currentSeedInputHash)` が当たり、
        //   重複追加経路に入らない。currentSeedInputHash が変わるのは
        //   profile.sourceHash か analyzeState.summary が変化したときのみ（STEP3 等の
        //   意図的な再生成）であり、その場合は「新規 2 件目」が意図動作。よって
        //   無限増殖は構造的に発生しない。legacy record（hash 未設定）は dedup 対象外で
        //   保護されるため、user 編集済みカードは触らない。
        const matchingPR = stored.find((pr) => pr.seedInputHash === currentSeedInputHash);
        if (!matchingPR) {
          const seed = buildSelfPRDraftSeed({
            profile,
            analyzeSummary: analyzeState?.summary ?? null,
          });
          if (seed) {
            prefillText = seed;
            // fromRun=true（①フロー着地）なら過去 PR があってもリストをスキップして直接 open。
            openAfterCreate = stored.length === 0 || fromRun;
          }
        } else if (fromRun) {
          // 同 hash の PR が既存 → 新規作成は **しない**（schema を保つ）。
          // ①フローの一貫性を保つために、その PR を 1 件だけ自動 open する。
          resumePRId = matchingPR.id;
        }
      }

      // fromRun 由来で実際に編集画面を開いたかを記録するためのフラグ。
      // URL 正規化（?from=run の strip）は openPR の **後** に行う必要があるため、
      // 各分岐で openPR を呼んだ瞬間に true に立て、最後に router.replace で正規化する。
      let didAutoOpen = false;
      if (prefillText) {
        const now = new Date().toISOString();
        // legacy drain 由来は user-controlled 既存テキスト → 重複判定対象から外すため
        // seedInputHash を付けない。それ以外（buildSelfPRDraftSeed 由来）には現在の hash を保存する。
        const newPR: SelfPR = {
          id: crypto.randomUUID(),
          index: stored.length + 1,
          title: '',
          text: prefillText,
          latestResult: '',
          createdAt: now,
          updatedAt: now,
          ...(legacyDraft ? {} : { seedInputHash: currentSeedInputHash }),
        };
        const updated = [...stored, newPR];
        saveSelfPRs(updated);
        setSelfPRs(updated);
        setUsage(currentUsage);
        if (openAfterCreate) {
          openPR(newPR);
          didAutoOpen = true;
        }
      } else {
        setSelfPRs(stored);
        setUsage(currentUsage);
        if (resumePRId) {
          const target = stored.find((pr) => pr.id === resumePRId);
          if (target) {
            openPR(target);
            didAutoOpen = true;
          }
        }
      }

      // ①フロー着地（fromRun=true）かつ openPR で編集画面に入ったときだけ
      // URL を /self-pr に正規化する。同 segment 内の soft navigation なので
      // useEffect 再実行・state 巻き戻りは発生しない（deps=[]）。
      // openPR を呼ばなかった経路（fromRun=true だが seed 生成不可など）では
      // URL を維持する: 「openPR より前に replace しない」契約の対偶として、
      // openPR 未実行なら strip も行わない方が一貫する。
      // 併せて openedFromRun を立て、編集画面ヘッダに「← ステップ3に戻る」を
      // 表示する条件にする。openPR と replace の両方が揃った瞬間にだけ立てる。
      if (fromRun && didAutoOpen) {
        setOpenedFromRun(true);
        router.replace('/self-pr');
      }
    } catch (e) {
      console.error('selfPR: load failed', e);
      setError('読み込みに失敗しました。もう一度お試しください。');
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // ② mode=direct 専用の reactive effect。
  // modeParam が 'direct' になるたびに、前 session の state を一掃して空 PR を 1 件作り、
  // editor に直接入る。同一 route 内 navigation でも fires するため、
  // /self-pr?from=run → /self-pr?mode=direct のような遷移でも確実にリセットされる。
  // router.replace('/self-pr') で query を落とした後、modeParam は null に戻り
  // この effect は早期 return するだけ（無限ループや二重作成は発生しない）。
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (modeParam !== 'direct') return;
    try {
      // ② 初期化: 前 session の残留 state を全消し。
      //   - openedFromRun: ① の "← ステップ3に戻る" を出さない
      //   - openedDirectMode: editor UI を ② 簡略化モードに切替
      //   - error: 直前の API エラー痕跡を消す
      //   - openPR(newPR) が title / text / result / freshlyFetched / followupText を
      //     newPR の空フィールドから派生して再セットするため、ここでは触らない。
      setOpenedFromRun(false);
      setOpenedDirectMode(true);
      setError('');

      const stored = loadSelfPRs();
      const currentUsage = selfAnalysisLimit.loadUsage();
      // empty-state 文言分岐用。一覧経路には来ないが、副作用ゼロのため一貫してセットする。
      const analyzeState = loadAnalyzeState();
      setHasSelfAnalysis(!!analyzeState?.summary);

      if (selfAnalysisLimit.canUse(currentUsage)) {
        const now = new Date().toISOString();
        // 必ず空の新規 PR を作る。matchingPR / seedInputHash は使わない（② は素材を読まない）。
        const newPR: SelfPR = {
          id: crypto.randomUUID(),
          index: stored.length + 1,
          title: '',
          text: '',
          latestResult: '',
          createdAt: now,
          updatedAt: now,
        };
        const updated = [...stored, newPR];
        saveSelfPRs(updated);
        setSelfPRs(updated);
        setUsage(selfAnalysisLimit.incrementUsage(currentUsage));
        openPR(newPR);
      } else {
        // daily limit 上限到達: 一覧着地に倒す graceful degradation。
        setSelfPRs(stored);
        setUsage(currentUsage);
      }
      router.replace('/self-pr');
    } catch (e) {
      console.error('selfPR mode=direct: setup failed', e);
      setError('準備に失敗しました。もう一度お試しください。');
    }
  }, [modeParam]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const selectedPR = selfPRs.find((pr) => pr.id === selectedId) ?? null;

  function updateCurrentPR(patch: Partial<SelfPR>) {
    setSelfPRs((prev) => {
      const updated = prev.map((pr) => {
        if (pr.id !== selectedId) return pr;
        // seedInputHash は user 編集後も保持する: mount effect の重複作成判定で
        // 「この PR は seed hash X 由来」というマーカーとして使い続けるため。
        // text/title/latestResult は patch 通りに更新する。
        return { ...pr, ...patch, updatedAt: new Date().toISOString() };
      });
      saveSelfPRs(updated);
      return updated;
    });
  }

  function createNewPR() {
    if (!selfAnalysisLimit.canUse(usage)) return;
    const now = new Date().toISOString();
    const newPR: SelfPR = {
      id: crypto.randomUUID(),
      index: selfPRs.length + 1,
      title: '',
      text: '',
      latestResult: '',
      createdAt: now,
      updatedAt: now,
    };
    const updated = [...selfPRs, newPR];
    saveSelfPRs(updated);
    setSelfPRs(updated);
    setUsage(selfAnalysisLimit.incrementUsage(usage));
    openPR(newPR);
  }

  function openPR(pr: SelfPR) {
    setSelectedId(pr.id);
    setTitle(pr.title ?? '');
    setText(pr.text);
    setResult(pr.latestResult ?? '');
    setFreshlyFetched(false);
    setFollowupText('');
    setError('');
  }

  // 旧 backToList（編集画面 → 一覧）は ①フローのシームレス化に伴い削除。
  // 編集画面ヘッダの「← 一覧に戻る」ボタンも同時撤去。一覧へは /self-pr 直接アクセス、
  // /self-analysis hub、または summary CTA から着地する経路に集約する。

  // 上部「← 自己分析の活動まとめに戻る」→ ③活動まとめ(summary)へ戻る。
  // STEP-NAV-1 以降、自己分析の実フローは /self-analysis/run に退避済み。
  // hub (/self-analysis) は step を解釈しないので、step 反映を活かすため /run に直接戻す。
  function goBackToSelfAnalysisSummary() {
    const savedState = loadAnalyzeState();
    if (!savedState) {
      router.push('/self-analysis/run');
      return;
    }
    saveAnalyzeState({ ...savedState, step: 'summary' });
    router.push('/self-analysis/run');
  }

  // カード「自己分析の深掘りを修正する →」→ ②深掘り回答(answering)へ戻る
  function goToSelfAnalysisAnswering() {
    const savedState = loadAnalyzeState();
    if (!savedState) {
      router.push('/self-analysis/run');
      return;
    }
    saveAnalyzeState({ ...savedState, step: 'answering' });
    router.push('/self-analysis/run');
  }

  function deletePR(id: string) {
    if (!window.confirm('この自己PR添削履歴を削除しますか？\nこの操作は元に戻せません。')) return;
    setSelfPRs((prev) => {
      const updated = prev.filter((pr) => pr.id !== id);
      saveSelfPRs(updated);
      return updated;
    });
  }


  async function sendToApi(bodyText: string, prText: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/reason', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: bodyText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError('AIの処理に失敗しました。時間をおいてもう一度お試しください。');
      } else {
        setResult(data.result);
        setFreshlyFetched(true);
        updateCurrentPR({ title, text: prText, latestResult: data.result });
      }
    } catch {
      setError('通信エラーが発生しました。インターネット接続を確認してください。');
    } finally {
      setLoading(false);
    }
  }

  function handleFirstSubmit() {
    if (loading) return;
    setResult('');
    setFollowupText('');
    updateCurrentPR({ title });
    sendToApi(text, text);
  }

  function handleFollowupSubmit() {
    if (loading) return;
    if (!followupText.trim()) {
      setError('追加情報を入力してください');
      return;
    }
    const combined = [
      `元の自己PR:\n${text}`,
      `前回の分析結果:\n${result}`,
      `追加回答:\n${followupText}`,
      `指示:\n前回の分析結果で出した質問への回答として、上記の追加回答を踏まえ、自己PRを改善してください。`,
    ].join('\n\n');
    sendToApi(combined, text);
  }

  // ── 一覧画面 ────────────────────────────────────────────────────
  if (!selectedId) {
    // ②「全文を自力で書く」経由（?mode=direct）では、mount 効果が openPR(newPR) を
    // 実行する直前の 1 フレームで一覧画面が映り込まないよう、URL を render 時に直読みして
    // 早期 return する。mount 効果完了後は router.replace('/self-pr') で query が落ちる
    // ため、この check は次の render から false に倒れる。daily limit 到達で openPR が
    // 走らなかった場合も replace で query が消えるので、graceful degradation として
    // 一覧画面の "+ 新規作成（本日の上限）" 表示にちゃんと着地する。
    //
    // typeof window guard で SSR では false を返す（hub からの client navigation 経路では
    // window が常に存在するため、Hub → ② の通常導線では確実に null が返って一覧が映らない）。
    if (modeParam === 'direct') {
      // editor を直接開くフローなので一覧は描画しない。ただし return null だと
      // 真っ白画面が一瞬見えてしまうため、placeholder を出して「準備中である」ことを
      // ユーザに伝える。modeDirect effect が openPR + router.replace を完了すると
      // modeParam が null に戻り、selectedId が立つことでこの分岐は抜けて editor view
      // が描画される。
      return (
        <main className="mx-auto max-w-3xl px-4 py-12">
          <p className="text-sm text-gray-500">
            自己PRを書く画面を準備しています...
          </p>
        </main>
      );
    }
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        {/* 上部ナビゲーション: 既存の「← まとめに戻る」と、自己分析の結果一覧への遷移を
            横並びにする。flex-wrap でスマホでも折り返して 2 段で収まる。
            一覧画面の上部に置くことで selfPRs.length に依らず常に visible になる
            （empty-state でも list でも同じヘッダ領域に出る）。*/}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={goBackToSelfAnalysisSummary}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
          >
            ← 自己分析の活動まとめに戻る
          </button>
          <Link
            href="/self-analysis/result"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
          >
            自己分析の結果を見る →
          </Link>
        </div>
        <div className="flex items-center justify-between mb-10">
          <h1 className="text-3xl font-bold text-gray-800">自己PR添削</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              今日あと{selfAnalysisLimit.getRemainingCount(usage)}回作成できます
            </span>
            <button
              type="button"
              onClick={createNewPR}
              disabled={!selfAnalysisLimit.canUse(usage)}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
            >
              {selfAnalysisLimit.canUse(usage) ? '+ 新規作成' : '+ 新規作成（本日の上限）'}
            </button>
          </div>
        </div>

        {selfPRs.length === 0 ? (
          // STEP-NAV-3: hub の②「書いた自己PRを添削する」着地経路を成立させるため、
          // empty-state を「直接自己PRを書く / 自己分析から始める」の 2 択に統一する。
          // hasSelfAnalysis は headline 文言の微差にだけ使う（経路は両方とも同じ 2 ボタン）。
          //   - 直接自己PRを書く: 既存 createNewPR() を流用（空 PR を 1 件作って自動 open）。
          //     daily limit は従来どおり selfAnalysisLimit.canUse で disable 連動。
          //   - 自己分析から始める: /self-analysis (hub) に戻して 4 カードから選び直す経路。
          // selfPRs[] の構造 / API / cache には何も触らない。
          <div className="text-center py-24">
            <p className="text-gray-400 text-base mb-3">
              {hasSelfAnalysis ? 'まだ自己PR添削はありません' : 'まだ自己PRはありません'}
            </p>
            <p className="text-gray-500 text-sm mb-8 leading-relaxed">
              本文をそのまま貼って添削するか、<br />
              自己分析から整理して書き始めるか選べます。
            </p>
            <div className="flex flex-col items-center gap-3 max-w-sm mx-auto">
              <button
                type="button"
                onClick={createNewPR}
                disabled={!selfAnalysisLimit.canUse(usage)}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
              >
                {selfAnalysisLimit.canUse(usage)
                  ? '直接自己PRを書く'
                  : '直接自己PRを書く（本日の上限）'}
              </button>
              <Link
                href="/self-analysis"
                className="w-full inline-block text-center border border-blue-300 text-blue-600 hover:bg-blue-50 font-semibold px-8 py-3 rounded-lg text-base transition-colors"
              >
                自己分析から始める →
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {selfPRs.map((pr) => (
              <div
                key={pr.id}
                className="relative bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm rounded-xl transition-all overflow-hidden"
              >
                {/* カード本体: クリックで自己PR添削フォームを開く */}
                <button
                  type="button"
                  onClick={() => openPR(pr)}
                  className="w-full text-left p-6 pr-16"
                >
                  {/* 上段：回数・日時・添削済みバッジ */}
                  <div className="flex items-center gap-3 mb-2">
                    <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-full shrink-0">
                      {pr.index}回目
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatDateTime(pr.createdAt ?? pr.updatedAt)} 作成
                    </span>
                    {pr.latestResult && (
                      <span className="text-xs text-green-600 font-medium ml-auto shrink-0">
                        添削済み
                      </span>
                    )}
                  </div>

                  {/* タイトル */}
                  <p className="text-sm font-semibold text-gray-700 mb-1">
                    {resolveTitle(pr)}
                  </p>

                  {/* 本文プレビュー */}
                  <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
                    {pr.text || '（本文未入力）'}
                  </p>
                </button>

                {/* 自己分析の深掘りへの導線 */}
                <div className="border-t border-gray-100 px-6 py-3">
                  <button
                    type="button"
                    onClick={goToSelfAnalysisAnswering}
                    className="text-sm font-semibold text-blue-600 hover:text-blue-800"
                  >
                    自己分析の深掘りを修正する →
                  </button>
                </div>

                {/* 削除ボタン */}
                <button
                  type="button"
                  onClick={() => deletePR(pr.id)}
                  className="absolute top-4 right-4 text-xs text-gray-300 hover:text-red-500 hover:bg-red-50 rounded px-2 py-1 transition-colors"
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        )}

      </div>
    );
  }

  // ── 編集画面 ────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      {/* ② mode=direct 経由の編集画面では、自己分析機能一覧 (/self-analysis hub) への
          戻り導線をヘッダ上に追加する。① fromRun の「← ステップ3に戻る」とは別経路。
          openedDirectMode=true のときだけ表示するので、① fromRun / 一覧経由 / 直接アクセスには影響しない。 */}
      {openedDirectMode && (
        <div className="mb-4">
          <Link
            href="/self-analysis"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
          >
            ← 自己分析機能一覧に戻る
          </Link>
        </div>
      )}
      {/* ヘッダの構成は来歴によって変える:
          - openedFromRun (①フロー着地): 「← ステップ3に戻る」ボタンを 1 件出す
          - openedDirectMode (②フロー着地): 機能名を「自己PR全文を書く」に切替、
              履歴感を出す "○回目" バッジと作成日を隠す、用途を伝える短い説明文を併記
          - 一覧カード経由 / 直接アクセス: 履歴的な「○回目 / 作成日」と従来 h1 を表示
          自己分析関連の戻り導線（「← 一覧に戻る」「自己分析の活動まとめに戻る」等）は
          編集画面では一切表示しない（① fromRun の「ステップ3に戻る」と ② openedDirectMode の
          「自己分析機能一覧に戻る」のみ例外）。
          selectedId / openPR / sendToApi 系には未接触。*/}
      <div className="mb-10">
        <div className="flex flex-wrap items-center gap-3">
          {openedFromRun && (
            <button
              type="button"
              onClick={goBackToSelfAnalysisSummary}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
            >
              ← ステップ3に戻る
            </button>
          )}
          {!openedDirectMode && (
            <>
              <span className="bg-blue-100 text-blue-700 text-sm font-bold px-3 py-1 rounded-full">
                {selectedPR?.index}回目
              </span>
              {selectedPR?.createdAt && (
                <span className="text-xs text-gray-400">
                  {formatDateTime(selectedPR.createdAt)} 作成
                </span>
              )}
            </>
          )}
          <h1 className="text-2xl font-bold text-gray-800">
            {openedDirectMode ? '自己PR全文を書く' : '自己PR添削'}
          </h1>
        </div>
        {openedDirectMode && (
          <p className="mt-2 text-sm text-slate-500 leading-relaxed">
            活動整理を使わずに、自分で自己PR本文を書いて添削できます。
          </p>
        )}
      </div>

      {/* タイトル入力 */}
      <section className="mb-6">
        <FormField
          label="タイトル"
          hint="任意。未入力の場合は本文の冒頭が表示されます。"
        >
          <Input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              updateCurrentPR({ title: e.target.value });
            }}
            placeholder="例：テニス部での経験・志望理由　など"
          />
        </FormField>
      </section>

      {/* 本文入力
          長文入力のため text-base / leading-relaxed / resize-y を維持したく、
          Textarea primitive（text-sm 既定）には寄せず raw <textarea> のままにする。
          FormField で label / hint の構造だけ統一する。 */}
      <section className="mb-8">
        <FormField
          label="本文"
          hint="200〜400字程度でOK。完璧でなくて大丈夫です。あとで AI が整理します。"
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            className="w-full border border-slate-300 rounded-lg px-4 py-3 text-base leading-relaxed bg-white text-slate-900 placeholder:text-slate-400 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-400 dark:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
            placeholder={`例：\n私は3年間、テニス部で副部長を務めました。\n最初は練習への参加率が低く、チームの雰囲気が課題でした。\nそこで私は〇〇という工夫を行い、その結果〇〇が改善されました。\nこの経験から〇〇を学びました。`}
          />
        </FormField>
        <button
          type="button"
          onClick={handleFirstSubmit}
          disabled={loading}
          className="mt-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
        >
          {loading ? '送信中...' : selectedPR?.latestResult ? '再添削する' : '添削する'}
        </button>
      </section>

      {error && <p className="text-red-600 text-sm mb-6">{error}</p>}

      {/* 保存済み result を表示中に textarea を編集したとき、画面上の result は
          旧本文に対する評価のまま。再添削で最新評価が取れることを inline で促す。
          freshlyFetched=false（保存済み result 表示中）かつ text が selectedPR.text と
          乖離したときだけ出すので、新規添削直後 / 再添削直後の正常 UX には現れない。
          ②（mode=direct）経路では UI を最小化する方針のため非表示。*/}
      {result && !freshlyFetched && text !== selectedPR?.text && !openedDirectMode && (
        <p className="text-xs text-amber-600 mb-2">
          本文を編集しました。「再添削する」を押すと最新の評価を確認できます。
        </p>
      )}

      {/* 添削結果 */}
      {result && (
        <section className="mb-8 bg-gray-50 border border-gray-200 rounded-xl p-6">
          <h2 className="text-lg font-bold text-gray-700 mb-4 pb-2 border-b border-gray-200">
            添削結果
          </h2>
          <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_hr]:my-4 [&_strong]:font-semibold [&_p]:my-2">
            <ReactMarkdown>{result}</ReactMarkdown>
          </div>
        </section>
      )}

      {/* 追加回答入力
          freshlyFetched が true のとき（= 今セッションで /api/reason から返ってきた
          result を表示しているとき）にだけ出す。openPR で過去 PR の latestResult を
          hydrate した経路では false に倒れるため、保存済み result に followup を
          被せて combined prompt で再課金する事故を構造的に防ぐ。
          ②（mode=direct）経路では UI を最小化する方針のため非表示。タイトル / 本文 /
          添削する / 添削結果 だけで完結させる。*/}
      {result && freshlyFetched && !openedDirectMode && (
        <section className="border border-blue-300 rounded-xl overflow-hidden">
          <div className="bg-blue-600 px-6 py-4">
            <h2 className="text-base font-bold text-white">
              上の質問への回答を入力してください
            </h2>
            <p className="text-blue-100 text-sm mt-1">
              番号だけでもOK・短文でもOK。分かる範囲で答えてください。
            </p>
          </div>
          <div className="bg-white px-6 py-5">
            <textarea
              value={followupText}
              onChange={(e) => setFollowupText(e.target.value)}
              rows={8}
              className="w-full border border-slate-300 rounded-lg px-4 py-3 text-base leading-relaxed bg-white text-slate-900 placeholder:text-slate-400 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-400 dark:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
              placeholder="例: ① 自分から声かけを増やした　② 週1でミーティングを提案した　③ 最終的に全員が発言できる雰囲気になった"
            />
            <button
              type="button"
              onClick={handleFollowupSubmit}
              disabled={loading}
              className="mt-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
            >
              {loading ? '送信中...' : '回答して改善案を見る'}
            </button>
          </div>
        </section>
      )}

      {/* 完了してホームに戻る CTA も ②（mode=direct）経路では UI 簡略化のため非表示。
          直接添削 intent ではブラウザ back / 別経路で離脱する想定。*/}
      {result && freshlyFetched && !openedDirectMode && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => router.push('/home')}
            className="w-full rounded-lg bg-green-600 px-6 py-3 text-white font-bold hover:bg-green-700 transition-colors"
          >
            完了してホームに戻る →
          </button>
        </div>
      )}

    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SelfPrPageInner />
    </Suspense>
  );
}
