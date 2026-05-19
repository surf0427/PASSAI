'use client';

// PASSAI 受験チューターAI の機能接続リンク（実装 STEP9）。
//
// 役割:
//   - assistant bubble の下に「→ 〜してみる」型のリンクボタンを表示する
//   - AI 応答末尾を parseTutorReply で切り離した内容を Next.js Link で render
//
// デザイン方針:
//   - 柔らかい淡色（blue-50 background / blue-700 text / blue-200 border）
//   - bubble と同じ max-width で視覚的リズムを揃える
//   - 「強すぎる CTA」を避け、「今必要な一歩」感を出す
//   - 派手な背景・矢印アイコンなどは避ける
//
// 含めない:
//   - 複数 suggestion の同時表示（呼び出し側で 1 つに絞る）
//   - 外部 URL / AI 生成 URL（href は固定 whitelist のみ、parseTutorReply 側で担保）

import Link from 'next/link';

type TutorSuggestionLinkProps = {
  href: string;
  label: string;
};

export function TutorSuggestionLink({ href, label }: TutorSuggestionLinkProps) {
  return (
    <Link
      href={href}
      className="inline-block max-w-[85%] sm:max-w-[75%] text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-2xl px-4 py-2 leading-relaxed transition-colors break-words"
    >
      → {label}
    </Link>
  );
}
