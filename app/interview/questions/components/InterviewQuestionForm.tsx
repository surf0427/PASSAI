'use client';

import { useState } from 'react';
import type { InterviewQuestionFormData, InterviewQuestionsViewState } from '../types';
import type { BasicInfo } from '@/types/basicInfo';
import type { TwoLayerInterviewQuestions } from '@/types/interviewQuestions';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { loadDraft } from '@/lib/statement/review/statementStorage';
import { loadAnalyzeState } from '@/lib/analyzeStorage';
import { loadWallHittingResult } from '@/lib/wallHittingStorage';
import { getStudentProfileForFeature } from '@/lib/getStudentProfileForFeature';
import { EXAM_TYPE_OPTIONS } from '@/app/interview/constants';
import { Button } from '@/components/ui/Button';
import { InterviewQuestionPreview } from './InterviewQuestionPreview';
import { loadInterviewQuestionInitialData } from '../utils/loadInterviewQuestionInitialData';
import { generateInterviewQuestions } from '../utils/generateInterviewQuestions';
import type { GeneratedQuestion } from '../utils/generateInterviewQuestions';
import { generateAdditionalQuestions } from '../utils/generateAdditionalQuestions';
import {
  loadAdditionalUsage,
  canUseCategory,
  incrementCategory,
  getCategoryRemainingMap,
  CATEGORY_KEYS,
  type InterviewAdditionalUsage,
} from '@/lib/interviewAdditionalUsage';
import {
  hashInterviewQuestionsInput,
  INTERVIEW_QUESTIONS_MODEL,
  INTERVIEW_QUESTIONS_PROMPT_VERSION,
} from '@/lib/aiInputHash';
import {
  loadInterviewQuestionCache,
  saveInterviewQuestionCache,
} from '@/lib/interviewQuestionCache';
import { logAiCache } from '@/lib/aiCacheLog';

const CACHE_ROUTE = 'api/interview-questions';

