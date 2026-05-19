'use client';

// PASSAI 受験チューターAI の入口 chip（実装 STEP8）。
//
// 役割:
//   - 受験生が「何を相談していいか分からない」最初の壁を消す
//   - Light Casual トーンで揃え、入口での温度感を作る
//   - クリック時に input 欄に文言を流し込む（送信は別操作、上書きしてから送れる）
//
// 含めない:
//   - 絵文字（chip 自体はテキストのみ、ユーザーが追加で打ち込んだ時のみ AI が絵文字を mirror）
//   - 多数のオプション（4 個に絞って選択疲労を防ぐ）

const SUGGESTIONS = [
  '受かる気がしない',
  '志望理由書むり',
  '面接で言葉が出ない',
  'やる気が出ない',
] as const;

type TutorChipSuggestionsProps = {
  onSelect: (text: string) => void;
  disabled?: boolean;
};

export function TutorChipSuggestions({ onSelect, disabled }: TutorChipSuggestionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onSelect(suggestion)}
          disabled={disabled}
          className="text-xs border border-gray-300 hover:border-blue-400 hover:text-blue-600 text-gray-600 rounded-full px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
