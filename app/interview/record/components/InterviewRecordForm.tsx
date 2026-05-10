'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { InterviewRecordFormData } from '../types';
import type { QuestionAnswerItem } from '@/types/interview';
import type { BasicInfo } from '@/types/basicInfo';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { EXAM_TYPE_OPTIONS } from '@/app/interview/constants';
import { InterviewQuestionAnswerItem } from './InterviewQuestionAnswerItem';
import { addInterviewRecord, getInterviewRecords } from '@/lib/interviewRecordStorage';
import type { NewInterviewRecord } from '@/lib/interviewRecordStorage';
import { loadInterviewDraft, saveInterviewDraft, clearInterviewDraft } from '@/lib/interviewDraftStorage';
import { generateInterviewFeedback } from '@/lib/generateInterviewFeedback';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';

const INITIAL_FORM_DATA: InterviewRecordFormData = {
  practiceDate: '',
  partner: '',
  universityName: '',
  facultyName: '',
  examType: '総合型選抜',
  questionsAsked: '',
  myAnswers: '',
  whatWentWrong: '',
  feedbackReceived: '',
  selfNoted: '',
};

const INPUT_CLASS =
  'w-full border border-slate-300 rounded-lg px-4 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400';

const TEXTAREA_CLASS =
  'w-full border border-slate-300 rounded-lg px-4 py-3 text-sm leading-relaxed bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y';

function createQAItem(): QuestionAnswerItem {
  return { id: crypto.randomUUID(), question: '', answer: '' };
}

