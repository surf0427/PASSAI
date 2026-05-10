// 回答内容から改善コメントを生成する。
// 将来的に Claude API に置き換える際はこの関数の実装だけ変えればよい。
export function generateInterviewFeedback(answer: string): string {
  const length = answer.trim().length;

  if (length < 50) {
    return 'もう少し具体的なエピソードを加えると良いです。';
  }

  if (length > 200) {
    return '内容は良いですが、結論を先に述べるとより分かりやすくなります。';
  }

  return '具体性と結論の明確さを意識するとより良くなります。';
}
