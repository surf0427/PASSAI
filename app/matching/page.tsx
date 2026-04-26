'use client';

import { useState, useEffect } from 'react';
import { type BasicFormData, type ExamType, EXAM_TYPE_LABELS } from '@/types/basicInfo';
import type { BasicInfo, MatchingResult } from '@/types/matching';
import type { WallHittingResult } from '@/types/analysis';
import type { AiMatchAdvice } from '@/app/api/matching/route';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { buildMatchingResults } from '@/lib/matching/suggestUniversities';
import { loadMatchingInput, getMissingItems } from '@/lib/admissionMatchingStorage';
import { deriveStudentAnalysis } from '@/lib/matching/deriveStudentAnalysis';

// ── 変換ヘルパー ─────────────────────────────────────────────────

function toBasicInfo(formData: BasicFormData): BasicInfo {
  return {
    name: formData.name,
    highSchool: formData.highSchool,
    grade: formData.grade,
    academicType: formData.stream === '理系' ? '理系' : '文系',
    choices: formData.preferences
      .filter((p) => p.university.trim() !== '')
      .map((p) => ({ university: p.university, faculty: p.faculty })),
  };
}

// ── ページ本体 ───────────────────────────────────────────────────

export default function MatchingPage() {
  const [basicFormData, setBasicFormData] = useState<BasicFormData | null>(null);
  const [wallHitting, setWallHitting] = useState<WallHittingResult | null>(null);
  const [results, setResults] = useState<MatchingResult[]>([]);
  const [aiAdvices, setAiAdvices] = useState<AiMatchAdvice[]>([]);
  const [missingItems, setMissingItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    const matchingInput = loadMatchingInput();

    if (matchingInput?.basicInfo) {
      setBasicFormData(matchingInput.basicInfo);
      setWallHitting(matchingInput.wallHittingResult ?? null);
      const basicInfo = toBasicInfo(matchingInput.basicInfo);
      const analysis = deriveStudentAnalysis(
        matchingInput.basicInfo,
        matchingInput.activityData,
        matchingInput.selfPRs,
        matchingInput.wallHittingResult,
      );
      setResults(buildMatchingResults(basicInfo, analysis));
      setMissingItems(getMissingItems(matchingInput));
    } else {
      const saved = loadBasicInfo();
      if (saved) {
        setBasicFormData(saved);
        const basicInfo = toBasicInfo(saved);
        const analysis = deriveStudentAnalysis(saved, null, []);
        setResults(buildMatchingResults(basicInfo, analysis));
        setMissingItems(['活動整理', '自己分析添削']);
      }
    }

    setLoading(false);
  }, []);

  async function handleAiEnhance() {
    if (!wallHitting || results.length === 0) return;
    setAiLoading(true);
    setAiError('');
    try {
      const res = await fetch('/api/matching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallHitting, results }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.detail ?? 'AI強化に失敗しました');
        return;
      }
      setAiAdvices(data.advices as AiMatchAdvice[]);
    } catch {
      setAiError('エラーが発生しました。しばらくしてから再試行してください。');
    } finally {
      setAiLoading(false);
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

  // ── メイン表示 ──────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold text-gray-800 mb-8">AI志望校マッチング</h1>

      {/* 不足データの警告 */}
      {missingItems.length > 0 && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-yellow-800 mb-2">
            以下のデータが未入力のため、マッチング精度が下がっています
          </p>
          <ul className="space-y-1">
            {missingItems.map((item) => (
              <li key={item} className="text-sm text-yellow-700 flex items-center gap-2">
                <span className="text-yellow-500">⚠</span>
                {item}が未入力です
                {item === '基本情報' && (
                  <a href="/input/basic" className="text-blue-600 underline ml-1">入力する →</a>
                )}
                {item === '活動整理' && (
                  <a href="/input/activity" className="text-blue-600 underline ml-1">入力する →</a>
                )}
                {item === '自己分析添削' && (
                  <a href="/" className="text-blue-600 underline ml-1">入力する →</a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* AI壁打ち結果サマリー */}
      {wallHitting && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-5">
          <p className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-2">AI分析に基づくマッチング</p>
          <p className="text-sm text-blue-900 leading-relaxed mb-3">{wallHitting.summary}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold text-blue-700 mb-1">強み</p>
              <ul className="space-y-0.5">
                {wallHitting.strengths.slice(0, 3).map((s, i) => (
                  <li key={i} className="text-xs text-blue-800">✓ {s}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-orange-700 mb-1">補強ポイント</p>
              <ul className="space-y-0.5">
                {wallHitting.weaknesses.slice(0, 2).map((w, i) => (
                  <li key={i} className="text-xs text-orange-800">△ {w}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 基本情報サマリー */}
      <section className="mb-8 bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">基本情報</h2>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <span className="text-gray-400">名前</span>
          <span>{basicFormData.name}</span>
          <span className="text-gray-400">高校名</span>
          <span>{basicFormData.highSchool}</span>
          <span className="text-gray-400">学年</span>
          <span>{basicFormData.grade}</span>
          <span className="text-gray-400">文理</span>
          <span>{basicFormData.stream || '未設定'}</span>
          {basicFormData.examType && (
            <>
              <span className="text-gray-400">受験方式</span>
              <span>{EXAM_TYPE_LABELS[basicFormData.examType as ExamType]}</span>
            </>
          )}
        </div>

        {basicFormData.preferences.some((p) => p.university.trim()) && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-bold text-gray-500 mb-2">志望校</p>
            <ul className="space-y-1">
              {basicFormData.preferences
                .filter((p) => p.university.trim())
                .map((p, i) => (
                  <li key={i} className="text-sm text-gray-700">
                    {i + 1}. {p.university}　{p.faculty}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>

      {/* AI強化ボタン */}
      {wallHitting && results.length > 0 && aiAdvices.length === 0 && (
        <div className="mb-6">
          {aiError && (
            <p className="text-red-600 text-sm mb-3">{aiError}</p>
          )}
          <button
            type="button"
            onClick={handleAiEnhance}
            disabled={aiLoading}
            className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors"
          >
            {aiLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                AIがアドバイスを生成中...（30秒ほど）
              </>
            ) : (
              'AIで各大学の受験アドバイスを強化する'
            )}
          </button>
          <p className="text-xs text-gray-400 text-center mt-2">
            あなたの強み・弱みを踏まえた具体的なアドバイスを生成します
          </p>
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
    </div>
  );
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

  const reason      = aiAdvice?.reason       ?? result.reason;
  const strengths   = aiAdvice?.strengthPoints ?? result.strengthPoints;
  const weaknesses  = aiAdvice?.weaknesses   ?? result.weaknesses;
  const actions     = aiAdvice?.actionItems  ?? result.actionItems;

  const scoreColor = result.score >= 80 ? 'text-green-600' : result.score >= 60 ? 'text-blue-600' : 'text-orange-500';
  const tagColor =
    result.suggestionType === '自分の志望校'    ? 'bg-purple-100 text-purple-700'
    : result.suggestionType === 'ストレートマッチ' ? 'bg-blue-100 text-blue-700'
    : 'bg-green-100 text-green-700';

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* ヘッダー（常に表示） */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-5 flex items-start justify-between gap-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tagColor}`}>
              {result.suggestionType}
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
            {result.score}
            <span className="text-sm font-normal text-gray-400">点</span>
          </p>
          <p className="text-xs text-gray-400 mt-1">{open ? '▲ 閉じる' : '▼ 詳細'}</p>
        </div>
      </button>

      {/* 詳細（展開時） */}
      {open && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
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
              <ul className="space-y-1">
                {strengths.map((s, j) => (
                  <li key={j} className="text-sm text-green-700 flex gap-2">
                    <span className="shrink-0">✓</span><span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 課題 */}
          {weaknesses.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">課題</p>
              <ul className="space-y-1">
                {weaknesses.map((w, j) => (
                  <li key={j} className="text-sm text-orange-700 flex gap-2">
                    <span className="shrink-0">△</span><span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 改善アクション */}
          {actions.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">今すぐできること</p>
              <ul className="space-y-1.5">
                {actions.map((a, j) => (
                  <li key={j} className="text-sm text-gray-700 flex gap-2">
                    <span className="text-blue-500 shrink-0">→</span><span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
