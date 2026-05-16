import { Accordion } from '@/components/ui/Accordion';

type Props = {
  questions: string[];
  answers: string[];
  // 各質問に対する任意の「追加深掘りメモ」。answers と index 一対一対応。
  // 永続化は呼び出し側 (self-analysis/page.tsx) の責務。本 component は値を表示・編集するだけ。
  deepAnswers: string[];
  onChange: (index: number, value: string) => void;
  onDeepChange: (index: number, value: string) => void;
  onSubmit: () => void;
  onReanalyze: () => void;
  loading: boolean;
  remainingCount: number;
};

export function QuestionsSection({ questions, answers, deepAnswers, onChange, onDeepChange, onSubmit, onReanalyze, loading, remainingCount }: Props) {
  return (
    <div>
      <p className="text-sm text-gray-500 mb-6">
        分かる範囲で答えてください。番号だけ・短文でもOKです。
      </p>
      <div className="space-y-5">
        {questions.map((question, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
            <label className="block text-sm font-semibold text-gray-800 mb-3">
              Q{i + 1}. {question}
            </label>
            <textarea
              value={answers[i] ?? ''}
              onChange={(e) => onChange(i, e.target.value)}
              rows={3}
              className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm leading-relaxed bg-white text-slate-900 placeholder:text-slate-400 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-400 dark:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
              placeholder="短くてもOKです"
            />
            {/* 「もう少し詳しく整理する」accordion。
                初期 closed、開閉状態は Accordion 内部の useState に閉じ込めて永続化しない。
                深掘りメモの値（deepAnswers[i]）のみ親で持って永続化する。 */}
            <div className="mt-3">
              <Accordion title="もう少し詳しく整理する（任意）" defaultOpen={false}>
                <textarea
                  value={deepAnswers[i] ?? ''}
                  onChange={(e) => onDeepChange(i, e.target.value)}
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm leading-relaxed bg-white text-slate-900 placeholder:text-slate-400 dark:bg-white dark:text-slate-900 dark:placeholder:text-slate-400 dark:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                  placeholder="背景・きっかけ・葛藤・続けられた理由など、追加で整理したいことがあれば書いてください。"
                />
              </Accordion>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 flex gap-3 flex-wrap">
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-lg text-base transition-colors"
        >
          {loading ? '生成中...' : '活動まとめを生成する'}
        </button>
        <button
          type="button"
          onClick={onReanalyze}
          disabled={loading || remainingCount <= 0}
          className="bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed text-blue-700 font-semibold border border-blue-200 px-6 py-3 rounded-lg text-base transition-colors"
        >
          {loading
            ? '分析中...'
            : remainingCount <= 0
              ? '再び深掘る（本日の上限に達しました）'
              : `再び深掘る（残り${remainingCount}回）`}
        </button>
      </div>
    </div>
  );
}
