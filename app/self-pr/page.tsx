'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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

export default function Page() {
  const router = useRouter();
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const stored = loadSelfPRs();
      const currentUsage = selfAnalysisLimit.loadUsage();
      const analyzeState = loadAnalyzeState();
      const legacyDraft = loadSelfPRDraft();
      // analyzeState.summary が非 null なら自己分析が完了済み（empty-state の文言分岐に使う）。
      // 旧 selfPR_draft writer 撤去後、ここでは「自己分析の有無」を analyzeState で直接判定する。
      setHasSelfAnalysis(!!analyzeState?.summary);

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
      if (legacyDraft) {
        // legacy drain: 旧 raw string storage を消費して 1 件目 PR にする。
        // writer は廃止済みのため、stale data の自然な吐き出し経路として 1 度きり走る。
        clearSelfPRDraft();
        prefillText = legacyDraft;
        openAfterCreate = true;
      } else {
        // 現在の canonical 入力 hash に対応する PR が無ければ新規追加する。
        //   - stored 空: 初回。1 件目を seed で作って auto-open（従来 UX 維持）
        //   - stored あり: 自己分析 summary が更新された（STEP3 等）→ 新規 2 件目を追加。
        //     auto-open しない: user に一覧で新規カードを視認させる。
        // user 編集後も seedInputHash は保持する（updateCurrentPR 参照）ため、
        // 同じ seed の重複作成は防げる。
        //
        // PR10c (H1): legacy user の selfPRs に seedInputHash 未設定の record が
        //   ある状態でも、自動 seed 追加は **同一 currentSeedInputHash で 1 度だけ** 走る。
        //   理由: 追加直後の new PR は `seedInputHash: currentSeedInputHash` を持つため
        //   (L165 参照)、次回 mount で `stored.some(pr => pr.seedInputHash === currentSeedInputHash)`
        //   が true になり、重複追加経路に入らない。currentSeedInputHash が変わるのは
        //   profile.sourceHash か analyzeState.summary が変化したときのみ（STEP3 等の
        //   意図的な再生成）であり、その場合は「新規 2 件目」が意図動作。よって
        //   無限増殖は構造的に発生しない。legacy record（hash 未設定）は dedup 対象外で
        //   保護されるため、user 編集済みカードは触らない。
        const hasCurrentSeed = stored.some((pr) => pr.seedInputHash === currentSeedInputHash);
        if (!hasCurrentSeed) {
          const seed = buildSelfPRDraftSeed({
            profile,
            analyzeSummary: analyzeState?.summary ?? null,
          });
          if (seed) {
            prefillText = seed;
            openAfterCreate = stored.length === 0;
          }
        }
      }

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
        if (openAfterCreate) openPR(newPR);
      } else {
        setSelfPRs(stored);
        setUsage(currentUsage);
      }
    } catch (e) {
      console.error('selfPR: load failed', e);
      setError('読み込みに失敗しました。もう一度お試しください。');
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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
    setResult('');
    setFollowupText('');
    setError('');
  }

  function backToList() {
    setSelectedId(null);
    setError('');
  }

  // 上部「← 自己分析の活動まとめに戻る」→ ③活動まとめ(summary)へ戻る
  function goBackToSelfAnalysisSummary() {
    const savedState = loadAnalyzeState();
    if (!savedState) {
      router.push('/self-analysis');
      return;
    }
    saveAnalyzeState({ ...savedState, step: 'summary' });
    router.push('/self-analysis');
  }

  // カード「自己分析の深掘りを修正する →」→ ②深掘り回答(answering)へ戻る
  function goToSelfAnalysisAnswering() {
    const savedState = loadAnalyzeState();
    if (!savedState) {
      router.push('/self-analysis');
      return;
    }
    saveAnalyzeState({ ...savedState, step: 'answering' });
    router.push('/self-analysis');
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
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="mb-4">
          <button
            type="button"
            onClick={goBackToSelfAnalysisSummary}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
          >
            ← 自己分析の活動まとめに戻る
          </button>
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
          hasSelfAnalysis ? (
            // 自己分析は完了しているが selfPRs が空のケース。
            // 通常は mount effect で seed/legacy drain により 1 件 auto-create されるため
            // 到達経路はレア（profile も summary も legacy draft も全て空 = 手動でストレージを
            // 消した直後など）。ここでは従来通りの「新規作成」ボタンを残す。
            <div className="text-center py-24">
              <p className="text-gray-400 text-base mb-6">まだ自己PR添削はありません</p>
              <button
                type="button"
                onClick={createNewPR}
                disabled={!selfAnalysisLimit.canUse(usage)}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
              >
                最初の自己PR添削を作成する
              </button>
            </div>
          ) : (
            // 自己分析が未完了のケース。
            // 旧 UI ではボタンが createNewPR を呼んで空 PR を作っており、ラベル
            //（「最初の自己分析を作成する」）と挙動が乖離していた CTA dead-end。
            // /self-analysis へ遷移する Link に置換し、自己分析を完了させてから戻ると
            // mount effect の seed 派生で自動的にたたき台が用意されることを案内する。
            <div className="text-center py-24">
              <p className="text-gray-400 text-base mb-3">まだ自己分析が作成されていません</p>
              <p className="text-gray-500 text-sm mb-6 leading-relaxed">
                自己分析を完了させると、整理メモから<br />
                自己PRのたたき台が自動で用意されます。
              </p>
              <Link
                href="/self-analysis"
                className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
              >
                自己分析を始める →
              </Link>
            </div>
          )
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
      <div className="flex items-center gap-3 mb-10">
        <button
          type="button"
          onClick={backToList}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors"
        >
          ← 一覧に戻る
        </button>
        <span className="bg-blue-100 text-blue-700 text-sm font-bold px-3 py-1 rounded-full">
          {selectedPR?.index}回目
        </span>
        {selectedPR?.createdAt && (
          <span className="text-xs text-gray-400">
            {formatDateTime(selectedPR.createdAt)} 作成
          </span>
        )}
        <h1 className="text-2xl font-bold text-gray-800">自己PR添削</h1>
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
          {loading ? '送信中...' : '添削する'}
        </button>
      </section>

      {error && <p className="text-red-600 text-sm mb-6">{error}</p>}

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

      {/* 追加回答入力 */}
      {result && (
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

      {result && (
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
