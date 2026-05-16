// 「ここで書いた内容は◯◯にも使われる」という入力価値を可視化する軽量ノート。
//
// 役割:
//   ユーザーが「何のために書いているか」を理解した上で回答できるよう、
//   接続感を示すための dumb な表示コンポーネント。
//
// 設計:
//   - useState / useEffect / fetch / localStorage を持たない pure presentational
//   - 文言の整形（join, 定型文埋め込み）のみ component 内で行う
//   - usages は呼び出し側から渡す（feature 間で再利用するため）
//   - tone は 'info' / 'tip' の 2 種類。AlertBox とは別物の軽量スタイルにする
//     （AlertBox は通知性の高い ARIA role を持つため、本ノートのような恒常表示には重い）

type UsageNoteTone = 'info' | 'tip';

export type UsageNoteProps = {
  usages: string[];
  tone?: UsageNoteTone;
};

const NOTE_STYLE: Record<UsageNoteTone, string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  tip: 'bg-amber-50 border-amber-200 text-amber-800',
};

const NOTE_ICON: Record<UsageNoteTone, string> = {
  info: '💡',
  tip: '✨',
};

function buildMessage(usages: string[], tone: UsageNoteTone): string {
  const joined = usages.join('・');
  if (tone === 'tip') {
    return `詳しく書くほど、${joined}の具体性が高まります。`;
  }
  return `ここで書いた内容は、${joined}のサポートにも使われます。`;
}

export function UsageNote({ usages, tone = 'info' }: UsageNoteProps) {
  if (usages.length === 0) return null;
  const message = buildMessage(usages, tone);

  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm leading-relaxed ${NOTE_STYLE[tone]}`}
    >
      <span aria-hidden="true" className="shrink-0">
        {NOTE_ICON[tone]}
      </span>
      <span>{message}</span>
    </div>
  );
}
