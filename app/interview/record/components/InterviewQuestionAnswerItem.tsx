import type { QuestionAnswerItem } from '../types';

const TEXTAREA_CLASS =
  'w-full border border-slate-300 rounded-lg px-4 py-3 text-sm leading-relaxed bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y';

type Props = {
  item: QuestionAnswerItem;
  index: number;
  canDelete: boolean;
  onChangeQuestion: (value: string) => void;
  onChangeAnswer: (value: string) => void;
  onDelete: () => void;
};

export function InterviewQuestionAnswerItem({
  item,
  index,
  canDelete,
  onChangeQuestion,
  onChangeAnswer,
  onDelete,
}: Props) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 mb-4">

      {/* ヘッダー：番号と削除ボタン */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-blue-600">質問 {index + 1}</span>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            削除
          </button>
        )}
      </div>

      {/* 質問 */}
      <div className="mb-3">
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          どんな質問をされた？
        </label>
        <textarea
          value={item.question}
          onChange={(e) => onChangeQuestion(e.target.value)}
          rows={2}
          placeholder="例：志望理由を教えてください。"
          className={TEXTAREA_CLASS}
        />
      </div>

      {/* 回答 */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          何て答えた？
        </label>
        <textarea
          value={item.answer}
          onChange={(e) => onChangeAnswer(e.target.value)}
          rows={3}
          placeholder="例：テニス部での経験と、データ活用に興味があることを話しました。"
          className={TEXTAREA_CLASS}
        />
      </div>

    </div>
  );
}