export function InterviewRecordForm() {
  const [formData, setFormData] = useState<InterviewRecordFormData>(INITIAL_FORM_DATA);
  const [questionsAndAnswers, setQuestionsAndAnswers] = useState<QuestionAnswerItem[]>(() => {
    const saved = loadInterviewDraft();
    return saved.length > 0 ? saved : [createQAItem()];
  });
  // basicInfo はフィードバックAPIに同梱して、AIが受験方式・志望校全体を踏まえた助言を返せるようにする。
  const [basicInfo] = useState<BasicInfo | null>(() => loadBasicInfo());
  const [savedMessage, setSavedMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // questionsAndAnswers が変わるたびに自動保存（初回レンダリングはスキップ）
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) { isFirstRun.current = false; return; }
    saveInterviewDraft(questionsAndAnswers);
  }, [questionsAndAnswers]);

  function handleChange(field: keyof InterviewRecordFormData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function handleQAChange(id: string, field: 'question' | 'answer', value: string) {
    setQuestionsAndAnswers((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  }

  function handleAddQA() {
    setQuestionsAndAnswers((prev) => [...prev, createQAItem()]);
  }

  function handleDeleteQA(id: string) {
    setQuestionsAndAnswers((prev) => prev.filter((item) => item.id !== id));
  }

  async function handleSubmit() {
    setIsSubmitting(true);

    // Deprecated: questionsAsked / myAnswers は旧形式の文字列。
    // StoredInterviewRecord の互換フィールドへ格納するために生成する。
    // 将来 StoredInterviewRecord に questionsAndAnswers フィールドを追加した時点で不要になる。
    const questionsAsked = questionsAndAnswers
      .map((item, i) => `${i + 1}. ${item.question}`)
      .join('\n');
    const myAnswers = questionsAndAnswers
      .map((item, i) => `${i + 1}. ${item.answer}`)
      .join('\n');

    // 空の質問・回答ペアを除外してから送る
    const validQuestionsAndAnswers = questionsAndAnswers
      .map((item) => ({
        question: item.question?.trim() ?? '',
        answer: item.answer?.trim() ?? '',
      }))
      .filter((item) => item.question !== '' && item.answer !== '');

    // 直前の記録から構造化フィードバックを取得して比較に使う
    const previousFeedback = (() => {
      try {
        const prev = getInterviewRecords()[0];
        if (!prev?.feedbackJson) return undefined;
        return JSON.parse(prev.feedbackJson);
      } catch {
        return undefined;
      }
    })();

    let improvementSummary: string;
    let feedbackJson: string | undefined;
    try {
      const response = await fetch('/api/interview-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          universityName: formData.universityName,
          facultyName: formData.facultyName,
          motivation: '',
          questionsAsked,
          myAnswers,
          questionsAndAnswers: validQuestionsAndAnswers,
          previousFeedback,
          difficultPoints: formData.whatWentWrong,
          teacherFeedback: formData.feedbackReceived,
          selfReflection: formData.selfNoted,
          basicInfo,
        }),
      });
      const data = await response.json();
      improvementSummary = response.ok && data.improvementSummary
        ? data.improvementSummary
        : generateInterviewFeedback(myAnswers);
      if (response.ok && data.feedback) {
        feedbackJson = JSON.stringify(data.feedback);
      }
    } catch {
      improvementSummary = generateInterviewFeedback(myAnswers);
    }

    const newRecord: NewInterviewRecord = {
      practiceDate: formData.practiceDate,
      universityName: formData.universityName,
      facultyName: formData.facultyName,
      examType: formData.examType,
      partner: formData.partner,
      mainQuestion: questionsAsked,
      improvementSummary,
      questionsAsked,
      myAnswers,
      whatWentWrong: formData.whatWentWrong,
      feedbackReceived: formData.feedbackReceived,
      selfNoted: formData.selfNoted,
      feedbackJson,
    };
    addInterviewRecord(newRecord);
    clearInterviewDraft();
    setSavedMessage('練習記録を保存しました。');
    setFormData(INITIAL_FORM_DATA);
    setQuestionsAndAnswers([createQAItem()]);
    setIsSubmitting(false);
  }

  return (
    <div>
      {/* 補助文言 */}
      <AlertBox variant="info" className="mb-6">
        <p>完璧に書く必要はありません。覚えている範囲で大丈夫です。あとでAIが改善点を整理します。</p>
      </AlertBox>

      {/* 基本情報 */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-700 mb-5">基本情報</h2>

        <div className="mb-5">
          <label className="block text-sm font-semibold text-gray-700 mb-1">練習日</label>
          <input
            type="date"
            value={formData.practiceDate}
            onChange={(e) => handleChange('practiceDate', e.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <div className="mb-5">
          <label className="block text-sm font-semibold text-gray-700 mb-1">練習相手</label>
          <input
            type="text"
            value={formData.partner}
            onChange={(e) => handleChange('partner', e.target.value)}
            placeholder="例：担任の先生、友達、親"
            className={INPUT_CLASS}
          />
        </div>

        <div className="mb-5">
          <label className="block text-sm font-semibold text-gray-700 mb-1">大学名</label>
          <input
            type="text"
            value={formData.universityName}
            onChange={(e) => handleChange('universityName', e.target.value)}
            placeholder="例：○○大学"
            className={INPUT_CLASS}
          />
        </div>

        <div className="mb-5">
          <label className="block text-sm font-semibold text-gray-700 mb-1">学部・学科</label>
          <input
            type="text"
            value={formData.facultyName}
            onChange={(e) => handleChange('facultyName', e.target.value)}
            placeholder="例：経済学部 経済学科"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">入試方式</label>
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
      </section>

      {/* 面接内容 */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-700 mb-5">面接内容</h2>

        {/* 質問・回答セット */}
        {questionsAndAnswers.map((item, index) => (
          <InterviewQuestionAnswerItem
            key={item.id}
            item={item}
            index={index}
            canDelete={questionsAndAnswers.length > 1}
            onChangeQuestion={(value) => handleQAChange(item.id, 'question', value)}
            onChangeAnswer={(value) => handleQAChange(item.id, 'answer', value)}
            onDelete={() => handleDeleteQA(item.id)}
          />
        ))}

        {/* 質問追加ボタン */}
        <Button
          variant="outline"
          size="md"
          onClick={handleAddQA}
          className="w-full border-dashed mb-5"
        >
          ＋ 質問を追加する
        </Button>

        <div className="mb-5">
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            うまくいかなかったところは？
          </label>
          <textarea
            value={formData.whatWentWrong}
            onChange={(e) => handleChange('whatWentWrong', e.target.value)}
            rows={4}
            placeholder="例：緊張して言葉に詰まってしまった。具体例をうまく説明できなかった"
            className={TEXTAREA_CLASS}
          />
        </div>

        <div className="mb-5">
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            先生・面接官から言われたこと
          </label>
          <textarea
            value={formData.feedbackReceived}
            onChange={(e) => handleChange('feedbackReceived', e.target.value)}
            rows={4}
            placeholder="例：結論から話すようにするといい。もう少し具体的なエピソードを入れて"
            className={TEXTAREA_CLASS}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            自分で気づいた改善点
          </label>
          <textarea
            value={formData.selfNoted}
            onChange={(e) => handleChange('selfNoted', e.target.value)}
            rows={4}
            placeholder="例：次は結論から話す練習をしたい。声が小さかったので意識したい"
            className={TEXTAREA_CLASS}
          />
        </div>
      </section>

      {/* 送信ボタン */}
      <Button
        variant="primary"
        size="md"
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="mb-4"
      >
        {isSubmitting ? 'AIが改善点を作成中...' : '改善点を確認する'}
      </Button>

      {savedMessage && (
        <AlertBox variant="success" className="mb-8">
          <p className="text-sm text-green-700 mb-3">{savedMessage}</p>
          <Link
            href="/interview/history"
            className="inline-block bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
          >
            過去の練習記録を見る
          </Link>
        </AlertBox>
      )}

    </div>
  );
}
