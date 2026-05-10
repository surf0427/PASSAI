import type { ReactNode } from 'react';

// PASSAI Design System v1 — PageHeader
//
// 各ページ冒頭の「タイトル + 任意の説明 + 任意の右アクション」を 1 箇所に集約する。
// h1 のフォントサイズ・色・wrapper の下マージンを統一することで、
// ページ間の見た目ドリフト（text-gray-800 vs text-slate-900、mb-2/3/6/8 混在など）を抑える。
//
// 余白:
//   wrapper の mb-6 は about / 多くの分析系ページの h1 直後マージンに合わせた値。
//   差し替えで視覚不変を狙う。個別ページで余白を変えたいときは className で渡す。
//
// right:
//   指定があるときだけ flex レイアウトに切り替える。
//   無いときは余分なラッパーを増やさず、素の <h1> + <p> に近い DOM にする。

type Props = {
  title: string;
  description?: string;
  right?: ReactNode;
  className?: string;
};

const TITLE = 'text-2xl sm:text-3xl font-bold text-slate-900';
const DESCRIPTION = 'mt-2 text-sm sm:text-base text-slate-600 leading-relaxed';

export function PageHeader({
  title,
  description,
  right,
  className = '',
}: Props) {
  return (
    <header className={`mb-6 ${className}`}>
      {right ? (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className={TITLE}>{title}</h1>
            {description && <p className={DESCRIPTION}>{description}</p>}
          </div>
          <div className="shrink-0">{right}</div>
        </div>
      ) : (
        <>
          <h1 className={TITLE}>{title}</h1>
          {description && <p className={DESCRIPTION}>{description}</p>}
        </>
      )}
    </header>
  );
}
