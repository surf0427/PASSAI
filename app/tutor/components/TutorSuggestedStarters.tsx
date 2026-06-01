// STEP-CHAT-HISTORY-01: 空 thread に表示する開始候補。
//
// 役割:
//   ユーザーが「何を聞けばいいか分からない」状態を解消するための quick-pick。
//   タップすると input に流し込むだけで、自動送信はしない（ユーザーが内容を確認 / 編集できる）。
//
// 候補は固定 4 個（PASSAI tutor の代表的な利用シーン）。AI 生成ではない。

'use client';

type Props = {
  onPick: (text: string) => void;
};

const SUGGESTED: string[] = [
  '志望校選びについて相談したい',
  '志望理由書の書き方を知りたい',
  '勉強計画を立てたい',
  'モチベーションが続かない',
];

export function TutorSuggestedStarters({ onPick }: Props) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 sm:p-5">
      <p className="text-sm font-semibold text-gray-700 mb-3">
        何について相談したいですか？
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SUGGESTED.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className="text-left text-sm text-gray-700 bg-white border border-gray-200 rounded-xl px-3 py-2 hover:border-blue-300 hover:bg-blue-50 transition-colors"
          >
            {text}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-3">
        もちろん、自由に質問しても大丈夫です。
      </p>
    </div>
  );
}
