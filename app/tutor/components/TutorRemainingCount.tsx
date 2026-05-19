'use client';

// PASSAI 受験チューターAI の残回数表示（実装 STEP8）。
//
// 役割:
//   - 「無限相談ではない」を構造的に可視化する（依存形成の防止）
//   - 残り 3 回以下で警告色、0 回で disabled 文言を出す
//
// 含めない:
//   - 「明日の上限まであと N 時間」のような細かいカウントダウン
//   - 「もっと使いたければ課金」のような誘導（v1 では単一無料ティアのみ）

type TutorRemainingCountProps = {
  remaining: number;
  limit: number;
};

export function TutorRemainingCount({ remaining, limit }: TutorRemainingCountProps) {
  const isLow = remaining <= 3 && remaining > 0;
  const isZero = remaining === 0;

  return (
    <p className="text-xs text-gray-500">
      今日の相談回数: 残り
      <span
        className={`font-bold mx-1 ${
          isZero ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-blue-600'
        }`}
      >
        {remaining}
      </span>
      / {limit}
      {isZero && (
        <span className="ml-2 text-red-500">
          今日はここまでです。明日また来てください。
        </span>
      )}
    </p>
  );
}
