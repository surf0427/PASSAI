'use client';

import { Button } from '@/components/ui/Button';
import type { GeneratedQuestion } from '../utils/generateInterviewQuestions';
import { EXPANDABLE_CATEGORIES } from '../utils/generateAdditionalQuestions';

type Props = {
  questions: GeneratedQuestion[];
  extraQuestions: GeneratedQuestion[];
  onAddMore: (category: string) => void;
  loadingCategory: string | null;
  categoryRemainingCounts: Record<string, number>;
};

function QuestionCard({ question }: { question: GeneratedQuestion }) {
  return (
    <div className="border border-gray-200 rounded-xl p-5">
      <p className="text-xs font-semibold text-blue-600 mb-2">{question.category}</p>
      <p className="text-sm font-semibold text-gray-800 leading-relaxed mb-3">
        {question.question}
      </p>
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2.5">
        <p className="text-xs font-semibold text-yellow-700 mb-1">回答ポイント</p>
        <p className="text-xs text-yellow-900 leading-relaxed">{question.answerTip}</p>
      </div>
    </div>
  );
}

export function InterviewQuestionPreview({ questions, extraQuestions, onAddMore, loadingCategory, categoryRemainingCounts }: Props) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-6">
      <h2 className="text-base font-semibold text-gray-800 mb-2">予想質問</h2>
      <p className="text-sm text-gray-500 leading-relaxed mb-5">
        入力内容をもとに生成した面接の予想質問です。実際の面接前に声に出して練習してみてください。
      </p>

      <div className="space-y-4">
        {questions.map((item) => {
          const extras = extraQuestions.filter((q) => q.category === item.category);
          const isExpandable = EXPANDABLE_CATEGORIES.includes(item.category);
          const isLoading = loadingCategory === item.category;
          const remaining = categoryRemainingCounts[item.category] ?? 0;
          const isLimitReached = remaining === 0;

          return (
            <div key={item.category}>
              <QuestionCard question={item} />

              {extras.map((extra, i) => (
                <div key={`${item.category}-extra-${i}`} className="mt-3">
                  <QuestionCard question={extra} />
                </div>
              ))}

              {isExpandable && (
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => onAddMore(item.category)}
                  disabled={loadingCategory !== null || isLimitReached}
                  className="mt-3 w-full"
                >
                  {isLoading
                    ? '生成中...'
                    : isLimitReached
                    ? 'この項目の追加質問は上限に達しました'
                    : `さらに質問を生成する（残り${remaining}回）`}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
