'use client';

import { useState, useEffect } from 'react';
import type { BasicInfo as UserBasicInfo } from '@/types/basicInfo';
import type { BasicInfo, MatchingResult } from '@/types/matching';
import type { WallHittingResult } from '@/types/analysis';
import type { ActivityData } from '@/types/activity';
import type { SelfPR } from '@/types/selfPR';
import type { AiMatchAdvice } from '@/app/api/matching/route';
import Link from 'next/link';
import { buildMatchingResults } from '@/lib/matching/suggestUniversities';
import { collectAndSaveMatchingInput, getMissingItems, markMatchingCompleted } from '@/lib/admissionMatchingStorage';
import { loadActivityData } from '@/lib/activityStorage';
import { loadSelfPRs } from '@/lib/selfPRStorage';
import { deriveStudentAnalysis } from '@/lib/matching/deriveStudentAnalysis';
import { buildUniversityContextsFromBasicInfo } from '@/lib/matching/buildUniversityContextsFromBasicInfo';
import type { MatchingInput } from '@/types/matchingInput';
import BasicInfoSummary from '@/components/shared/BasicInfoSummary';
import {
  AiThinkingState,
  StrengthWeaknessGrid,
  ImprovementList,
} from '@/components/shared/result';

// ── キャッシュキー ───────────────────────────────────────────────

const CACHE_KEY = 'matchingResult';
const CACHE_TS_KEY = 'matchingTimestamp';

type CachedResult = {
  results: MatchingResult[];
  aiAdvices: AiMatchAdvice[];
  matchingLevel: 'basic' | 'full';
};

// ── 変換ヘルパー ─────────────────────────────────────────────────

function toBasicInfo(formData: UserBasicInfo): BasicInfo {
  return {
    name: formData.name,
    highSchool: '',
    grade: formData.grade,
    academicType: formData.track === '理系' ? '理系' : '文系',
    choices: formData.preferences
      .filter((p) => p.university.trim() !== '')
      .map((p) => ({ university: p.university, faculty: p.faculty })),
  };
}

// ── ページ本体 ───────────────────────────────────────────────────

