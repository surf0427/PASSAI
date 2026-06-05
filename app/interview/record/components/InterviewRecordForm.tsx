'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuotaDialog } from '@/components/billing/QuotaExceededDialog';
import type { InterviewRecordFormData } from '../types';
import type { QuestionAnswerItem } from '@/types/interview';
import type { BasicInfo } from '@/types/basicInfo';
import type { WallHittingResult } from '@/types/analysis';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { loadWallHittingResult } from '@/lib/wallHittingStorage';
import { getStudentProfileForFeature } from '@/lib/getStudentProfileForFeature';
import { EXAM_TYPE_OPTIONS } from '@/app/interview/constants';
import { InterviewQuestionAnswerItem } from './InterviewQuestionAnswerItem';
import { addInterviewRecord, getInterviewRecords } from '@/lib/interviewRecordStorage';
import type { NewInterviewRecord } from '@/lib/interviewRecordStorage';
// STEP-DIVERGENCE-02C: 過去の模擬面接 AI フィードバック → 既出の改善点（divergence context）。
import { buildPreviousOutputSummary } from '@/lib/contextBuilders/divergence/buildPreviousOutputSummary';
// STEP-DIVERGENCE-04D: まだ活用できていない可能性のある経験（activityData × 使用面）。
import { buildUnusedExperience } from '@/lib/contextBuilders/divergence/buildUnusedExperience';
import { loadActivityData } from '@/lib/activityStorage';
import { loadSelfPRs } from '@/lib/selfPRStorage';
import { loadReviewHistory } from '@/lib/statement/review/statementStorage';
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
  // STEP-BILLING-07A: 402 quota-exceeded ハンドラ。
  const { handleResponse: handleQuotaResponse, dialog: quotaDialog } =
    useQuotaDialog();

  const [formData, setFormData] = useState<InterviewRecordFormData>(INITIAL_FORM_DATA);
  const [questionsAndAnswers, setQuestionsAndAnswers] = useState<QuestionAnswerItem[]>(() => {
    const saved = loadInterviewDraft();
    return saved.length > 0 ? saved : [createQAItem()];
  });
  // basicInfo はフィードバックAPIに同梱して、AIが受験方式・志望校全体を踏まえた助言を返せるようにする。
  const [basicInfo] = useState<BasicInfo | null>(() => loadBasicInfo());
  // 自己分析（壁打ち）結果。API 側で toStudentProfile() を通して
  // 面接向けの最小コンテキストへ変換される。未実施なら null のまま送り、AI 側でフォールバック。
  const [wallHittingResult] = useState<WallHittingResult | null>(() => loadWallHittingResult());
  const [savedMessage, setSavedMessage] = useState('');
  const [apiError, setApiError] = useState('');
  // STEP-CODE-CLEANUP-A4: catch 経路の silent local fallback を可視化するための
  // non-blocking notice。fallback 自体 (generateInterviewFeedback) は維持し、
  // user に「簡易フィードバックに切り替わった」ことだけ伝える。空文字で非表示。
  const [fallbackNotice, setFallbackNotice] = useState('');
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
    setApiError('');
    setSavedMessage('');
    setFallbackNotice('');

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

    // STEP-DIVERGENCE-02C: 過去の模擬面接 AI フィードバックから「既出の改善点」を抽出する
    // divergence context。同じ改善点・同じ nextPractice の毎回反復（収束）を抑える。
    // - 無制限ストアなので直近 5 件に cap。feedbackJson（AI 出力）を持つ record のみ対象。
    // - projection は improvements[] → weaknesses / nextPractice[] → actions のみ。
    //   betterAnswer / perQuestionFeedback / myAnswers / levelEvaluation / score / 大学名 /
    //   日付などは一切載せない（暗記・anchoring・誤適用・肥大化の防止）。
    // - parse 失敗 record は skip（previousFeedback と同じ防御）。
    // - recordsConsidered < 2（履歴 0/1 件）は builder が空 struct を返し section も出ない。
    // - 生成 struct を body.previousOutputSummary に載せる（interview-feedback に app-level hash
    //   cache は無いため hash 配線は不要。毎回 AI を呼ぶので projection 非空なら常に発火する）。
    const previousOutputSummary = buildPreviousOutputSummary(
      getInterviewRecords()
        .slice(0, 5)
        .map((rec) => {
          if (!rec.feedbackJson) return null;
          try {
            const parsed = JSON.parse(rec.feedbackJson);
            return {
              weaknesses: parsed.improvements,
              actions: parsed.nextPractice,
            };
          } catch {
            return null;
          }
        })
        .filter((p): p is { weaknesses: unknown; actions: unknown } => p !== null),
    );

    // 【canonical path】下流に渡るのは StudentProfile 経由のみ。
    //   1. localStorage の canonical StudentProfile を最優先（getStudentProfileForFeature 内で読む）
    //   2. 無ければ wallHittingResult から派生（後方互換）
    //   3. どちらも無ければ null（自己分析未実施）
    // wallHittingResult は server-side fallback 用に併送する（API 移行が済み次第削除可）。
    // 新しい feature は wallHittingResult を直接送らず studentProfile を canonical input とする。
    const studentProfile = getStudentProfileForFeature({ wallHittingResult });

    // STEP-DIVERGENCE-04D: まだ活用できていない可能性のある「経験」を抽出する divergence context。
    // 次回練習向けの variety 提案として feedback に渡す（questions には入れない）。
    // usedText は cross-feature のユーザー記述 + canonical persona を連結する（AI 出力は含めない）:
    //   今回の Q&A + interview_records answers + statementReviewHistory.essay + selfPRs.text +
    //   StudentProfile。今回の Q&A を含めることで、今回触れた経験を未使用提案しない。無制限ストアは cap。
    // interview-feedback は cache/hash/version 無しのため hash 配線不要。
    const SELFPR_CAP = 20;
    const INTERVIEW_CAP = 20;
    const usedTextParts: string[] = [
      ...validQuestionsAndAnswers.flatMap((qa) => [qa.question, qa.answer]),
      ...getInterviewRecords()
        .slice(0, INTERVIEW_CAP)
        .flatMap((r) => [r.myAnswers ?? '', r.questionsAsked ?? '']),
      ...loadReviewHistory().map((h) => h.essay ?? ''),
      ...loadSelfPRs().slice(0, SELFPR_CAP).map((pr) => pr.text ?? ''),
    ];
    if (studentProfile) {
      usedTextParts.push(studentProfile.summary ?? '');
      usedTextParts.push(...(studentProfile.strengths ?? []));
      usedTextParts.push(...(studentProfile.signatureEpisodes ?? []).map((e) => e.title ?? ''));
    }
    const usedText = usedTextParts.filter((s) => s !== '').join('\n');
    const unusedExperience = buildUnusedExperience({ activityData: loadActivityData(), usedText });

    let improvementSummary: string;
    let feedbackJson: string | undefined;
    try {
      // STEP2.1: difficultPoints / teacherFeedback / selfReflection はサーバ側 route.ts で
      // 参照されていない dead input のため、payload から除外する。
      // フォーム state（whatWentWrong / feedbackReceived / selfNoted）と入力 UI は維持し、
      // ローカル記録 (NewInterviewRecord) への保存経路は変更しない。
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
          // STEP-DIVERGENCE-02C: 既出の改善点（divergence context）。未送信時は route が
          // null 扱いで section を出さない（完全後方互換）。
          previousOutputSummary,
          // STEP-DIVERGENCE-04D: まだ活用できていない可能性のある経験（次回練習向け variety 提案）。
          unusedExperience,
          basicInfo,
          // canonical artifact。API はこれを最優先で読み、buildInterviewStudentProfileContext へ渡す。
          studentProfile,
          // LEGACY fallback。studentProfile が null のときに API が toStudentProfile() で派生する保険。
          // canonical path への移行が完了次第このフィールドは削除可能。
          wallHittingResult,
        }),
      });
      // STEP-BILLING-07A: 402 quota-exceeded はダイアログに委譲して早期 return。
      // 既存の fallback 経路 (generateInterviewFeedback / record 保存) は
      // 走らせず、submit を破棄する (ユーザーは AI 添削をスキップしたいわけではない)。
      if (await handleQuotaResponse(response)) {
        setIsSubmitting(false);
        return;
      }
      const data = await response.json();
      // API が構造化エラー（AI_FEEDBACK_TRUNCATED / AI_FEEDBACK_PARSE_FAILED 等）を返した場合は、
      // 既存のローカル fallback で「それっぽい改善コメント」を保存してしまうと事象が隠れるため、
      // ユーザーにエラーを明示してこの送信は破棄する。
      if (!response.ok && typeof data?.message === 'string') {
        setApiError(data.message);
        setIsSubmitting(false);
        return;
      }
      improvementSummary = response.ok && data.improvementSummary
        ? data.improvementSummary
        : generateInterviewFeedback(myAnswers);
      if (response.ok && data.feedback) {
        feedbackJson = JSON.stringify(data.feedback);
      }
    } catch {
      // STEP-CODE-CLEANUP-A4: network / fetch throw 経路の silent local fallback を可視化。
      // fallback (generateInterviewFeedback) と保存フローは維持し、user に「AI 失敗 →
      // 簡易フィードバックに切替」を non-blocking notice として伝える。
      improvementSummary = generateInterviewFeedback(myAnswers);
      setFallbackNotice('AIフィードバックの生成に失敗したため、簡易フィードバックを表示しています。');
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

      {apiError && (
        <AlertBox variant="error" className="mb-8">
          <p className="text-sm text-red-700">{apiError}</p>
        </AlertBox>
      )}

      {/* STEP-CODE-CLEANUP-A4: silent local fallback の可視化。
          catch 経路で improvementSummary が generateInterviewFeedback(myAnswers) に
          切り替わったときに表示。保存 (savedMessage) は通常通り表示されるため、
          「保存はできた / フィードバックは簡易版」の両方が user に伝わる。 */}
      {fallbackNotice && (
        <AlertBox variant="warning" className="mb-8">
          <p className="text-sm">{fallbackNotice}</p>
        </AlertBox>
      )}

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

      {/* STEP-BILLING-07A: 402 quota-exceeded ダイアログ。 */}
      {quotaDialog}
    </div>
  );
}
