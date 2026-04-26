'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import type { SelfPR } from '@/types/selfPR';
import { loadSelfPRs, saveSelfPRs } from '@/lib/selfPRStorage';
import { loadSelfPRDraft, clearSelfPRDraft } from '@/lib/selfPRDraftStorage';
import { selfAnalysisLimit, type DailyUsage } from '@/lib/dailyLimit';
import { collectAndSaveMatchingInput } from '@/lib/admissionMatchingStorage';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [followupText, setFollowupText] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const stored = loadSelfPRs();
      const currentUsage = selfAnalysisLimit.loadUsage();
      const draft = loadSelfPRDraft();

      if (draft) {
        clearSelfPRDraft();
        const now = new Date().toISOString();
        const newPR: SelfPR = {
          id: crypto.randomUUID(),
          index: stored.length + 1,
          title: '',
          text: draft,
          latestResult: '',
          createdAt: now,
          updatedAt: now,
        };
        const updated = [...stored, newPR];
        saveSelfPRs(updated);
        setSelfPRs(updated);
        setUsage(currentUsage);
        openPR(newPR);
      } else {
        setSelfPRs(stored);
        setUsage(currentUsage);
      }
    } catch (e) {
      console.error('selfPR: load failed', e);
      setError('読み込みに失敗しました。もう一度お試しください。');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPR = selfPRs.find((pr) => pr.id === selectedId) ?? null;

  function updateCurrentPR(patch: Partial<SelfPR>) {
    setSelfPRs((prev) => {
      const updated = prev.map((pr) =>
        pr.id === selectedId
          ? { ...pr, ...patch, updatedAt: new Date().toISOString() }
          : pr,
      );
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
    setResult(pr.latestResult);
    setFollowupText('');
    setError('');
  }

  function backToList() {
    setSelectedId(null);
    setError('');
  }

  function deletePR(id: string) {
    if (!window.confirm('この自己PR添削履歴を削除しますか？\nこの操作は元に戻せません。')) return;
    setSelfPRs((prev) => {
      const updated = prev.filter((pr) => pr.id !== id);
      saveSelfPRs(updated);
      return updated;
    });
  }

  function handleGoToMatching() {
    collectAndSaveMatchingInput();
    router.push('/matching');
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
          <div className="text-center py-24">
            <p className="text-gray-400 text-base mb-6">まだ自己分析が作成されていません</p>
            <button
              type="button"
              onClick={createNewPR}
              disabled={!selfAnalysisLimit.canUse(usage)}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
            >
              最初の自己分析を作成する
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {selfPRs.map((pr) => (
              <div
                key={pr.id}
                className="relative bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm rounded-xl transition-all"
              >
                {/* カード本体（クリックで開く） */}
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

        {/* 次のステップ：AI志望校マッチング */}
        <div className="mt-10 p-5 bg-green-50 border border-green-200 rounded-xl flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-green-800 mb-1">次のステップ</p>
            <p className="text-xs text-green-700">
              自己分析が完了したら、AI志望校マッチングで相性の良い大学を確認しましょう。
            </p>
          </div>
          <button
            type="button"
            onClick={handleGoToMatching}
            className="shrink-0 bg-green-600 hover:bg-green-700 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
          >
            AI志望校マッチングへ進む →
          </button>
        </div>
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
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          タイトル
          <span className="text-gray-400 font-normal ml-2">（任意・未入力の場合は本文冒頭が表示されます）</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            updateCurrentPR({ title: e.target.value });
          }}
          className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-400 dark:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="例：テニス部での経験・志望理由　など"
        />
      </section>

      {/* 本文入力 */}
      <section className="mb-8">
        <label className="block text-base font-semibold text-gray-700 mb-2">
          本文
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          className="w-full border border-slate-300 rounded-lg px-4 py-3 text-base leading-relaxed bg-white text-slate-900 placeholder:text-slate-400 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-400 dark:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
          placeholder={`例：\n私は3年間、テニス部で副部長を務めました。\n最初は練習への参加率が低く、チームの雰囲気が課題でした。\nそこで私は〇〇という工夫を行い、その結果〇〇が改善されました。\nこの経験から〇〇を学びました。\n（200〜400字程度でOK）`}
        />
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

      {/* 次のステップ：AI志望校マッチング */}
      <div className="mt-10 p-5 bg-green-50 border border-green-200 rounded-xl flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-green-800 mb-1">次のステップ</p>
          <p className="text-xs text-green-700">
            自己分析が完了したら、AI志望校マッチングで相性の良い大学を確認しましょう。
          </p>
        </div>
        <button
          type="button"
          onClick={handleGoToMatching}
          className="shrink-0 bg-green-600 hover:bg-green-700 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
        >
          AI志望校マッチングへ進む →
        </button>
      </div>
    </div>
  );
}