export default function AdmissionMatchingPage() {
  const [hasRunMatching, setHasRunMatching] = useState(false);
  const [matchingLevel, setMatchingLevel] = useState<'basic' | 'full' | null>(null);
  const [basicFormData, setBasicFormData] = useState<UserBasicInfo | null>(null);
  const [activityData, setActivityData] = useState<ActivityData | null>(null);
  const [selfPRs, setSelfPRs] = useState<SelfPR[]>([]);
  const [wallHitting, setWallHitting] = useState<WallHittingResult | null>(null);
  const [results, setResults] = useState<MatchingResult[]>([]);
  const [aiAdvices, setAiAdvices] = useState<AiMatchAdvice[]>([]);
  const [missingItems, setMissingItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [hasCachedResult, setHasCachedResult] = useState(false);
  const [cachedTimestamp, setCachedTimestamp] = useState<string | null>(null);

  useEffect(() => {
    // 常に最新の localStorage から全データを収集してスナップショットを作る
    const matchingInput = collectAndSaveMatchingInput();

    console.log("=== MATCHING INPUT DATA ===");
    console.log({
      savedAt: matchingInput.savedAt,
      basicInfo: matchingInput.basicInfo,
      activityData: matchingInput.activityData,
      selfPRs_count: matchingInput.selfPRs.length,
      selfPRs: matchingInput.selfPRs,
      wallHittingResult: matchingInput.wallHittingResult,
    });

    if (!matchingInput.basicInfo)           console.warn("MISSING: basicInfo（基本情報が未入力）");
    if (!matchingInput.activityData)        console.warn("MISSING: activityData（活動整理が未入力）");
    if (matchingInput.selfPRs.length === 0) console.warn("MISSING: selfPRs（自己分析添削が未入力）");
    if (!matchingInput.wallHittingResult)   console.warn("MISSING: wallHittingResult（AI壁打ちが未実施）");

    if (matchingInput.basicInfo) {
      setBasicFormData(matchingInput.basicInfo);
      setActivityData(matchingInput.activityData);
      setSelfPRs(matchingInput.selfPRs);
      setWallHitting(matchingInput.wallHittingResult ?? null);
      const basicInfo = toBasicInfo(matchingInput.basicInfo);
      const analysis = deriveStudentAnalysis(
        matchingInput.basicInfo,
        matchingInput.activityData,
        matchingInput.selfPRs,
        matchingInput.wallHittingResult,
      );
      console.log("=== DERIVED ANALYSIS ===", analysis);
      const computedResults = buildMatchingResults(basicInfo, analysis);
      setResults(computedResults);
      setMissingItems(getMissingItems(matchingInput));
    }

    // キャッシュ済み結果があれば「以前の診断結果を見る」ボタンを有効化
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        setHasCachedResult(true);
        const ts = localStorage.getItem(CACHE_TS_KEY);
        if (ts) setCachedTimestamp(ts);
      }
    } catch {}

    setLoading(false);
  }, []);

  // API呼び出しのみ担当。失敗時は throw して呼び出し元に伝える。取得した advices を返す
  async function handleAiEnhance(): Promise<AiMatchAdvice[]> {
    if (!wallHitting || results.length === 0) return [];

    // ── MatchingInput を組み立てる ───────────────────────────────
    // 設計意図: 文章生成層 (/api/matching) への入力契約を MatchingInput 型で表現する。
    //   将来 大学DB 接続後は universityContexts を enrich してから送る、または
    //   API 側の TODO 箇所で enrich 処理を挟む。
    const matchingInput: MatchingInput = {
      basicInfo: basicFormData,
      activityData,
      selfAnalysis: wallHitting,
      universityContexts: buildUniversityContextsFromBasicInfo(basicFormData),
    };

    console.log("=== MATCHING FINAL INPUT ===", {
      ...matchingInput,
      // selfPRs は MatchingInput 型には含めないが、デバッグ目的でログには出す（既存挙動維持）
      selfPRs: loadSelfPRs(),
    });

    const res = await fetch('/api/matching', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // results はスコアリング層 (lib/matching/*) からの deterministic な出力。
      // wallHitting は selfAnalysis のエイリアスとして併記（API 側で両方受ける）。
      body: JSON.stringify({
        results,
        basicInfo: matchingInput.basicInfo,
        activityData: matchingInput.activityData,
        selfAnalysis: matchingInput.selfAnalysis,
        wallHitting: matchingInput.selfAnalysis,
        universityContexts: matchingInput.universityContexts,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail ?? 'AI強化に失敗しました');
    }
    const advices = data.advices as AiMatchAdvice[];
    setAiAdvices(advices);
    return advices;
  }

  // 成功時のみ結果ページへ遷移するフロー制御
  const handleStartMatching = async () => {
    // 診断レベルはAPIの成否に依存しない。入力データの時点で確定させる
    const input = collectAndSaveMatchingInput();
    const level = input.wallHittingResult ? 'full' : 'basic';
    setMatchingLevel(level);
    setAiLoading(true);

    try {
      const advices = await handleAiEnhance();
      // キャッシュ保存（API成功時のみ）
      try {
        const ts = new Date().toISOString();
        const cache: CachedResult = { results, aiAdvices: advices, matchingLevel: level };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        localStorage.setItem(CACHE_TS_KEY, ts);
        setHasCachedResult(true);
        setCachedTimestamp(null); // live結果なので表示タイムスタンプはクリア
      } catch {}
      markMatchingCompleted();
      setHasRunMatching(true);
    } catch (error) {
      console.error(error);
      alert('マッチングに失敗しました。もう一度お試しください。');
    } finally {
      setAiLoading(false);
    }
  };

  function handleShowCached() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      const ts  = localStorage.getItem(CACHE_TS_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as CachedResult;
      setResults(cached.results);
      setAiAdvices(cached.aiAdvices);
      setMatchingLevel(cached.matchingLevel);
      setCachedTimestamp(ts);
      setHasRunMatching(true);
    } catch {
      alert('保存済みの結果を読み込めませんでした。');
    }
  }

  function handleReset() {
    setHasRunMatching(false);
    setMatchingLevel(null);
    setAiAdvices([]);
    setAiError('');
    // 確認ページに戻った後もキャッシュ日時を表示するため localStorage から再読み込み
    try {
      const ts = localStorage.getItem(CACHE_TS_KEY);
      setCachedTimestamp(ts);
    } catch {
      setCachedTimestamp(null);
    }
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

  // ── 確認ページ ───────────────────────────────────────────────────

  if (!hasRunMatching) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">AI志望校マッチング</h1>
        <p className="text-sm text-gray-500 mb-8">
          以下の入力情報をもとに診断します。内容を確認してから診断を開始してください。
        </p>

        {/* 不足データ警告 */}
        {missingItems.length > 0 && (
          <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-yellow-800 mb-2">
              以下のデータが未入力のため、マッチング精度が下がっています
            </p>
            <ul className="space-y-1 mb-3">
              {missingItems.map((item) => (
                <li key={item} className="text-sm text-yellow-700 flex items-center gap-2 flex-wrap">
                  <span>⚠</span>
                  <span>{item}が未入力です</span>
                  {item === '基本情報' && (
                    <a href="/input/basic" className="text-blue-600 underline">入力する →</a>
                  )}
                  {item === '活動整理' && (
                    <a href="/input/activity" className="text-blue-600 underline">入力する →</a>
                  )}
                  {item === '自己分析添削' && (
                    <Link href="/self-pr" className="text-blue-600 underline">入力する →</Link>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-yellow-700">💡 入力するとマッチング精度が上がります</p>
          </div>
        )}

        {/* 基本情報 */}
        <BasicInfoSummary basicInfo={basicFormData} editHref="/input/basic" />

        {/* 活動整理 */}
        <section className="mb-5 bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide">活動整理</h2>
            <a href="/input/activity" className="text-xs text-blue-600 hover:underline">編集する</a>
          </div>
          {activityData ? (
            <ActivitySummary activityData={activityData} />
          ) : (
            <p className="text-sm text-yellow-600">⚠ 活動整理が未入力です</p>
          )}
        </section>

        {/* 自己分析 */}
        <section className="mb-8 bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">自己分析</h2>
          {wallHitting ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-700 leading-relaxed">{wallHitting.summary}</p>
              <StrengthWeaknessGrid
                strengths={wallHitting.strengths}
                weaknesses={wallHitting.weaknesses}
                maxItems={3}
              />
            </div>
          ) : selfPRs.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 mb-2">自己PR添削履歴</p>
              {selfPRs.slice(0, 2).map((pr, i) => (
                <div key={i} className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
                  {pr.title || pr.text.slice(0, 30) + '…'}
                </div>
              ))}
              <p className="text-xs text-orange-600 mt-2">
                ⚠ AI壁打ちが未実施です。自己分析を行うとマッチング精度が上がります。
              </p>
            </div>
          ) : (
            <p className="text-sm text-yellow-600">⚠ 自己分析が未実施です</p>
          )}
        </section>

        {/* 診断ボタン */}
        <button
          type="button"
          onClick={handleStartMatching}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-4 rounded-xl text-base transition-colors"
        >
          志望校マッチングをする
        </button>
        {!wallHitting && (
          <p className="text-xs text-gray-400 text-center mt-2">
            ※ AI壁打ちが未実施のため、基本スコアのみでのマッチングになります
          </p>
        )}
        {hasCachedResult && (
          <div className="mt-3">
            <button
              type="button"
              onClick={handleShowCached}
              className="w-full border border-gray-300 hover:bg-gray-50 text-gray-600 font-medium px-6 py-3 rounded-xl text-sm transition-colors"
            >
              以前の診断結果を見る
            </button>
            {cachedTimestamp && (
              <p className="text-xs text-gray-400 text-center mt-1">
                前回診断：{new Date(cachedTimestamp).toLocaleString('ja-JP', {
                  year: 'numeric', month: 'numeric', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </p>
            )}
            <p className="text-xs text-gray-400 text-center mt-0.5">
              ※再計算せず、前回保存した結果を表示します
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── 結果ページ ───────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800">AI志望校マッチング</h1>
        <button
          type="button"
          onClick={handleReset}
          className="text-sm text-blue-600 hover:underline shrink-0"
        >
          もう一度診断する
        </button>
      </div>

      {/* キャッシュ表示インジケーター */}
      {cachedTimestamp && (
        <div className="mb-6 flex items-center gap-2 text-xs text-gray-400">
          <span>🕐</span>
          <span>
            保存済みの診断結果を表示しています（
            {new Date(cachedTimestamp).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            ）
          </span>
          <button type="button" onClick={handleStartMatching} className="text-blue-500 hover:underline ml-1">
            再診断する
          </button>
        </div>
      )}

      {/* 診断レベルバナー */}
      {matchingLevel === 'basic' && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-yellow-800 mb-1">🟡 簡易診断結果</p>
          <p className="text-sm text-yellow-700 leading-relaxed mb-3">
            自己分析のAI深掘りが未実施のため、基本情報・活動整理・自己分析の入力内容をもとにした簡易診断です。AI深掘りを行うと、志望理由との一貫性や改善アクションの精度が上がります。
          </p>
          <a
            href="/self-analysis"
            className="inline-block text-xs font-semibold text-yellow-800 border border-yellow-400 hover:bg-yellow-100 px-4 py-2 rounded-lg transition-colors"
          >
            自己分析を深掘りする →
          </a>
        </div>
      )}
      {matchingLevel === 'full' && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <span className="text-sm font-semibold text-green-700">🟢 本格診断結果</span>
          <span className="text-sm text-green-600">基本情報・活動整理・自己分析・AI深掘り結果をもとに診断しています。</span>
        </div>
      )}

      {/* エラー */}
      {aiError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-700">{aiError}</p>
        </div>
      )}

      {/* AI壁打ち結果サマリー */}
      {wallHitting && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-5">
          <p className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-2">AI分析に基づくマッチング</p>
          <p className="text-sm text-blue-900 leading-relaxed mb-3">{wallHitting.summary}</p>
          {/* 結果画面では弱みは 2 件まで（confirm 画面は 3 件）に絞っている。
              StrengthWeaknessGrid は同じ maxItems を強み・弱みに適用するため
              wallHitting の strengths/weaknesses を呼び出し側で個別 slice する。 */}
          <StrengthWeaknessGrid
            strengths={wallHitting.strengths.slice(0, 3)}
            weaknesses={wallHitting.weaknesses.slice(0, 2)}
          />
        </div>
      )}

      {/* マッチング結果 */}
      <section>
        <h2 className="text-base font-bold text-gray-800 mb-4">マッチング結果</h2>
        {results.length === 0 ? (
          <p className="text-gray-400 text-sm">
            マッチする大学が見つかりませんでした。志望校を入力すると結果が表示されます。
          </p>
        ) : (
          <div className="space-y-4">
            {results.map((result, i) => {
              const aiAdvice = aiAdvices.find((a) => a.universityId === result.university.id);
              return (
                <MatchingCard
                  key={i}
                  result={result}
                  aiAdvice={aiAdvice ?? null}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* 下部ボタン */}
      <div className="mt-8 pt-6 border-t border-gray-100">
        <button
          type="button"
          onClick={handleReset}
          className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl text-sm transition-colors"
        >
          入力情報を確認する / もう一度診断する
        </button>
      </div>
    </div>
  );
}

// ── 活動整理サマリー ──────────────────────────────────────────────

function ActivitySummary({ activityData }: { activityData: ActivityData }) {
  const rows: { label: string; items: string[] }[] = [];

  if (activityData.clubActivities.length > 0)
    rows.push({ label: '部活', items: activityData.clubActivities.map((a) => a.clubName) });
  if (activityData.volunteerActivities.length > 0)
    rows.push({ label: 'ボランティア', items: activityData.volunteerActivities.map((a) => a.activityContent) });
  if (activityData.studyAbroadActivities.length > 0)
    rows.push({ label: '留学', items: activityData.studyAbroadActivities.map((a) => a.destination) });
  if (activityData.researchActivities.length > 0)
    rows.push({ label: '探究', items: activityData.researchActivities.map((a) => a.theme) });
  if (activityData.partTimeJobActivities.length > 0)
    rows.push({ label: 'アルバイト', items: activityData.partTimeJobActivities.map((a) => a.industry) });
  if (activityData.certificationActivities.length > 0)
    rows.push({
      label: '資格',
      items: activityData.certificationActivities.map((a) =>
        a.level ? `${a.certificationName} ${a.level}` : a.certificationName,
      ),
    });
  if (activityData.contestActivities.length > 0)
    rows.push({ label: 'コンテスト', items: activityData.contestActivities.map((a) => a.contestName) });
  if (activityData.readingActivities.length > 0)
    rows.push({ label: '読書', items: activityData.readingActivities.map((a) => a.favoriteBook) });
  if (activityData.hobbyActivities.length > 0)
    rows.push({ label: '趣味', items: activityData.hobbyActivities.map((a) => a.hobbyContent) });

  if (rows.length === 0) {
    return <p className="text-sm text-yellow-600">⚠ 活動が登録されていません</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map(({ label, items }) => (
        <div key={label} className="flex gap-2 text-sm">
          <span className="shrink-0 text-gray-400 w-24">{label}</span>
          <span className="text-gray-700">{items.join('・')}</span>
        </div>
      ))}
    </div>
  );
}

// ── マッチングカード：評価サマリー導出 ───────────────────────────

function getScoreSubLabel(score: number): string {
  if (score >= 80) return '相性：高い';
  if (score >= 70) return '相性：やや高め';
  if (score >= 60) return '相性：中';
  if (score >= 50) return '相性：やや低め';
  return '相性：低い';
}

function getAffinityLabel(score: number): string {
  if (score >= 80) return '高い';
  if (score >= 60) return '中';
  return '低い';
}

function getAcceptanceLabel(score: number): string {
  if (score >= 80) return '高';
  if (score >= 60) return '中';
  return '低';
}

function getSummaryComment(score: number, weaknesses: string[]): string {
  const top = weaknesses[0];
  if (score >= 80) return '現状でも十分戦える。さらに磨くと盤石になる。';
  if (score >= 70) return top ? `あと一歩の強化で合格圏へ。特に「${top}」に集中しよう。` : 'あと一歩の強化で合格圏に入れる。';
  if (score >= 60) return top ? `可能性はある。「${top}」を強化すれば合格確度が上がる。` : '現状でも可能性はある。重点強化で確度が上がる。';
  if (score >= 50) return '準備を重ねれば逆転の可能性がある。今すぐ動き出そう。';
  return '今から集中的に取り組めば差を縮められる。焦らず着実に進めよう。';
}

// ── マッチングカード ──────────────────────────────────────────────

function MatchingCard({
  result,
  aiAdvice,
}: {
  result: MatchingResult;
  aiAdvice: AiMatchAdvice | null;
}) {
  const [open, setOpen] = useState(false);

  const reason     = aiAdvice?.reason        ?? result.reason;
  const strengths  = aiAdvice?.strengthPoints ?? result.strengthPoints;
  const weaknesses = aiAdvice?.weaknesses    ?? result.weaknesses;
  const actions    = aiAdvice?.actionItems   ?? result.actionItems;

  const { score, suggestionType } = result;
  const isMyChoice = suggestionType === '自分の志望校';

  const scoreColor   = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-blue-600' : 'text-orange-500';
  const levelColor   = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-blue-600' : 'text-orange-500';
  const tagColor     = isMyChoice                      ? 'bg-purple-100 text-purple-700'
                     : suggestionType === 'ストレートマッチ' ? 'bg-blue-100 text-blue-700'
                     : 'bg-green-100 text-green-700';
  const cardBorder   = isMyChoice
    ? 'bg-white border-2 border-purple-200 rounded-xl overflow-hidden'
    : 'bg-white border border-gray-200 rounded-xl overflow-hidden';

  return (
    <div className={cardBorder}>
      {/* ヘッダー（常に表示） */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-5 flex items-start justify-between gap-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tagColor}`}>
              {suggestionType}
            </span>
            {aiAdvice && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-200">
                AI強化済み
              </span>
            )}
          </div>
          <p className="font-bold text-gray-800">{result.university.name}</p>
          <p className="text-sm text-gray-500">{result.university.faculty}　{result.university.admissionType}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-2xl font-bold ${scoreColor}`}>
            {score}
            <span className="text-sm font-normal text-gray-400">点</span>
          </p>
          <p className={`text-xs font-medium mt-0.5 ${levelColor}`}>{getScoreSubLabel(score)}</p>
          <p className="text-xs text-gray-400 mt-1">{open ? '▲ 閉じる' : '▼ 詳細'}</p>
        </div>
      </button>

      {/* 詳細（展開時） */}
      {open && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">

          {/* 評価サマリー */}
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-center gap-4 mb-2">
              <div className="text-sm">
                <span className="text-xs text-gray-500">相性　</span>
                <span className={`font-bold ${levelColor}`}>{getAffinityLabel(score)}</span>
              </div>
              <div className="w-px h-4 bg-gray-300" />
              <div className="text-sm">
                <span className="text-xs text-gray-500">合格可能性　</span>
                <span className={`font-bold ${levelColor}`}>{getAcceptanceLabel(score)}</span>
              </div>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              {getSummaryComment(score, weaknesses)}
            </p>
          </div>

          {/* マッチ理由 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">マッチ理由</p>
            <p className="text-sm text-gray-700 leading-relaxed">{reason}</p>
          </div>

          {/* スコア内訳 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2">スコア内訳</p>
            <div className="space-y-1.5">
              {result.scoreBreakdown.items.map((item, j) => (
                <div key={j} className="flex items-center gap-2 text-xs">
                  <span className="w-28 text-gray-500 shrink-0">{item.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${item.studentScore >= item.required ? 'bg-blue-400' : 'bg-orange-300'}`}
                      style={{ width: `${Math.min(100, (item.contribution / 35) * 100)}%` }}
                    />
                  </div>
                  <span className={`shrink-0 font-semibold ${item.studentScore >= item.required ? 'text-blue-600' : 'text-orange-500'}`}>
                    {item.studentScore}/{item.required}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 合っている点 */}
          {strengths.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">合っている点</p>
              <ImprovementList items={strengths} variant="success" />
            </div>
          )}

          {/* 課題（優先順位付き）：先頭は専用の「⚠ 最優先」ハイライト箱、
              2 件目以降は ImprovementList(variant=warning) でリスト化。 */}
          {weaknesses.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">課題</p>
              <div className="space-y-1.5">
                <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                  <span className="text-xs font-bold text-orange-500 shrink-0 mt-0.5">⚠ 最優先</span>
                  <span className="text-sm text-orange-800">{weaknesses[0]}</span>
                </div>
                {weaknesses.length > 1 && (
                  <ImprovementList
                    items={weaknesses.slice(1)}
                    variant="warning"
                    density="relaxed"
                  />
                )}
              </div>
            </div>
          )}

          {/* 今すぐできること */}
          {actions.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-700 mb-2">🔥 これやれば一気に評価上がる</p>
              <ImprovementList items={actions} variant="info" density="relaxed" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
