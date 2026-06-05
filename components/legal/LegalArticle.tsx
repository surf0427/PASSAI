import type { ReactNode } from 'react';

/**
 * STEP-LEGAL-01: 利用規約・プライバシーポリシー・特商法表記など、
 * 条文ベースの法務ページで再利用する 1 条ぶんのレイアウト primitive。
 *
 * - h2 で「第N条（タイトル）」を表示し、children を本文として下に流す
 * - 番号付き本文は children 側で `<ol className="list-decimal ...">` を使う
 * - 強調が必要な箇所は `<strong>` / `<p className="...callout..">` を children 内で組む
 *   (本 primitive は構造のみで装飾の方針は決めない)
 */
export function LegalArticle({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold text-slate-900">
        第{number}条（{title}）
      </h2>
      <div className="text-sm text-slate-700 leading-relaxed space-y-2">
        {children}
      </div>
    </section>
  );
}
