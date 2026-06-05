import type { ReactNode } from 'react';

/**
 * STEP-LEGAL-02: プライバシーポリシー / 特商法表記など、「第N条」ではなく
 * 「1. xxxx」「2. xxxx」と番号付きセクション形式の法務ページで使う primitive。
 *
 * LegalArticle (利用規約用) と本文 styling は揃え、見出し記法だけ差し替える。
 */
export function LegalSection({
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
        {number}. {title}
      </h2>
      <div className="text-sm text-slate-700 leading-relaxed space-y-2">
        {children}
      </div>
    </section>
  );
}
