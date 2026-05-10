'use client';

import { useState } from 'react';
import type { InterviewQuestionFormData } from '../types';
import type { BasicInfo } from '@/types/basicInfo';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { EXAM_TYPE_OPTIONS } from '@/app/interview/constants';
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

export function InterviewQuestionForm() {
  const [formData, setFormData] = useState<InterviewQuestionFormData>(() => {
    const initialData = loadInterviewQuestionInitialData();
    return { ...INITIAL_FORM_DATA, ...initialData };
  });
  // basicInfo は受験方式・志望校情報を質問生成（および将来AI化時のプロンプト）に渡すための入力。
  // localStorage を直接読まず、共通関数 loadBasicInfo() を経由する。null フォールバック対応済み。
  const [basicInfo] = useState<BasicInfo | null>(() => loadBasicInfo());
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [extraQuestions, setExtraQuestions] = useState<GeneratedQuestion[]>([]);
  const [additionalCounts, setAdditionalCounts] = useState<Record<string, number>>({});
  const [loadingCategory, setLoadingCategory] = useState<string | null>(null);
  const [additionalUsage, setAdditionalUsage] = useState<InterviewAdditionalUsage>(
    loadAdditionalUsage,
  );
  const [autoFilled] = useState<boolean>(
    () => Object.keys(loadInterviewQuestionInitialData()).length > 0,
  );

  function handleChange(field: keyof InterviewQuestionFormData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit() {
    setQuestions(generateInterviewQuestions(formData, basicInfo));
    setExtraQuestions([]);
    setAdditionalCounts({});
  }

  function handleAddMore(category: string) {
    const categoryKey = CATEGORY_KEYS[category];
    if (!categoryKey || !canUseCategory(additionalUsage, categoryKey)) return;
    setLoadingCategory(category);
    // setTimeout で loading 表示を確実に描画してから生成する
    setTimeout(() => {
      const currentCount = additionalCounts[category] ?? 0;
      const newQuestions = generateAdditionalQuestions(category, formData, currentCount, 1, basicInfo);
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
        <button
          type="button"
          onClick={handleSubmit}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
        >
          予想質問を作成する
        </button>
      </section>

      {questions.length > 0 && (
        <InterviewQuestionPreview
          questions={questions}
          extraQuestions={extraQuestions}
          onAddMore={handleAddMore}
          loadingCategory={loadingCategory}
          categoryRemainingCounts={getCategoryRemainingMap(additionalUsage)}
        />
      )}
    </div>
  );
}
