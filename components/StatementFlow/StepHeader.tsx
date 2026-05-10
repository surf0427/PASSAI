import Link from 'next/link';

type Props = {
  currentStep: number;
  totalSteps: number;
  title: string;
  description?: string;
  backHref?: string;
  nextHref?: string;
  nextLabel?: string;
};

export function StepHeader({
  currentStep,
  totalSteps,
  title,
  description,
  backHref,
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
                <span className="ml-1">前へ戻る</span>
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

      <p className="text-[11px] font-bold text-blue-600 mb-2 tracking-widest">
        STEP {currentStep} / {totalSteps}
      </p>
      <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
        {title}
      </h1>
      {description && (
        <p className="text-sm text-slate-500 leading-relaxed">{description}</p>
      )}
    </header>
  );
}
