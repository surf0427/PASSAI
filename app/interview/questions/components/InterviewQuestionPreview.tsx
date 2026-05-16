'use client';

import { Button } from '@/components/ui/Button';
import type { GeneratedQuestion } from '../utils/generateInterviewQuestions';
import { EXPANDABLE_CATEGORIES } from '../utils/generateAdditionalQuestions';
import type { InterviewQuestionsViewState } from '../types';
import type {
  GeneralInterviewQuestion,
  InterviewQuestionCategory,
  PersonalizedInterviewQuestion,
} from '@/types/interviewQuestions';

type Props = {
  viewState: InterviewQuestionsViewState;
  extraQuestions: GeneratedQuestion[];
  onAddMore: (category: string) => void;
  loadingCategory: string | null;
  categoryRemainingCounts: Record<string, number>;
  // AI 失敗時に deterministic にフォールバックしたことをユーザーに伝えるバナー。
  // 大きなエラー UI は出さない。trueのとき小さく告知する。
  showFallbackNotice?: boolean;
};

// AI 出力の英語 category を、既存 UI と同じ「短い日本語ラベル」に揃える。
// QuestionCard 表示で違和感が出ないようにするための表示専用マッピング。
const TWO_LAYER_CATEGORY_LABEL: Record<InterviewQuestionCategory, string> = {
  motivation: '志望動機',
  activity: '活動深掘り',
  self_analysis: '自己分析',
  university_fit: '大学・学部理解',
  future_goal: '将来目標',
  consistency_check: '一貫性確認',
  authenticity_check: '本人性確認',
};

type CardModel = {
  category: string;
  question: string;
  answerTip: string;
  // personalized のみ任意で表示するメタ情報
  sourceHintLabel?: string;
  intent?: string;
};

const SOURCE_HINT_LABEL: Record<
  NonNullable<PersonalizedInterviewQuestion['sourceHint']>,
  string
> = {
  statement: '志望理由書から',
  activity: '活動内容から',
  self_analysis: '自己分析から',
  university_db: '大学情報から',
  admission_policy: 'アドミッションポリシーから',
  selection_steps: '選考フローから',
};

function QuestionCard({ card }: { card: CardModel }) {
  return (
    <div className="border border-gray-200 rounded-xl p-5">
      <p className="text-xs font-semibold text-blue-600 mb-2">{card.category}</p>
      <p className="text-sm font-semibold text-gray-800 leading-relaxed mb-3">
        {card.question}
      </p>
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2.5">
        <p className="text-xs font-semibold text-yellow-700 mb-1">回答ポイント</p>
        <p className="text-xs text-yellow-900 leading-relaxed">{card.answerTip}</p>
      </div>
      {(card.sourceHintLabel || card.intent) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
          {card.sourceHintLabel && <span>素材：{card.sourceHintLabel}</span>}
          {card.intent && <span>意図：{card.intent}</span>}
        </div>
      )}
    </div>
  );
}

function toGeneralCard(q: GeneralInterviewQuestion): CardModel {
  return {
    category: TWO_LAYER_CATEGORY_LABEL[q.category],
    question: q.question,
    answerTip: q.answerTip,
  };
}

// intent は AI が返す自由文字列。レイアウト保護のため表示時に短く丸める。
// 元の値は state に残しているため、将来 tooltip で全文を出す等の拡張は可能。
const INTENT_DISPLAY_MAX_CHARS = 40;

function capIntentForDisplay(intent: string | undefined): string | undefined {
  if (!intent) return undefined;
  if (intent.length <= INTENT_DISPLAY_MAX_CHARS) return intent;
  return `${intent.slice(0, INTENT_DISPLAY_MAX_CHARS - 1)}…`;
}

function toPersonalizedCard(q: PersonalizedInterviewQuestion): CardModel {
  return {
    category: TWO_LAYER_CATEGORY_LABEL[q.category],
    question: q.question,
    answerTip: q.answerTip,
    sourceHintLabel: q.sourceHint ? SOURCE_HINT_LABEL[q.sourceHint] : undefined,
    intent: capIntentForDisplay(q.intent),
  };
}

function FallbackNotice() {
  return (
    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 mb-4 leading-relaxed">
      AI 生成に失敗したため、通常の質問を表示しています。
    </p>
  );
}

export function InterviewQuestionPreview({
  viewState,
  extraQuestions,
  onAddMore,
  loadingCategory,
  categoryRemainingCounts,
  showFallbackNotice,
}: Props) {
  // mode === 'idle' のときは Form 側で <Preview> を出さない前提だが、防御的に何も描画しない。
  if (viewState.mode === 'idle') return null;

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-6">
      <h2 className="text-base font-semibold text-gray-800 mb-2">予想質問</h2>
      <p className="text-sm text-gray-500 leading-relaxed mb-5">
        入力内容をもとに生成した面接の予想質問です。実際の面接前に声に出して練習してみてください。
      </p>

      {showFallbackNotice && <FallbackNotice />}

      {viewState.mode === 'legacy' ? (
        // 既存 deterministic 表示。「さらに質問を生成」ボタンとセットで挙動を完全維持する。
        <div className="space-y-4">
          {viewState.questions.map((item) => {
            const extras = extraQuestions.filter((q) => q.category === item.category);
            const isExpandable = EXPANDABLE_CATEGORIES.includes(item.category);
            const isLoading = loadingCategory === item.category;
            const remaining = categoryRemainingCounts[item.category] ?? 0;
            const isLimitReached = remaining === 0;

            return (
              <div key={item.category}>
                <QuestionCard card={item} />

                {extras.map((extra, i) => (
                  <div key={`${item.category}-extra-${i}`} className="mt-3">
                    <QuestionCard card={extra} />
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
      ) : (
        // AI 成功時の 2 層表示。「さらに質問を生成」ボタンは出さない（legacy 経路を温存）。
        <div className="space-y-6">
          {viewState.questions.general.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">一般質問</h3>
              <div className="space-y-3">
                {viewState.questions.general.map((q, i) => (
                  <QuestionCard key={`general-${i}`} card={toGeneralCard(q)} />
                ))}
              </div>
            </div>
          )}
          {viewState.questions.personalized.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                あなた専用の深掘り質問
              </h3>
              <div className="space-y-3">
                {viewState.questions.personalized.map((q, i) => (
                  <QuestionCard key={`personalized-${i}`} card={toPersonalizedCard(q)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
