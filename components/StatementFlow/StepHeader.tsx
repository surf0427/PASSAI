import Link from 'next/link';

type Props = {
  currentStep: number;
  totalSteps: number;
  title: string;
  description?: string;
  backHref?: string;
  // 戻りリンクのラベル。4-mode / workspace 型 UX に伴い「機能一覧へ戻る」意味で
  // 上書きされる。default は後方互換のため旧 STEP 型表現を維持。
  backLabel?: string;
  nextHref?: string;
  nextLabel?: string;
};

export function StepHeader({
  // currentStep / totalSteps は 4-mode / workspace 型 UX 移行に伴い旧「STEP X / Y」
  // visual badge を撤去したため、本体では描画しない。type 上は維持し、page 側の
  // wiring も維持する（将来別用途に使う可能性を残し、最小 diff のため）。
  title,
  description,
  backHref,
  backLabel = '前へ戻る',
  nextHref,
  nextLabel = '次へ進む',
}: Props) {
  const hasNav = Boolean(backHref || nextHref);

  return (
    <header className="mb-6 sm:mb-8">
      {hasNav && (
        <nav
          aria-label="ステップ間のナビゲーション"
          className="flex items-center justify-between gap-2 mb-4"
        >
          <div>
            {backHref && (
              <Link
                href={backHref}
                className="inline-flex items-center text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                <span aria-hidden>←</span>
                <span className="ml-1">{backLabel}</span>
              </Link>
            )}
          </div>
          <div>
            {nextHref && (
              <Link
                href={nextHref}
                className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700 font-semibold transition-colors"
              >
                <span>{nextLabel}</span>
                <span aria-hidden className="ml-1">→</span>
              </Link>
            )}
          </div>
        </nav>
      )}

      <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
        {title}
      </h1>
      {description && (
        <p className="text-sm text-slate-500 leading-relaxed">{description}</p>
      )}
    </header>
  );
}