// 日次バリエーション seed（PROMPT_VERSION v4 と連動）。
// JST の `YYYY-MM-DD` を返し、hash 入力 + API body の両方に同値を載せて client/server の
// hash 整合性を保つ。JST 固定にしているのは、ユーザー（高校生）の生活時間軸と一致させて
// 「日付が変わったタイミング = 質問が切り替わるタイミング」を直感的に揃えるため。
// UTC 基準だと JST 朝 9:00 で切り替わってしまい体験が分かりにくい。
function getInterviewDailyVariationSeed(): string {
  // 'en-CA' は `YYYY-MM-DD` 形式を返すロケール。`Intl.DateTimeFormat` の
  // timeZone option で wall-clock を Asia/Tokyo に固定する。
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

const INITIAL_FORM_DATA: InterviewQuestionFormData = {
  universityName: '',
  facultyName: '',
  examType: '総合型選抜',
  reason: '',
  activities: '',
  futureGoals: '',
};

const INPUT_CLASS =
  'w-full border border-slate-300 rounded-lg px-4 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400';

const TEXTAREA_CLASS =
  'w-full border border-slate-300 rounded-lg px-4 py-3 text-sm leading-relaxed bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y';

// AI route の正常レスポンスを runtime guard で確認するための最小チェック。
// shape 不正は fallback 経路に流す（throw して catch でハンドル）。
function isTwoLayerQuestions(value: unknown): value is TwoLayerInterviewQuestions {
  if (!value || typeof value !== 'object') return false;
  const v = value as { general?: unknown; personalized?: unknown };
  return Array.isArray(v.general) && Array.isArray(v.personalized);
}

// AI 成功 + 件数が 0 件のときは「生成失敗」と同じ扱いにする（UX を空にしないため）。
function isUsableTwoLayer(q: TwoLayerInterviewQuestions): boolean {
  return q.general.length > 0 || q.personalized.length > 0;
}

export function InterviewQuestionForm() {
  const [formData, setFormData] = useState<InterviewQuestionFormData>(() => {
    const initialData = loadInterviewQuestionInitialData();
    return { ...INITIAL_FORM_DATA, ...initialData };
  });
  // basicInfo は AI route に同梱して、受験方式・志望校情報を反映させるための入力。
  // localStorage を直接読まず、共通関数 loadBasicInfo() を経由する。null フォールバック対応済み。
  const [basicInfo] = useState<BasicInfo | null>(() => loadBasicInfo());
  const [viewState, setViewState] = useState<InterviewQuestionsViewState>({ mode: 'idle' });
  const [extraQuestions, setExtraQuestions] = useState<GeneratedQuestion[]>([]);
  const [additionalCounts, setAdditionalCounts] = useState<Record<string, number>>({});
  const [loadingCategory, setLoadingCategory] = useState<string | null>(null);
  const [additionalUsage, setAdditionalUsage] = useState<InterviewAdditionalUsage>(
    loadAdditionalUsage,
  );
  const [autoFilled] = useState<boolean>(
    () => Object.keys(loadInterviewQuestionInitialData()).length > 0,
  );
  // AI 生成中フラグ。送信ボタンの disable / loading 文言切替に使う。
  const [isAiLoading, setIsAiLoading] = useState(false);
  // AI 経路が失敗して deterministic へ fallback したことを Preview の上に小さく告知する。
  const [usedFallback, setUsedFallback] = useState(false);
  // PR8c (H6): cache hit transparency。同入力で interviewQuestionCache から復元したことを
  //   軽量バナーで明示する。cache hit semantics（PR3 で確定）は変更せず、UI 透明性のみ追加。
  //   handleSubmit のたびに false に reset し、cache hit 経路でのみ true に切り替える。
  const [loadedFromCache, setLoadedFromCache] = useState(false);

  function handleChange(field: keyof InterviewQuestionFormData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  // AI 経路が失敗した時に呼ぶ。既存 deterministic を view state に流すだけ。
  function applyFallback() {
    setViewState({
      mode: 'legacy',
      questions: generateInterviewQuestions(formData, basicInfo),
    });
    setUsedFallback(true);
    setLoadedFromCache(false);
  }

  async function handleSubmit() {
    // 新規生成のたびに「さらに質問を生成」の表示状態はリセット（既存仕様）。
    setExtraQuestions([]);
    setAdditionalCounts({});
    setUsedFallback(false);
    setLoadedFromCache(false);
    setIsAiLoading(true);

    try {
      // 素材は client 側で集めて body で渡す。route 内で materials builder が圧縮する。
      // localStorage 直アクセスはせず、既存 storage helper のみ使う。
      const statementDraft = loadDraft();
      const studentProfile = getStudentProfileForFeature({
        wallHittingResult: loadWallHittingResult(),
      });
      const activitySummary = loadAnalyzeState()?.summary?.activitySummary ?? null;

      // ── cache lookup ─────────────────────────────────────────────────
      // 同じ素材なら AI call を skip して保存済み 2 層質問を復元する。
      // model / promptVersion 差分は cache miss として扱い、無理に hit させない。
      // fail-open: parse 失敗・JSON 壊れ・quota error は safeGetStorage 側で吸収済み。
      //
      // v4: dailySeed を hash 入力に含める。同日 = 同 hash → cache hit。翌日 =
      // 異なる hash → cache miss → AI 再生成。API コストは「同じ入力で 1 日 1 回」が上限。
      const dailySeed = getInterviewDailyVariationSeed();
      const inputHash = hashInterviewQuestionsInput({
        basicInfo,
        statementDraft,
        studentProfile,
        activitySummary,
        dailySeed,
        model: INTERVIEW_QUESTIONS_MODEL,
        promptVersion: INTERVIEW_QUESTIONS_PROMPT_VERSION,
      });

      const cached = loadInterviewQuestionCache();
      if (
        cached &&
        cached.inputHash === inputHash &&
        cached.model === INTERVIEW_QUESTIONS_MODEL &&
        cached.promptVersion === INTERVIEW_QUESTIONS_PROMPT_VERSION
      ) {
        logAiCache({ route: CACHE_ROUTE, action: 'hit', inputHash });
        setViewState({ mode: 'two_layer', questions: cached.questions });
        setLoadedFromCache(true);
        return;
      }
      logAiCache({ route: CACHE_ROUTE, action: 'miss', inputHash });

      // ── API call（cache miss / 不一致時のみ） ─────────────────────────
      // dailySeed は client / server で同値を共有する必要があるため、hash 入力と同じ
      // 値を body にも渡す。server は body の値を直接 prompt に使う（再計算しない）。
      const response = await fetch('/api/interview-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basicInfo,
          statementDraft,
          studentProfile,
          activitySummary,
          dailySeed,
        }),
      });

      if (!response.ok) throw new Error('AI_HTTP_FAILED');

      const data: unknown = await response.json();
      const questions = (data as { questions?: unknown })?.questions;

      if (!isTwoLayerQuestions(questions)) throw new Error('AI_INVALID_SHAPE');
      if (!isUsableTwoLayer(questions)) throw new Error('AI_EMPTY_RESULT');

      // 成功した two_layer 結果のみ cache 保存。legacy fallback は保存しない（次回に
      // 同じ素材で再び legacy へ落ちると AI 改善を取りに行けなくなるため）。
      saveInterviewQuestionCache({
        inputHash,
        model: INTERVIEW_QUESTIONS_MODEL,
        promptVersion: INTERVIEW_QUESTIONS_PROMPT_VERSION,
        savedAt: new Date().toISOString(),
        questions,
      });

      setViewState({ mode: 'two_layer', questions });
    } catch {
      // 5xx / network / parse / shape のいずれでも deterministic へフォールバック。
      // cache 保存は通らない経路なので legacy mode が cache 化されることはない。
      applyFallback();
    } finally {
      setIsAiLoading(false);
    }
  }

  function handleAddMore(category: string) {
    const categoryKey = CATEGORY_KEYS[category];
    if (!categoryKey || !canUseCategory(additionalUsage, categoryKey)) return;
    setLoadingCategory(category);
    setTimeout(() => {
      const currentCount = additionalCounts[category] ?? 0;
      const newQuestions = generateAdditionalQuestions(
        category,
        formData,
        currentCount,
        1,
      );
      setExtraQuestions((prev) => [...prev, ...newQuestions]);
      setAdditionalCounts((prev) => ({ ...prev, [category]: currentCount + 1 }));
      const newUsage = incrementCategory(additionalUsage, categoryKey);
      setAdditionalUsage(newUsage);
      setLoadingCategory(null);
    }, 400);
  }

  return (
    <div>
      <section className="bg-white border border-gray-200 rounded-xl p-6 mb-6">

        {/* 自動入力バナー */}
        {autoFilled && (
          <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 leading-relaxed">
            保存済みの情報をもとに大学名・学部・入試方式を自動入力しました。必要に応じて修正できます。
          </p>
        )}

        {/* 活動内容・志望理由の自動取得メモ */}
        <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-6 leading-relaxed">
          活動内容・志望理由は保存済みデータから自動取得して質問生成に使用します。
        </p>

        {/* 大学名 */}
        <div className="mb-5">
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            大学名
          </label>
          <input
            type="text"
            value={formData.universityName}
            onChange={(e) => handleChange('universityName', e.target.value)}
            placeholder="例：○○大学"
            className={INPUT_CLASS}
          />
        </div>

        {/* 学部・学科 */}
        <div className="mb-5">
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            学部・学科
          </label>
          <input
            type="text"
            value={formData.facultyName}
            onChange={(e) => handleChange('facultyName', e.target.value)}
            placeholder="例：経済学部 経済学科"
            className={INPUT_CLASS}
          />
        </div>

        {/* 入試方式 */}
        <div className="mb-5">
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            入試方式
          </label>
          <select
            value={formData.examType}
            onChange={(e) => handleChange('examType', e.target.value)}
            className={INPUT_CLASS}
          >
            {EXAM_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        {/* 将来目標 */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            将来目標
          </label>
          <textarea
            value={formData.futureGoals}
            onChange={(e) => handleChange('futureGoals', e.target.value)}
            rows={4}
            placeholder="例：データサイエンティストとして、社会課題の解決に取り組みたい"
            className={TEXTAREA_CLASS}
          />
        </div>

        {/* 送信ボタン */}
        <Button
          variant="primary"
          size="lg"
          onClick={handleSubmit}
          disabled={isAiLoading}
        >
          {isAiLoading ? '面接質問を作成中...' : '予想質問を作成する'}
        </Button>
      </section>

      {viewState.mode !== 'idle' && (
        <>
          {/* PR8c (H6): cache hit transparency。同入力で interviewQuestionCache から
              復元されたことを軽量バナーで明示。cache hit semantics は変更しない。
              Preview には触らない（バナー表示は Form 側の責務に限定）。 */}
          {loadedFromCache && viewState.mode === 'two_layer' && (
            <div
              role="status"
              aria-live="polite"
              className="mb-4 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700 flex items-center gap-1"
            >
              <span aria-hidden>↺</span>
              以前生成した質問を再表示しています（同じ入力のため）。
            </div>
          )}
          <InterviewQuestionPreview
            viewState={viewState}
            extraQuestions={extraQuestions}
            onAddMore={handleAddMore}
            loadingCategory={loadingCategory}
            categoryRemainingCounts={getCategoryRemainingMap(additionalUsage)}
            showFallbackNotice={usedFallback}
          />
        </>
      )}
    </div>
  );
}
