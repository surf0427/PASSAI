'use client';

// PASSAI 受験チューターAI 用のメッセージ吹き出し（実装 STEP8 / STEP9 拡張）。
//
// 役割:
//   - user / assistant の発話を吹き出しとして表示する
//   - 改行を保持する（whitespace-pre-wrap）
//   - PASSAI の chat UI 慣例（essay-practice）に揃えた色設計
//
// STEP9 拡張:
//   - assistant の text を parseTutorReply で解析し、末尾の「→ 〜」行があれば
//     bubble から切り離して TutorSuggestionLink で表示する
//   - parse は **表示時のみ**。chatMessages の保存内容（text）は変更しない
//   - parse 失敗 / suggestion なし / bodyText 空 などの異常パスも crash しない fallback あり
//
// 含めない:
//   - アバター / キャラ画像
//   - タイムスタンプ / 個人情報
//   - reaction / メニュー（依存形成防止）
//   - user message に対する parse（不要、本人の発話なので suggestion 化しない）

import { parseTutorReply } from '@/lib/tutor/parseTutorReply';
import { TutorSuggestionLink } from './TutorSuggestionLink';

type TutorBubbleProps = {
  role: 'user' | 'assistant';
  text: string;
};

export function TutorBubble({ role, text }: TutorBubbleProps) {
  // user は parse しない（自分の発話、suggestion 化対象外）
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words bg-blue-600 text-white rounded-br-md">
          {text}
        </div>
      </div>
    );
  }

  // assistant: 末尾の suggestion 行を分離
  const { bodyText, suggestion } = parseTutorReply(text);

  // 表示するテキストを決定:
  //   - bodyText が非空                       → bodyText を bubble に表示
  //   - bodyText が空 かつ suggestion あり    → bubble を出さない（元 text は全て suggestion 行のため）
  //   - bodyText が空 かつ suggestion なし    → 元 text を fallback として表示（crash 防止）
  const displayText =
    bodyText !== '' ? bodyText : suggestion === null ? text : '';

  return (
    <div className="flex flex-col items-start gap-2">
      {displayText !== '' && (
        <div className="max-w-[85%] sm:max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words bg-gray-100 text-gray-800 rounded-bl-md">
          {displayText}
        </div>
      )}
      {suggestion && (
        <TutorSuggestionLink href={suggestion.href} label={suggestion.label} />
      )}
    </div>
  );
}
